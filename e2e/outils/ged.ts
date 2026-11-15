import { expect, type Locator, type Page } from '@playwright/test';
import { attendreMessage, dialogue } from './documents';
import { choisirDansCombo } from './planning';

/** Fichier déposé par un scénario (contenu en mémoire). */
export type Fichier = { name: string; mimeType: string; buffer: Buffer };

/** Fichier texte (contenu indexé : recherche plein texte). */
export const fichierTexte = (nom: string, contenu: string): Fichier => ({ name: nom, mimeType: 'text/plain', buffer: Buffer.from(contenu, 'utf8') });

/** Image PNG d'un pixel (classée « Photo » par la classification automatique). */
export const fichierPhoto = (nom: string): Fichier => ({
  name: nom, mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
});

/** Contenu du dossier courant de l'explorateur. */
export const contenu = (page: Page) => page.getByRole('region', { name: 'Contenu du dossier' });

/** Arbre des dossiers. */
export const arbre = (page: Page) => page.getByRole('navigation', { name: 'Dossiers' });

/** Panneau d'informations (dock) du document sélectionné. */
export const dock = (page: Page) => page.locator('.ged-dock');

/** Ligne d'un document ou d'un dossier dans le contenu. */
export const ligneGed = (page: Page, nom: string | RegExp) => contenu(page).getByRole('row', { name: nom });

/** Ouvre l'explorateur de la GED (`/ged`) à sa racine (documents sans élément, Affaires, Projets). */
export async function ouvrirGed(page: Page) {
  await page.goto('/ged');
  await expect(arbre(page).locator('.ged-noeud[data-chemin="racine"]')).toBeVisible({ timeout: 15000 });
  await expect(contenu(page)).toContainText(/dossier|document/);
}

/** Ouvre un dossier de l'arbre par son nom (nœud déjà affiché). */
export async function ouvrirDossierArbre(page: Page, nom: string) {
  await arbre(page).locator('.ged-noeud-nom', { hasText: nom }).first().click();
  await expect(arbre(page).locator('.ged-noeud.courant .ged-noeud-nom')).toHaveText(nom);
}

/** Ouvre un sous-dossier du dossier courant (double-clic dans le contenu). */
export async function ouvrirSousDossier(page: Page, nom: string | RegExp) {
  await ligneGed(page, nom).dblclick();
  await expect(arbre(page).locator('.ged-noeud.courant .ged-noeud-nom')).toContainText(nom);
}

/** Nouveau dossier dans le dossier courant (fenêtre de saisie du socle). */
export async function nouveauDossier(page: Page, nom: string) {
  await page.getByRole('button', { name: 'Nouveau dossier', exact: true }).click();
  const d = dialogue(page);
  await d.getByRole('textbox').fill(nom);
  await d.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(ligneGed(page, new RegExp(nom))).toBeVisible();
}

/**
 * Dépose des fichiers dans le dossier courant : fenêtre « Ajouter des documents » (titre proposé d'après le nom du
 * fichier), catégorie et mots-clés éventuels, enregistrée.
 */
export async function deposer(page: Page, fichier: Fichier, { categorie, motCle }: { categorie?: string; motCle?: string } = {}) {
  await page.locator('input[data-fichiers]').setInputFiles(fichier);
  const d = page.getByRole('dialog', { name: 'Ajouter des documents' });
  await expect(d).toBeVisible();
  if (categorie) await choisirDansCombo(page, d.getByRole('combobox', { name: 'Catégorie', exact: true }), categorie);
  if (motCle) {
    await d.getByRole('textbox', { name: 'Mots-clés', exact: true }).fill(motCle);
    await d.getByRole('textbox', { name: 'Mots-clés', exact: true }).press('Enter');
  }
  await d.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await attendreMessage(page, /1 document enregistré/);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

/** Sélectionne un document du contenu : son entête d'actions et son panneau d'informations s'affichent. */
export async function selectionner(page: Page, titre: string) {
  await ligneGed(page, new RegExp(titre)).click();
  await expect(dock(page).getByRole('tab', { name: 'Informations' })).toBeVisible();
  await expect(dock(page).getByRole('textbox', { name: 'Titre', exact: true })).toHaveValue(titre);
}

/** Bouton d'action du document sélectionné (entête de la visionneuse). */
export const actionDocument = (page: Page, nom: string | RegExp): Locator => page.locator('.ged-visu-actions').getByRole('button', { name: nom });

/** Onglet du panneau d'informations : « Versions (n) », « Historique (n) »… */
export const ongletDock = (page: Page, nom: RegExp) => dock(page).getByRole('tab', { name: nom });

/** Recherche (plein texte depuis la racine) : saisie puis Entrée. */
export async function rechercherGed(page: Page, texte: string) {
  const champ = page.getByRole('searchbox', { name: 'Filtrer le dossier ou rechercher' });
  await champ.fill(texte);
  await champ.press('Enter');
}

/** Bascule d'un filtre de la barre (documents supprimés, archivés…) dans l'état voulu. */
export async function filtre(page: Page, nom: 'Afficher les documents supprimés' | 'Documents archivés', actif: boolean) {
  const b = page.getByRole('button', { name: nom, exact: true });
  if ((await b.getAttribute('aria-pressed')) !== String(actif)) await b.click();
  await expect(b).toHaveAttribute('aria-pressed', String(actif));
}
