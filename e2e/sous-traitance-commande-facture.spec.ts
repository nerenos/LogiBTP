import { test, expect, type Page } from '@playwright/test';
import { seConnecter, TAG_API } from './outils/connexion';
import {
  suffixe, patienterSurLimiteDebit, attendreDocument, attendreStatut, attendreTotalHt, actionDocument, transformer,
  numeroDocument, onglet, ligneGrille, texteCellule,
} from './outils/documents';
import { pieceOuverte, validerEtAccepter, reglerEcheance, echeanceOuverte, type PieceAchat } from './outils/achats';
import { creerPieceSousTraitance, validerCommandeDansMarche, marcheDuDocument, saisirAvancement, approuver, attendreTotalTtc, SOUS_TRAITANCE } from './outils/sous-traitance';

/**
 * Sous-traitance, partie 1 : de l'appel d'offres à la facturation à l'avancement.
 * Appel d'offres (10 000 € HT) accepté → commande de sous-traitance validée dans un nouveau marché de sous-traitance
 * (lié au marché de vente du chantier, caution, autoliquidation) → facture d'avancement n° 1 (40 %) → n° 2 (70 % :
 * période de 30 %) → facture à 60 % (période négative : avoir de sous-traitance) → règlement de la facture n° 1.
 * Marché en autoliquidation : TVA autoliquidée sur les pièces validées (TTC = HT).
 */
test.describe.serial('Sous-traitance : appel d’offres, commande, marché et factures d’avancement', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 90000 });

  const s = suffixe();
  const reseaux = { libelle: `Réseaux EF/EC e2e ${s}`, qte: '1', unite: 'ens', pv: '6000' };
  const appareils = { libelle: `Appareils sanitaires e2e ${s}`, qte: '10', unite: 'u', pv: '400' };

  let page: Page;
  let commande: PieceAchat;
  let marche = { id: 0, code: '' };
  let facture1: PieceAchat;
  let facture2: PieceAchat;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => { await page.close(); });

  test('Appel d’offres de sous-traitance accepté', async () => {
    const ao = await creerPieceSousTraitance(page, 'T_AO', { objet: `Plomberie bâtiment A e2e ${s}`, lignes: [reseaux, appareils] });
    await attendreTotalHt(page, '10 000,00');
    await validerEtAccepter(page);
    expect((await numeroDocument(page)).numero).toBe(ao.numero);
  });

  test('Commande de sous-traitance validée dans un nouveau marché de sous-traitance', async () => {
    await transformer(page, /Commande de sous-traitance/);
    await attendreStatut(page, 'Brouillon');
    await attendreTotalHt(page, '10 000,00');
    commande = await pieceOuverte(page);

    // Sans validation du tiers attendue : validée d'office ; marché en autoliquidation : TVA autoliquidée (TTC = HT)
    await validerCommandeDansMarche(page, { venteLiee: SOUS_TRAITANCE.MARCHE_VENTE, garantie: 'Caution' });
    await attendreStatut(page, 'Validé');
    await attendreTotalTtc(page, '10 000,00');

    // Marché de sous-traitance créé (code MST-<chantier>-<rang>) et rattaché à la commande
    marche = await marcheDuDocument(page);
    expect(marche.code).toMatch(/^MST-2026-002-\d+$/);
    await page.goto(`/fiche/marche/${marche.id}`);
    // Fiche du marché : sous-traitant, commande de base, marché de vente lié, garantie et montant (calculé)
    await expect(page.getByRole('link', { name: /Plomberie Dupuis et Fils/ })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('link', { name: new RegExp(commande.numero) }).first()).toBeVisible();
    await expect(page.getByRole('group', { name: 'Conditions' }).getByRole('textbox').first()).toHaveValue(/^10\s000$/);
    const st = page.getByRole('group', { name: 'Sous-traitance' });
    await expect(st.getByRole('textbox').first()).toHaveValue(SOUS_TRAITANCE.MARCHE_VENTE);
    await expect(st.getByRole('combobox').first()).toHaveValue('Caution (privé)');
  });

  test('Facture d’avancement n° 1 (40 %)', async () => {
    await page.goto(`/document/${commande.id}`);
    await attendreDocument(page);
    await transformer(page, /Facture d'avancement de sous-traitance/);
    await saisirAvancement(page, { [reseaux.libelle]: '40', [appareils.libelle]: '40' }, `FST-PLO-${s}-1`);
    await attendreTotalHt(page, '4 000,00');
    await approuver(page);
    await attendreStatut(page, 'Validé');
    await attendreTotalTtc(page, '4 000,00');
    facture1 = await pieceOuverte(page);
  });

  test('Facture d’avancement n° 2 (70 % : période de 30 %)', async () => {
    await page.goto(`/document/${commande.id}`);
    await attendreDocument(page);
    await transformer(page, /Facture d'avancement de sous-traitance/);
    await onglet(page, 'Lignes');
    expect(await texteCellule(page, ligneGrille(page, reseaux.libelle), '% préc.')).toBe('40,00');
    await saisirAvancement(page, { [reseaux.libelle]: '70', [appareils.libelle]: '70' }, `FST-PLO-${s}-2`);
    await attendreTotalHt(page, '3 000,00');
    await approuver(page);
    await attendreStatut(page, 'Validé');
    facture2 = await pieceOuverte(page);
  });

  test('Facture à 60 % : période négative, devenue avoir de sous-traitance', async () => {
    await page.goto(`/document/${commande.id}`);
    await attendreDocument(page);
    await transformer(page, /Facture d'avancement de sous-traitance/);
    await saisirAvancement(page, { [reseaux.libelle]: '60', [appareils.libelle]: '60' }, `AVS-PLO-${s}`);
    await attendreTotalHt(page, '-1 000,00');
    // Validée, la période négative (60 % − 70 % de 10 000 €) en fait un avoir d'avancement (ST21)
    await approuver(page);
    const avoir = await pieceOuverte(page);
    expect(avoir.numero).toMatch(/^AVS\d{4}-\d+$/);

    // Factures du marché : les deux factures et l'avoir
    await page.goto(`/liste/st_factures?marche=${marche.code}`);
    await expect(page.locator('table tbody tr')).toHaveCount(3);
    await expect(page.locator('table tbody tr').filter({ hasText: avoir.numero })).toContainText('1 000,00');
    await expect(page.locator('table tbody tr').filter({ hasText: facture2.numero })).toContainText('3 000,00');
  });

  test('Règlement de la facture n° 1 au sous-traitant (garantie par caution : payé par nous)', async () => {
    await page.goto(`/document/${facture1.id}`);
    await attendreDocument(page);
    await onglet(page, 'Règlements');
    await expect(page.locator('#vue-reglements')).toContainText('Reste à payer : 4 000,00');
    await page.locator('#vue-reglements').getByRole('link', { name: /Règlements du tiers/ }).click();
    await reglerEcheance(page, facture1.numero, '4000', `VIR-ST-${s}`);
    await expect(echeanceOuverte(page, facture1.numero)).toHaveCount(0);
    await page.goto(`/document/${facture1.id}`);
    await attendreDocument(page);
    await attendreStatut(page, 'Payé');
  });
});
