import { expect, type Page } from '@playwright/test';
import {
  attendreDocument, attendreStatut, saisirObjet, enregistrer, valider, onglet, ligneGrille, saisirCellule, cellule, attendreMessage, choisirDansListe,
} from './documents';

/**
 * Aides des scénarios du stock (e2e/stock-*.spec.ts). Données de démonstration attendues en base : articles gérés en
 * stock PARP20 (parpaing, unité u) et BA13 (plaque de plâtre) ; chantier CH-2026-001 (ne tient pas de stock : il consomme).
 * Chaque passage crée son propre dépôt : son stock part de zéro.
 */
export const STOCK = Object.freeze({
  PARPAING: { code: 'PARP20', libelle: 'Parpaing creux 20 × 20 × 50' },
  PLAQUE: { code: 'BA13', libelle: 'Plaque de plâtre BA13' },
  CHANTIER: 'CH-2026-001',
});

export type Lieu = { id: number; code: string; libelle: string };

/** Nouveau chantier marqué « Dépôt de stock » (fiche chantier), enregistré : identifiant et code attribué. */
export async function creerDepot(page: Page, libelle: string): Promise<Lieu> {
  await page.goto('/fiche/chantier/nouveau');
  const identification = page.getByRole('group', { name: 'Identification' });
  await expect(identification).toBeVisible({ timeout: 15000 });
  await identification.getByRole('textbox').nth(1).fill(libelle);
  await page.getByRole('group', { name: 'Stock' }).getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page).toHaveURL(/\/fiche\/chantier\/\d+/, { timeout: 15000 });
  const id = Number(new URL(page.url()).pathname.split('/').pop());
  await expect(identification.getByRole('textbox').first()).not.toHaveValue('');
  const code = await identification.getByRole('textbox').first().inputValue();
  return { id, code, libelle };
}

export type LigneArticle = { code: string; libelle: string; qte: string };

/**
 * Ligne d'article de la bibliothèque appelée par son code (colonne Code d'une nouvelle ligne avant le pied), puis sa
 * quantité.
 */
export async function ajouterArticle(page: Page, a: LigneArticle) {
  await onglet(page, 'Lignes');
  const ligne = ligneGrille(page, a.libelle);
  // Lignes d'élément sans libellé : celle d'un essai manqué, reprise plutôt qu'une nouvelle (elle bloquerait la
  // validation : nature obligatoire)
  const vides = page.locator('#vue-lignes div.grille:not(.metre-variables) > table tbody tr')
    .filter({ has: page.locator('td', { hasText: /^Élément$/ }) }).filter({ has: page.locator('td.col-libelle', { hasText: /^\s*$/ }) });
  await expect(async () => {
    // Document créé par la première ligne (adresse /document/<id>) : la page redessinée peut revenir sur l'entête
    await onglet(page, 'Lignes');
    if (await ligne.count()) return;
    // Fenêtre Bibliothèque restée d'un essai précédent : fermée
    const bib = page.getByRole('dialog', { name: 'Bibliothèque' });
    if (await bib.count()) { await page.keyboard.press('Escape'); await expect(bib).toHaveCount(0); }
    let cible = vides.first();
    if (!(await vides.count())) {
      await ligneGrille(page, 'Pied du document').locator('td.col-libelle').click({ timeout: 5000 });
      await page.keyboard.press('Control+Shift+Enter');
      await page.keyboard.press('Escape');
      cible = page.locator('#vue-lignes div.grille:not(.metre-variables) > table tbody tr.courante');
    }
    // Code saisi d'un bloc : frappe par frappe, la recherche de la bibliothèque peut s'ouvrir sur les premières lettres
    // et prendre la suite de la saisie.
    // Délais bornés : un essai bloqué (grille redessinée sous le clic) échoue et se rejoue au lieu d'attendre sans fin
    await (await cellule(page, cible, 'Code')).click({ timeout: 5000 });
    await page.keyboard.press('Enter');
    await page.locator('#vue-lignes input.editeur').fill(a.code, { timeout: 5000 });
    await page.keyboard.press('Enter');
    await expect(ligne).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 45000 });
  await onglet(page, 'Lignes');
  while (await vides.count()) {
    const n = await vides.count();
    await vides.first().locator('td.col-libelle').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Delete');
    await expect(vides).toHaveCount(n - 1);
  }
  await saisirCellule(page, ligne, 'Qté', a.qte);
}

/** Lieu de stock de l'entête (combo du bloc Stock : Origine, Destination…) choisi par son code. */
export async function choisirLieu(page: Page, champ: string, code: string) {
  await onglet(page, 'Entête');
  const combo = page.getByRole('group', { name: 'Stock' }).getByRole('combobox', { name: champ, exact: true });
  // Libellé précédé d'une icône (dépôt, lieu qui tient un stock) : option désignée par son code
  await combo.click();
  await combo.fill(code);
  await page.getByRole('option', { name: new RegExp(`${code} – `) }).first().click();
  await expect(combo).toHaveValue(new RegExp(`${code} – `));
}

export type TypeStock = 'S_ENTREE' | 'S_SORTIE' | 'S_TRANSFERT';

/** Pièce de stock saisie puis validée : objet, lieux (champ du bloc Stock → code du chantier), articles. */
export async function pieceStockValidee(page: Page, type: TypeStock, { objet, lieux, lignes }: { objet: string; lieux: Record<string, string>; lignes: LigneArticle[] }) {
  await page.goto(`/document/nouveau?type=${type}`);
  await attendreDocument(page);
  await attendreStatut(page, 'Brouillon');
  await saisirObjet(page, objet);
  for (const [champ, code] of Object.entries(lieux)) await choisirLieu(page, champ, code);
  for (const l of lignes) await ajouterArticle(page, l);
  await enregistrer(page);
  await valider(page);
  await attendreStatut(page, 'Validé');
}

/** Quantité d'un article dans l'état du stock d'un lieu (`/stock?lieu=`). */
export async function quantiteEnStock(page: Page, lieu: Lieu, libelle: string) {
  await page.goto(`/stock?lieu=${lieu.id}`);
  const ligne = page.locator('.page-stock table tbody tr').filter({ hasText: libelle });
  await expect(ligne).toBeVisible({ timeout: 15000 });
  return ligne;
}

export { attendreMessage, choisirDansListe };
