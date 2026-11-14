import { expect, type Locator, type Page } from '@playwright/test';
import {
  attendreDocument, attendreStatut, attendreMessage, actionDocument, dialogue, idDocument, numeroDocument, onglet, enregistrer,
  ajouterIntervenant, ajouterLigne, rattacher, saisirObjet, valider, choisirDansListe, TIERS, type LignePrix,
} from './documents';
import { ajouterArticle, type LigneArticle } from './stock';
import { choisirOption } from './sous-traitance';

/**
 * Aides des scénarios des ordres (module Exécution, e2e/ordres-*.spec.ts) : devis vendu jusqu'au marché, ordre
 * d'exécution lancé depuis la fiche du marché, lignes gardées dans un ordre suivant, tableau des étapes de l'entête
 * (validation, contrôle du N+1), panneau « Exécution », comptes et service du contrôle du N+1.
 * Données de démonstration attendues en base : client « SCI Les Érables », natures FABAT, MAT, ST, MO_POSE, article
 * PARP20, salariés « Noël Vincent » et « Jérôme Boyer » ; états des types d'ordres de démonstration (db/209 : contrôle du
 * N+1 bloquant sur le lancement de l'ordre d'exécution).
 */

export type Piece = { id: number; numero: string };

/** Pièce affichée : identifiant (adresse) et numéro de l'entête. */
export async function pieceOuverte(page: Page): Promise<Piece> {
  return { id: idDocument(page), numero: (await numeroDocument(page)).numero };
}

/** Ouvre une pièce par son identifiant. */
export async function ouvrir(page: Page, id: number) {
  await page.goto(`/document/${id}`);
  await attendreDocument(page);
}

export type Vente = { chantier: { id: number; code: string }; marche: { id: number; code: string }; commande: Piece };

/**
 * Vente complète : devis (lignes de prix et articles de la bibliothèque) accepté par le client, transformé en commande,
 * validée dans un nouveau chantier et un nouveau marché.
 */
export async function vendre(page: Page, { objet, chantier, lignes, articles = [] }: { objet: string; chantier: string; lignes: LignePrix[]; articles?: LigneArticle[] }): Promise<Vente> {
  await page.goto('/liste/devis');
  await page.getByRole('button', { name: 'Devis client', exact: true }).click();
  await attendreDocument(page);
  await attendreStatut(page, 'Brouillon');
  await saisirObjet(page, objet);
  await ajouterIntervenant(page, TIERS.CLIENT);
  for (const l of lignes) await ajouterLigne(page, l);
  for (const a of articles) await ajouterArticle(page, a);
  await enregistrer(page);
  await valider(page);
  await actionDocument(page, 'Validé par le tiers');
  await attendreStatut(page, 'Validé');

  await transformerVers(page, /Commande client/);
  await actionDocument(page, 'Valider');
  const d = dialogue(page);
  await expect(d.getByRole('heading', { name: /Marché de la commande/ })).toBeVisible();
  await d.getByRole('group', { name: 'Nouveau chantier' }).getByRole('textbox', { name: 'Libellé', exact: true }).fill(chantier);
  await d.getByRole('button', { name: 'Valider la commande', exact: true }).click();
  await attendreMessage(page, /Document validé : CC\d{4}-\d+/);
  await attendreStatut(page, 'Validé');
  const commande = await pieceOuverte(page);
  const ratt = page.getByRole('group', { name: 'Rattachement' });
  const lien = async (type: string) => Number((await ratt.locator(`a[href*="/fiche/${type}/"]`).first().getAttribute('href'))!.split('/').pop());
  return {
    commande,
    chantier: { id: await lien('chantier'), code: await ratt.getByRole('textbox', { name: 'Chantier', exact: true }).inputValue() },
    marche: { id: await lien('marche'), code: await ratt.getByRole('textbox', { name: 'Marché', exact: true }).inputValue() },
  };
}

/** Ordre d'exécution lancé depuis l'onglet Gestion de la fiche du marché (commandes du marché reprises). */
export async function lancerOrdreExecution(page: Page, marcheId: number) {
  await page.goto(`/fiche/marche/${marcheId}`);
  await page.getByRole('navigation').getByRole('button', { name: 'Gestion', exact: true }).click();
  await page.getByRole('button', { name: /Ordre d'exécution$/ }).click();
  await attendreMessage(page, /Ordre d'exécution OE\d{4}-\d+ créé/);
  await attendreDocument(page);
  await attendreStatut(page, 'Brouillon');
  return pieceOuverte(page);
}

/**
 * Transformation par la fenêtre de choix (tout le reliquat de l'étape de la cible) : attend l'ouverture du document créé
 * (adresse changée : l'ancienne page reste un instant dans le DOM).
 */
export async function transformerVers(page: Page, cible: RegExp) {
  const avant = page.url();
  // Page tout juste ouverte : le menu peut répondre avant que l'action soit prête (fenêtre de choix reprise sinon).
  await expect(async () => {
    if (!(await page.locator('dialog[open]').count())) await actionDocument(page, 'Transformer…');
    await expect(dialogue(page).getByRole('button', { name: cible })).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 30000 });
  await dialogue(page).getByRole('button', { name: cible }).click();
  await expect(page).not.toHaveURL(avant, { timeout: 15000 });
  await attendreDocument(page);
  return pieceOuverte(page);
}

const corpsGrille = (page: Page) => page.locator('#vue-lignes div.grille:not(.metre-variables) > table tbody');
const lignesElements = (page: Page) => corpsGrille(page).locator('tr').filter({ has: page.locator('td', { hasText: /^Élément$/ }) });

/**
 * Ordre repris d'un autre (tout le reliquat de l'étape) : seules les lignes dont le libellé contient l'un des textes sont
 * gardées, les autres supprimées (Suppr sur la ligne sélectionnée) ; enregistré.
 */
export async function garderLignes(page: Page, garde: string[]) {
  await onglet(page, 'Lignes');
  for (;;) {
    const textes = await lignesElements(page).allInnerTexts();
    const i = textes.findIndex((t) => !garde.some((g) => t.includes(g)));
    if (i < 0) break;
    await lignesElements(page).nth(i).locator('td.col-libelle').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Delete');
    await expect(lignesElements(page)).toHaveCount(textes.length - 1);
  }
  expect(await lignesElements(page).count()).toBe(garde.length);
  await enregistrer(page);
}

/** Libellés des lignes d'éléments de la grille (onglet Lignes). */
export async function libellesLignes(page: Page) {
  await onglet(page, 'Lignes');
  return lignesElements(page).allInnerTexts();
}

// ------------------------------------------------------------------ étapes et exécution de l'ordre

/** Tableau des étapes de l'ordre (panneau Exécution de l'entête). */
export async function tableauEtapes(page: Page) {
  await onglet(page, 'Entête');
  const t = page.locator('.etapes-ordre table.etapes-tableau');
  await expect(t).toBeVisible({ timeout: 15000 });
  return t;
}

/** Cellule d'une étape (colonne désignée par son libellé) dans une ligne du tableau : Validation, Contrôle N+1… */
export async function celluleEtape(page: Page, ligne: 'Prévisionnelle' | 'Validation' | 'Contrôle N+1' | 'Ressource', etape: string): Promise<Locator> {
  const t = await tableauEtapes(page);
  const titres = (await t.locator('thead th').allInnerTexts()).map((x) => x.trim());
  const i = titres.findIndex((x) => x.includes(etape));
  if (i < 1) throw new Error(`Étape « ${etape} » absente du tableau : ${titres.join(' | ')}`);
  return t.locator('tbody tr').filter({ has: page.locator('th', { hasText: ligne }) }).locator('td').nth(i - 1);
}

/**
 * Validation d'une étape (bouton « Valider » de sa colonne ; les étapes masquées qui la précèdent sont validées d'office).
 * Sans `refus` : l'étape porte ensuite sa date de validation et son auteur ; avec `refus` : message d'erreur attendu.
 */
export async function validerEtape(page: Page, etape: string, { auteur, refus }: { auteur?: string; refus?: RegExp } = {}) {
  await (await celluleEtape(page, 'Validation', etape)).getByRole('button', { name: /Valider/ }).click();
  if (refus) {
    await expect(page.getByText(refus).first()).toBeVisible({ timeout: 10000 });
    return;
  }
  await expect(async () => {
    const cellule = await celluleEtape(page, 'Validation', etape);
    await expect(cellule).toContainText(/\d{2}\/\d{2}\/\d{2}/, { timeout: 1000 });
    if (auteur) await expect(cellule).toContainText(auteur, { timeout: 1000 });
  }).toPass({ timeout: 15000 });
}

/** Contrôle du N+1 d'une étape validée (case de la ligne « Contrôle N+1 ») ; la case porte ensuite la date et l'auteur. */
export async function controlerEtape(page: Page, etape: string, auteur: string) {
  await (await celluleEtape(page, 'Contrôle N+1', etape)).getByRole('checkbox').check();
  await expect(async () => {
    const cellule = await celluleEtape(page, 'Contrôle N+1', etape);
    await expect(cellule.getByRole('checkbox')).toBeChecked({ timeout: 1000 });
    await expect(cellule).toContainText(auteur, { timeout: 1000 });
  }).toPass({ timeout: 15000 });
}

/** Panneau « Exécution » de l'entête d'un ordre. */
export const panneauExecution = (page: Page) => page.getByRole('group', { name: 'Exécution', exact: true });

/** État d'exécution affiché par le panneau (combo État : « 🔄 En cours », « ✅ Terminé »…). */
export async function attendreEtatExecution(page: Page, etat: RegExp) {
  await onglet(page, 'Entête');
  await expect(async () => {
    await page.reload();
    await attendreDocument(page);
    await expect(panneauExecution(page).locator('[data-etat]').getByRole('combobox')).toHaveValue(etat, { timeout: 3000 });
  }).toPass({ timeout: 20000 });
}

/** Service porteur de l'ordre (combo du panneau Exécution), puis « Enregistrer l'exécution ». */
export async function choisirServiceOrdre(page: Page, service: string) {
  await onglet(page, 'Entête');
  const p = panneauExecution(page);
  await choisirOption(page, p.locator('[data-service]').getByRole('combobox'), service);
  await p.getByRole('button', { name: "Enregistrer l'exécution", exact: true }).click();
  await attendreMessage(page, /Exécution enregistrée/);
}

/** Fournisseur ou sous-traitant d'une pièce issue d'un ordre (annuaire vide : tiers de la première ligne), puis enregistrée. */
export async function choisirTiers(page: Page, tiers: string) {
  await onglet(page, 'Entête');
  const annuaire = page.getByRole('group', { name: 'Annuaire du document' });
  await expect(annuaire.locator('tbody')).toHaveText(/Aucun intervenant/);
  await annuaire.getByRole('button', { name: 'Intervenant', exact: true }).click();
  await annuaire.locator('tbody tr').last().getByRole('combobox', { name: /Rechercher un tiers/ }).press('F4');
  await choisirDansListe(page, tiers);
  // Choisi, le tiers d'un document issu d'une transformation est aussitôt figé (champ désactivé)
  await expect(annuaire.locator('tbody tr').first().getByRole('combobox').nth(1)).toHaveValue(tiers);
  await enregistrer(page);
}

/** Rattachement par code (réexport pour les scénarios). */
export { rattacher };
