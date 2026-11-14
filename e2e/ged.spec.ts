import { test, expect, type Page } from '@playwright/test';
import { seConnecter, TAG_API } from './outils/connexion';
import { suffixe, patienterSurLimiteDebit, attendreMessage, dialogue } from './outils/documents';
import { choisirDansCombo } from './outils/planning';
import {
  fichierTexte, fichierPhoto, contenu, dock, ligneGed, ouvrirGed, ouvrirDossierArbre, ouvrirSousDossier, nouveauDossier, deposer, selectionner, actionDocument,
  ongletDock, rechercherGed, filtre,
} from './outils/ged';

/**
 * GED : explorateur des documents (`/ged`).
 * - Dossier créé à la racine, renommé ; dépôt d'un fichier texte (catégorie, mot-clé) : listé, informations au panneau ;
 * - nouvelle version (édition) et étape « Envoi » avec commentaire : versions et historique ; résumé modifié ;
 * - recherche plein texte depuis la racine (mot du contenu) ;
 * - suppression (masquage) : hors des listes, visible avec le filtre des supprimés, restauré ;
 * - archivage : hors des listes, visible avec le filtre des archivés, sorti de l'archive ;
 * - dépôt d'une photo dans le dossier d'une affaire : liée à l'affaire, classée « Photo » automatiquement ;
 * - dossier vide supprimé ; chaîne du coffre-fort vérifiée (lecture seule : aucun document mis au coffre, il ne pourrait
 *   plus être supprimé).
 * Noms uniques par passage ; documents jamais purgés.
 */
test.describe.serial('GED : explorateur des documents', { tag: TAG_API }, () => {
  test.describe.configure({ timeout: 120000 });

  const s = suffixe();
  const dossier = `Dossier e2e ${s}`;
  const renomme = `Réunions e2e ${s}`;
  const titre = `Compte rendu e2e ${s}`;
  const mot = `releve${s}beton`;
  const photo = `Photo façade e2e ${s}`;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await patienterSurLimiteDebit(page);
    await seConnecter(page, 'admin');
  });

  test.afterAll(async () => { await page.close(); });

  /** Ouvre le dossier du scénario depuis la racine. */
  async function ouvrirDossier() {
    await ouvrirGed(page);
    await ouvrirDossierArbre(page, renomme);
  }

  test('Dossier créé et renommé, fichier déposé avec catégorie et mot-clé', async () => {
    await ouvrirGed(page);
    await nouveauDossier(page, dossier);
    await ouvrirSousDossier(page, new RegExp(dossier));
    await contenu(page).getByRole('button', { name: `Renommer « ${dossier} » (F2)` }).click();
    const d = dialogue(page);
    await d.getByRole('textbox').fill(renomme);
    await d.getByRole('button', { name: 'OK', exact: true }).click();
    await attendreMessage(page, 'Dossier renommé');
    await expect(page.locator('.ged-noeud.courant .ged-noeud-nom')).toHaveText(renomme);

    await deposer(page, fichierTexte(`${titre}.txt`, `Réunion de chantier du ${s} : ${mot} coulé.`), { categorie: 'Courrier', motCle: 'e2e' });
    const ligne = ligneGed(page, new RegExp(titre));
    await expect(ligne).toContainText('Courrier');
    await selectionner(page, titre);
    await expect(dock(page).getByRole('combobox', { name: 'Catégorie', exact: true })).toHaveValue('Courrier');
    await expect(dock(page)).toContainText('aucun · classé dans un dossier');
    await expect(ongletDock(page, /^Versions \(1\)/)).toBeVisible();
  });

  test('Nouvelle version, étape « Envoi », résumé modifié', async () => {
    await ouvrirDossier();
    await selectionner(page, titre);
    await page.locator('input[data-version]').setInputFiles(fichierTexte(`${titre} v2.txt`, `Version 2 : ${mot} armé.`));
    await attendreMessage(page, 'Nouvelle version enregistrée');
    await expect(ongletDock(page, /^Versions \(2\)/)).toBeVisible();

    await actionDocument(page, /^Enregistrer une étape/).click();
    const etape = page.locator('.ged-etape-saisie');
    await expect(etape).toBeVisible();
    await choisirDansCombo(page, etape.getByRole('combobox'), 'Envoi');
    await etape.locator('[data-etape-commentaire]').fill(`Envoyé au client ${s}`);
    await etape.locator('[data-action="etape-ok"]').click();
    await attendreMessage(page, 'Étape « Envoi » enregistrée');
    await expect(ligneGed(page, new RegExp(titre))).toContainText('Envoi');
    await ongletDock(page, /^Historique \(1\)/).click();
    await expect(dock(page)).toContainText(`Envoyé au client ${s}`);

    await ongletDock(page, /^Informations/).click();
    const resume = dock(page).getByRole('textbox', { name: 'Résumé', exact: true });
    await resume.fill(`Compte rendu de la réunion ${s}`);
    await resume.press('Tab');
    await attendreMessage(page, 'Informations enregistrées');
  });

  test('Recherche plein texte depuis la racine', async () => {
    await ouvrirGed(page);
    await rechercherGed(page, mot);
    await expect(ligneGed(page, new RegExp(titre))).toBeVisible({ timeout: 15000 });
    await expect(contenu(page)).toContainText('1 document');
  });

  test('Suppression (masquage), document retrouvé avec le filtre, restauré', async () => {
    await ouvrirDossier();
    await selectionner(page, titre);
    await actionDocument(page, /^Supprimer \(masqué/).click();
    await dialogue(page).getByRole('button', { name: 'Supprimer', exact: true }).click();
    await attendreMessage(page, 'Document supprimé (masqué)');
    await expect(ligneGed(page, new RegExp(titre))).toHaveCount(0);

    await filtre(page, 'Afficher les documents supprimés', true);
    await expect(ligneGed(page, new RegExp(titre))).toHaveClass(/supprime/);
    await ligneGed(page, new RegExp(titre)).click();
    await actionDocument(page, 'Restaurer').click();
    await attendreMessage(page, 'Document restauré');
    await filtre(page, 'Afficher les documents supprimés', false);
    await expect(ligneGed(page, new RegExp(titre))).toBeVisible();
    await expect(ligneGed(page, new RegExp(titre))).not.toHaveClass(/supprime/);
  });

  test('Archivage, document retrouvé avec le filtre, sorti de l’archive', async () => {
    await ouvrirDossier();
    await selectionner(page, titre);
    await actionDocument(page, /^Archiver \(sort/).click();
    await dialogue(page).getByRole('button', { name: 'OK', exact: true }).click();
    await attendreMessage(page, '1 document archivé');
    await expect(ligneGed(page, new RegExp(titre))).toHaveCount(0);

    await filtre(page, 'Documents archivés', true);
    await expect(ligneGed(page, new RegExp(titre))).toContainText('🗄');
    await ligneGed(page, new RegExp(titre)).click();
    await actionDocument(page, "Sortir de l'archive").click();
    await attendreMessage(page, "Document sorti de l'archive");
    await filtre(page, 'Documents archivés', false);
    await expect(ligneGed(page, new RegExp(titre))).toBeVisible();
  });

  test('Photo déposée dans le dossier d’une affaire : liée à l’affaire, classée « Photo »', async () => {
    await ouvrirGed(page);
    await ouvrirDossierArbre(page, 'Affaires');
    await ouvrirSousDossier(page, /AFF-2026-001/);
    await deposer(page, fichierPhoto(`${photo}.png`));
    await selectionner(page, photo);
    await expect(dock(page).getByRole('combobox', { name: 'Catégorie', exact: true })).toHaveValue('Photo');
    await expect(dock(page)).toContainText(/Élément lié\s*affaire/);
    await expect(dock(page)).toContainText('catégorie proposée : Photo');
  });

  test('Dossier vide supprimé, chaîne du coffre-fort vérifiée', async () => {
    const vide = `Vide e2e ${s}`;
    await ouvrirGed(page);
    await nouveauDossier(page, vide);
    await ouvrirSousDossier(page, new RegExp(vide));
    await contenu(page).getByRole('button', { name: `Supprimer le dossier « ${vide} » (vide)` }).click();
    await dialogue(page).getByRole('button', { name: /OK|Supprimer/ }).click();
    await attendreMessage(page, 'Dossier supprimé');
    await expect(page.locator('.ged-noeud-nom', { hasText: vide })).toHaveCount(0);

    await page.getByRole('button', { name: 'Vérifier toute la chaîne du coffre-fort', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: /Coffre-fort intègre/ }).first().or(dialogue(page).filter({ hasText: /Coffre-fort intègre/ }))).toBeVisible({ timeout: 15000 });
  });
});
