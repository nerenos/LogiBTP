import { test, expect, type Page } from '@playwright/test';
import { seConnecter } from './outils/connexion';
import {
  TIERS, suffixe, patienterSurLimiteDebit, attendreMessage, confirmer, dialogue, attendreDocument, idDocument, numeroDocument,
  attendreStatut, attendreTotalHt, onglet, enregistrer, actionDocument, valider, transformer, ligneGrille, saisirCellule,
  creerDevisValide,
} from './outils/documents';

/**
 * Cycle commercial, partie 2 : de la commande à la facturation à l'avancement.
 * Devis accepté (préparé) → commande → informations de la commande → validation dans un nouveau marché → situation 1
 * et sa facture → situation 2 et sa facture → annulation de la facture 2 par avoir, reprise de la situation 2 et
 * nouvelle facture → prévisionnel de facturation du chantier.
 * Montants : une ligne de 10 m² à 40 € (400 € HT) ; situations à 40 %, 70 % puis 60 % après reprise.
 */
test.describe.serial('Cycle commercial : commande, situations et factures d’avancement', () => {
  test.describe.configure({ timeout: 90000 });

  const s = suffixe();
  const ligne = { libelle: `Gros œuvre e2e ${s}`, qte: '10', unite: 'm2', pv: '40' };
  const objetCommande = `Commande gros œuvre e2e ${s}`;
  const libelleChantier = `Chantier e2e ${s}`;

  let page: Page;
  let marche = { id: 0, code: '' };
  let chantier = { id: 0, code: '' };
  let situation2 = 0;
  let facture2 = { id: 0, numero: '' };

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => { await page.close(); });

  /** Situation créée depuis l'onglet Gestion du marché, avancement cumulé saisi, enregistrée et validée. */
  async function situation(pourcent: string) {
    await page.goto(`/fiche/marche/${marche.id}`);
    await page.getByRole('navigation').getByRole('button', { name: 'Gestion', exact: true }).click();
    await page.getByRole('button', { name: /Nouvelle situation$/ }).click();
    await attendreMessage(page, /Situation ST\d{4}-\d+ créé/);
    await attendreDocument(page);
    await onglet(page, 'Lignes');
    await saisirCellule(page, ligneGrille(page, ligne.libelle), '% cumul', pourcent);
    await enregistrer(page);
    await valider(page);
    await attendreStatut(page, 'Validé');
  }

  /** Facture d'avancement de la situation ouverte, validée. */
  async function factureAvancement(totalHt: string) {
    await transformer(page, /Facture d'avancement/);
    await attendreMessage(page, 'Facture d\'avancement créé');
    await valider(page);
    await attendreStatut(page, 'Validé');
    await attendreTotalHt(page, totalHt);
    const { numero } = await numeroDocument(page);
    expect(numero).toMatch(/^SI\d{4}-\d+$/);
    return { id: idDocument(page), numero };
  }

  test('Préparation : devis accepté par le client', async () => {
    await creerDevisValide(page, { objet: `Devis gros œuvre e2e ${s}`, ligne });
  });

  test('Transformation du devis validé en commande', async () => {
    await transformer(page, /Commande client/);
    await attendreMessage(page, /Commande client CC\d{4}-\d+ créé/);
    expect((await numeroDocument(page)).numero).toMatch(/^CC\d{4}-\d+$/);
    // Commande en brouillon (statut de son propre type), modifiable
    await attendreStatut(page, 'Brouillon');
    await expect(page.getByRole('button', { name: 'Enregistrer', exact: true })).toBeEnabled();
    await attendreTotalHt(page, '400,00');
    // Le tiers d'un document transformé ne change plus
    await expect(page.getByRole('combobox', { name: /le tiers ne change plus/ })).toHaveValue(TIERS.CLIENT);
  });

  test('Complétion des informations de la commande', async () => {
    await page.getByRole('textbox', { name: 'Objet', exact: true }).fill(objetCommande);
    await page.getByRole('textbox', { name: 'Notre référence', exact: true }).fill(`AFF-${s}`);
    await page.getByRole('textbox', { name: 'Référence externe', exact: true }).fill(`BC-CLIENT-${s}`);
    await enregistrer(page);
    await page.reload();
    await attendreDocument(page);
    await expect(page.getByRole('textbox', { name: 'Objet', exact: true })).toHaveValue(objetCommande);
    await expect(page.getByRole('textbox', { name: 'Référence externe', exact: true })).toHaveValue(`BC-CLIENT-${s}`);
  });

  test('Validation de la commande dans un nouveau marché', async () => {
    await actionDocument(page, 'Valider');
    // Une commande client se valide dans un marché : nouveau chantier et nouveau marché (base)
    const d = dialogue(page);
    await expect(d.getByRole('heading', { name: /Marché de la commande/ })).toBeVisible();
    await expect(d.getByRole('combobox', { name: 'Chantier', exact: true })).toHaveValue(/Nouveau chantier/);
    await d.getByRole('group', { name: 'Nouveau chantier' }).getByRole('textbox', { name: 'Libellé', exact: true }).fill(libelleChantier);
    await expect(d.getByRole('radio', { name: /Nouveau marché/ })).toBeChecked();
    await d.getByRole('button', { name: 'Valider la commande', exact: true }).click();
    await attendreMessage(page, /Document validé : CC\d{4}-\d+/);
    await attendreStatut(page, 'Validé');

    // Chantier et marché rattachés à la commande
    const ratt = page.getByRole('group', { name: 'Rattachement' });
    await expect(ratt.getByRole('link', { name: libelleChantier })).toBeVisible();
    chantier = {
      code: await ratt.getByRole('textbox', { name: 'Chantier', exact: true }).inputValue(),
      id: Number((await ratt.getByRole('link', { name: libelleChantier }).getAttribute('href'))!.split('/').pop()),
    };
    const lienMarche = ratt.getByRole('link', { name: objetCommande });
    marche = {
      code: await ratt.getByRole('textbox', { name: 'Marché', exact: true }).inputValue(),
      id: Number((await lienMarche.getAttribute('href'))!.split('/').pop()),
    };
    expect(chantier.code).toMatch(/^CH-\d{4}-\d+$/);
    expect(marche.code).toBe(`M-${chantier.code.slice(3)}-1`);
  });

  test('Situation n° 1 (40 %) transformée en facture d’avancement', async () => {
    await situation('40');
    await attendreTotalHt(page, '160,00');
    await factureAvancement('160,00');
  });

  test('Situation n° 2 (70 %) transformée en facture d’avancement', async () => {
    await situation('70');
    situation2 = idDocument(page);
    await attendreTotalHt(page, '280,00');
    // Facture de la période : 70 % − 40 % de 400 €
    facture2 = await factureAvancement('120,00');
  });

  test('Annulation de la facture n° 2 par avoir, reprise de la situation n° 2 et nouvelle facture', async () => {
    await actionDocument(page, 'Annuler par avoir…');
    await expect(dialogue(page)).toContainText(facture2.numero);
    await confirmer(page);
    await attendreMessage(page, /avoir\(s\) d'annulation créé\(s\) ; dernière situation remise en cours/);

    // La situation remise en cours (nouvel indice, brouillon) s'ouvre dans une autre fenêtre
    await expect(dialogue(page)).toContainText('Ouvrir la situation remise en cours ?');
    const [fenetre] = await Promise.all([page.context().waitForEvent('page'), confirmer(page)]);
    await attendreStatut(page, 'Annulé');
    await fenetre.close();

    // Reprise de la situation n° 2 : nouvel indice en brouillon (dernière situation du marché)
    await page.goto(`/liste/situations?marche=${marche.code}`);
    const brouillon = page.locator('table tbody tr').filter({ hasText: 'Brouillon' });
    await expect(brouillon).toHaveCount(1);
    await brouillon.dblclick();
    await attendreDocument(page);
    expect(idDocument(page)).not.toBe(situation2);
    expect((await numeroDocument(page)).indice).toBe('B');
    await attendreStatut(page, 'Brouillon');

    await onglet(page, 'Lignes');
    await saisirCellule(page, ligneGrille(page, ligne.libelle), '% cumul', '60');
    await enregistrer(page);
    await valider(page);
    await attendreTotalHt(page, '240,00');

    // Nouvelle facture : 60 % − 40 % de 400 €
    const facture3 = await factureAvancement('80,00');
    expect(facture3.numero).not.toBe(facture2.numero);

    // Factures du marché : la facture n° 2 et son avoir (de même montant) sont annulés, les deux autres valides
    await page.goto(`/liste/factures?marche=${marche.code}`);
    const avoir = page.locator('table tbody tr').filter({ hasText: /AV\d{4}-\d+/ });
    await expect(avoir).toHaveCount(1);
    await expect(avoir).toContainText('Annulé');
    await expect(avoir).toContainText('120,00');
    await expect(page.locator('table tbody tr').filter({ hasText: facture2.numero }).filter({ hasText: 'Annulé' })).toHaveCount(1);
    await expect(page.locator('table tbody tr').filter({ hasText: facture3.numero }).filter({ hasText: 'Validé' })).toHaveCount(1);
  });

  test('Saisie d’un prévisionnel de facturation du chantier', async () => {
    await page.goto(`/rentabilite/chantier/${chantier.id}`);
    const panneau = page.locator('table.rentabilite-facturation').locator('xpath=..');
    await expect(panneau.getByRole('heading', { name: /Prévisionnel de facturation/ })).toBeVisible({ timeout: 15000 });
    await panneau.getByRole('button', { name: /Modifier la prévision/ }).click();

    // Mois suivant : 100 € HT prévus
    const auj = new Date();
    const suivant = new Date(auj.getFullYear(), auj.getMonth() + 1, 1);
    const mois = `${suivant.getFullYear()}-${String(suivant.getMonth() + 1).padStart(2, '0')}-01`;
    const champ = panneau.locator(`input[data-mois="${mois}"]`);
    await champ.fill('100');
    await champ.press('Tab');
    await panneau.getByRole('button', { name: 'Enregistrer la prévision', exact: true }).click();
    const fenetre = dialogue(page);
    await fenetre.getByRole('textbox').fill(`Prévision e2e ${s}`);
    await fenetre.getByRole('button', { name: 'OK', exact: true }).click();
    await attendreMessage(page, /Prévision de facturation enregistrée/);

    await expect(panneau).toContainText(`Prévision e2e ${s}`);
    const libelleMois = new Intl.DateTimeFormat('fr', { month: 'short', year: 'numeric' }).format(suivant);
    await expect(panneau.locator('tbody tr').filter({ has: page.getByRole('rowheader', { name: libelleMois }) })).toContainText('100,00');
  });
});
