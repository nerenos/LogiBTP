import { test, expect, type Page } from '@playwright/test';
import { seConnecter, TAG_API } from './outils/connexion';
import {
  TIERS, suffixe, patienterSurLimiteDebit, attendreMessage, confirmer, saisirDansDialogue, choisirDansListe, attendreDocument, idDocument, numeroDocument,
  attendreStatut, attendreTotalHt, onglet, enregistrer, actionDocument, valider, ligneGrille, saisirCellule, texteCellule, creerDevis,
} from './outils/documents';

/**
 * Cycle commercial, partie 1 : de la demande du CRM au devis accepté.
 * Demande → projet → devis rattaché au projet → envoi → révision (indice B) → copie → retour à une version
 * précédente → validation par le client. Les étapes s'enchaînent (une seule page, ordre imposé).
 */
test.describe.serial('Cycle commercial : demande, projet et devis', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 90000 });

  const s = suffixe();
  const objetDemande = `Rénovation hall e2e ${s}`;
  const objetDevis = `Devis rénovation hall e2e ${s}`;
  const ligne = { libelle: `Maçonnerie hall e2e ${s}`, qte: '10', unite: 'm2', pv: '40' };

  let page: Page;
  let projet = '';
  let devis = { id: 0, numero: '', objet: objetDevis };
  let indiceB = 0;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => { await page.close(); });

  test('Création d’une demande dans le CRM', async () => {
    await page.goto('/crm/demande/nouveau');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Nouvelle demande');

    await page.getByRole('textbox', { name: 'Objet', exact: true }).fill(objetDemande);
    // Tiers : liste des tiers de l'annuaire (bouton « … » du champ)
    await page.getByRole('button', { name: /^Tiers/ }).click();
    await choisirDansListe(page, TIERS.CLIENT);
    await expect(page.getByRole('link', { name: TIERS.CLIENT })).toBeVisible();
    await page.getByRole('textbox', { name: 'Origine', exact: true }).fill('Appel d’offres');
    await page.getByRole('textbox', { name: 'Montant estimé (HT)', exact: true }).fill('25000');

    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await attendreMessage(page, 'Demande enregistrée');
    await expect(page).toHaveURL(/\/crm\/demande\/\d+$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(new RegExp(`DEM-\\d{4}-\\d+ – ${objetDemande}`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Veille');
  });

  test('Création du projet depuis la demande', async () => {
    await page.getByRole('button', { name: /Créer le projet/ }).click();
    await confirmer(page);

    // La demande passe « Transformée en projet » et affiche le lien vers le projet créé
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Transformée en projet');
    const lien = page.getByRole('link', { name: /PRJ-\d{4}-\d+/ });
    await expect(lien).toBeVisible();
    projet = /PRJ-\d{4}-\d+/.exec(await lien.innerText())![0];

    // Fiche du projet : client et montant estimé repris de la demande
    await lien.click();
    await expect(page).toHaveURL(/\/fiche\/projet\/\d+/);
    await expect(page.getByRole('heading', { level: 2, name: `${projet} – ${objetDemande}` })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(TIERS.CLIENT) })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Devis', exact: true })).toBeVisible();
  });

  test('Création d’un devis rattaché au projet', async () => {
    devis = await creerDevis(page, { objet: objetDevis, projet, ligne });

    expect(devis.numero).toMatch(/^DV\d{4}-\d+$/);
    expect((await numeroDocument(page)).indice).toBe('A');
    await attendreStatut(page, 'Brouillon');
    await attendreTotalHt(page, '400,00');
    // Rattachement au projet conservé à l'enregistrement
    await expect(page.getByRole('group', { name: 'Rattachement' }).getByRole('textbox', { name: 'Projet', exact: true })).toHaveValue(projet);
  });

  test('Passage du devis à « Envoyé »', async () => {
    // Sans approbation interne, la validation du devis l'envoie au client
    await valider(page);
    await attendreStatut(page, 'Envoyé');
    await page.locator('[data-ouvrir-actions]').click();
    await expect(page.getByRole('menuitem', { name: 'Validé par le tiers', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Dévalider…', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('Création d’une révision du devis (indice B)', async () => {
    await actionDocument(page, 'Dévalider…');
    await saisirDansDialogue(page, 'Révision demandée par le client');
    await attendreMessage(page, /Nouvelle version \(indice B\)/);
    await attendreDocument(page);

    indiceB = idDocument(page);
    expect(indiceB).not.toBe(devis.id);
    expect(await numeroDocument(page)).toEqual({ numero: devis.numero, indice: 'B' });
    await attendreStatut(page, 'Brouillon');

    // Liste des devis du projet : l'indice A est remplacé, l'indice B en brouillon
    await page.goto(`/liste/devis?projet=${projet}`);
    const lignes = page.locator('table tbody tr').filter({ hasText: devis.numero });
    await expect(lignes).toHaveCount(2);
    await expect(lignes.filter({ hasText: 'Remplacé' })).toHaveCount(1);
    await expect(lignes.filter({ hasText: 'Brouillon' })).toHaveCount(1);
  });

  test('Copie d’un devis', async () => {
    await page.goto(`/liste/devis?projet=${projet}`);
    await page.locator('table tbody tr').filter({ hasText: devis.numero }).filter({ hasText: 'Brouillon' }).click();
    await page.getByRole('button', { name: 'Copier', exact: true }).click();
    await attendreMessage(page, /Copie créée : DV\d{4}-\d+/);
    await attendreDocument(page);

    // Nouveau devis : autre numéro, indice A, brouillon, même objet et mêmes lignes
    const copie = await numeroDocument(page);
    expect(copie.numero).not.toBe(devis.numero);
    expect(copie.indice).toBe('A');
    await attendreStatut(page, 'Brouillon');
    await expect(page.getByRole('textbox', { name: 'Objet', exact: true })).toHaveValue(objetDevis);
    await attendreTotalHt(page, '400,00');
  });

  test('Retour sur une version précédente du devis', async () => {
    await page.goto(`/document/${indiceB}`);
    await attendreDocument(page);

    // Modification enregistrée : 12 m² au lieu de 10
    await onglet(page, 'Lignes');
    await saisirCellule(page, ligneGrille(page, ligne.libelle), 'Qté', '12');
    await enregistrer(page);
    await attendreTotalHt(page, '480,00');

    // Historique (onglet Suivi) : la version à 400,00 est rechargée puis enregistrée
    await onglet(page, 'Suivi');
    const version = page.locator('#vue-suivi tbody tr').filter({ hasText: 'Modification' }).filter({ hasText: '400,00' }).first();
    await version.getByRole('button', { name: /Restaurer/ }).click();
    await confirmer(page);
    await attendreMessage(page, /rechargée/);
    await enregistrer(page);
    await attendreTotalHt(page, '400,00');
    await onglet(page, 'Lignes');
    expect(await texteCellule(page, ligneGrille(page, ligne.libelle), 'Qté')).toBe('10,00');
  });

  test('Validation du devis par le client', async () => {
    await valider(page);
    await attendreStatut(page, 'Envoyé');
    await actionDocument(page, 'Validé par le tiers');
    await attendreMessage(page, 'Document validé par le tiers');
    await attendreStatut(page, 'Validé');
    expect(await numeroDocument(page)).toEqual({ numero: devis.numero, indice: 'B' });
    // Un devis validé ne s'enregistre plus
    await expect(page.getByRole('button', { name: 'Enregistrer', exact: true })).toBeDisabled();
  });
});
