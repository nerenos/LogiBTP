import { test, expect, type Page } from '@playwright/test';
import { seConnecter, TAG_API } from './outils/connexion';
import {
  TIERS, suffixe, patienterSurLimiteDebit, attendreDocument, attendreStatut, attendreTotalHt, attendreMessage, actionDocument, dialogue, transformer,
  enregistrer, valider, onglet, ligneGrille, saisirCellule, creerDevisValide, idDocument,
} from './outils/documents';
import { pieceOuverte, type PieceAchat } from './outils/achats';
import { validerCommandeDansMarche, marcheDuDocument, saisirAvancement, approuver, choisirOption, SOUS_TRAITANCE } from './outils/sous-traitance';

/**
 * Sous-traitance, partie 2 : paiement direct d'un sous-traitant dans un marché public.
 * Commande client (20 000 € HT) validée dans un nouveau chantier et un marché public → « Sous-traiter » : commande de
 * sous-traitance → marché de sous-traitance (paiement direct, montant agréé) → facture du sous-traitant (50 %) →
 * demande de paiement direct reçue, acceptée, transmise avec notre facture d'avancement (déduction), payée par le
 * maître d'ouvrage.
 */
test.describe.serial('Sous-traitance : paiement direct dans un marché public', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 90000 });

  const s = suffixe();
  const ligne = { libelle: `Plomberie sanitaire e2e ${s}`, qte: '1', unite: 'ens', pv: '20000' };
  const objet = `Mairie plomberie e2e ${s}`;

  let page: Page;
  let vente = { id: 0, code: '' };
  let commandeSt: PieceAchat;
  let marcheSt = { id: 0, code: '' };
  let factureSt: PieceAchat;
  let factureClient = { id: 0 };

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => { await page.close(); });

  test('Commande client validée dans un marché public', async () => {
    await creerDevisValide(page, { objet: `Devis ${objet}`, ligne });
    await transformer(page, /Commande client/);
    await enregistrer(page);
    await actionDocument(page, 'Valider');
    const d = dialogue(page);
    await expect(d.getByRole('heading', { name: /Marché de la commande/ })).toBeVisible();
    await d.getByRole('group', { name: 'Nouveau chantier' }).getByRole('textbox', { name: 'Libellé', exact: true }).fill(`Chantier ${objet}`);
    await choisirOption(page, d.getByRole('group', { name: 'Marché', exact: true }).getByRole('combobox'), 'Marché public');
    await d.getByRole('button', { name: 'Valider la commande', exact: true }).click();
    await attendreMessage(page, /Document validé/);
    vente = await marcheDuDocument(page);
  });

  test('Sous-traiter la commande client : commande de sous-traitance', async () => {
    // Libellé précédé d'une icône personnalisable : action désignée par son code
    await page.locator('[data-ouvrir-actions]').click();
    await page.locator('[data-menu-actions] [data-action="sous-traiter"]').click();
    const d = dialogue(page);
    await choisirOption(page, d.getByRole('combobox'), 'Commande de sous-traitance');
    await d.getByRole('checkbox', { name: SOUS_TRAITANCE.SOUS_TRAITANT }).check();
    // La commande créée s'ouvre dans une autre fenêtre : elle est rouverte dans celle du scénario
    const [fenetre] = await Promise.all([page.context().waitForEvent('page'), d.getByRole('button', { name: 'Créer', exact: true }).click()]);
    await attendreMessage(page, '1 document(s) de sous-traitance créé(s)');
    await expect(fenetre).toHaveURL(/\/document\/\d+/);
    const url = fenetre.url();
    await fenetre.close();
    await page.goto(url);
    await attendreDocument(page);
    await attendreStatut(page, 'Brouillon');
    commandeSt = await pieceOuverte(page);
    // Lignes et chantier repris de la commande client ; prix du sous-traitant saisi
    await onglet(page, 'Lignes');
    await saisirCellule(page, ligneGrille(page, ligne.libelle), 'PV', '12000');
    await enregistrer(page);
    await attendreTotalHt(page, '12 000,00');
  });

  test('Commande de sous-traitance validée dans un marché en paiement direct', async () => {
    // Marché de vente de la commande client proposé comme marché lié : nature publique, paiement direct
    await validerCommandeDansMarche(page, { garantie: 'Paiement direct', agree: '12000', autoliquidation: false, venteAttendue: vente.code });
    await attendreStatut(page, 'Validé');
    marcheSt = await marcheDuDocument(page);
    expect(marcheSt.code).toMatch(/^MST-/);
  });

  test('Facture du sous-traitant (50 %)', async () => {
    await transformer(page, /Facture d'avancement de sous-traitance/);
    await saisirAvancement(page, { [ligne.libelle]: '50' }, `FST-PD-${s}`);
    await attendreTotalHt(page, '6 000,00');
    await approuver(page);
    factureSt = await pieceOuverte(page);
  });

  test('Notre facture d’avancement au client (brouillon)', async () => {
    await page.goto(`/fiche/marche/${vente.id}`);
    await page.getByRole('navigation').getByRole('button', { name: 'Gestion', exact: true }).click();
    await page.getByRole('button', { name: /Nouvelle situation$/ }).click();
    await attendreMessage(page, /Situation ST\d{4}-\d+ créé/);
    await attendreDocument(page);
    await onglet(page, 'Lignes');
    await saisirCellule(page, ligneGrille(page, ligne.libelle), '% cumul', '50');
    await enregistrer(page);
    await valider(page);
    await transformer(page, /Facture d'avancement/);
    await attendreMessage(page, 'Facture d\'avancement créé');
    await attendreTotalHt(page, '10 000,00');
    factureClient = { id: idDocument(page) };
  });

  test('Demande de paiement direct reçue, acceptée, transmise avec notre facture puis payée', async () => {
    await page.goto(`/fiche/marche/${marcheSt.id}`);
    await page.getByRole('navigation').getByRole('button', { name: 'Paiements', exact: true }).click();
    const zone = page.locator('.paiements-st');
    await expect(zone.getByRole('heading', { name: 'Paiement direct (marché public)' })).toBeVisible({ timeout: 15000 });
    const ligneFacture = zone.locator('tbody tr').filter({ hasText: factureSt.numero });
    await expect(ligneFacture).toContainText('7 200,00');

    // Boutons à icône seule (titre en infobulle) : désignés par leur action
    await ligneFacture.locator('[data-declarer]').click();
    await attendreMessage(page, 'Demande enregistrée');
    await expect(ligneFacture).toContainText('Demande reçue');
    await ligneFacture.locator('[data-accepter]').click();
    await attendreMessage(page, 'Demande traitée');
    await expect(ligneFacture).toContainText('Acceptée');
    await ligneFacture.locator('[data-transmettre]').click();
    await attendreMessage(page, 'Demande transmise');
    await expect(ligneFacture).toContainText("Transmise au maître d'ouvrage");
    await ligneFacture.locator('[data-payer]').click();
    await attendreMessage(page, 'Paiement constaté');
    await expect(ligneFacture).toContainText("Payée par le maître d'ouvrage");
    await expect(zone).toContainText(/Payé par le maître d'ouvrage\s*7\s200,00/);

    // Notre facture porte la déduction du paiement direct (poste de pied) : net à payer du client = 12 000,00 TTC
    // − 500,00 de retenue de garantie (5 % du HT) − 7 200,00 payés directement au sous-traitant
    await page.goto(`/document/${factureClient.id}`);
    await attendreDocument(page);
    await expect(page.locator('#vue-entete table.totaux tr').filter({ hasText: 'Net à payer' })).toContainText('4 300,00');
    await onglet(page, 'Lignes');
    await expect(ligneGrille(page, 'Paiement direct')).toContainText(SOUS_TRAITANCE.SOUS_TRAITANT);
  });
});
