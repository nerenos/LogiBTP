import { expect, type Locator, type Page } from '@playwright/test';
import {
  attendreDocument, attendreStatut, attendreMessage, actionDocument, dialogue, idDocument, numeroDocument, onglet, enregistrer,
  ajouterIntervenant, ajouterLigne, rattacher, saisirObjet, valider, choisirDansListe, saisirCellule, ligneGrille, statutDocument, TIERS, type LignePrix,
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
    // Fenêtre lente à venir (types, définition, avertissements, document) : un second « Transformer… » trop tôt en
    // ouvrirait une deuxième, dont le choix resterait sans suite.
    await expect(dialogue(page).getByRole('button', { name: cible })).toBeVisible({ timeout: 10000 });
  }).toPass({ timeout: 40000 });
  const transformation = page.waitForResponse((r) => /\/api\/documents\/\d+\/transformer$/.test(r.url()) && r.request().method() === 'POST', { timeout: 20000 });
  await dialogue(page).getByRole('button', { name: cible }).click();
  expect((await transformation).ok()).toBe(true);
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
  // Grille chargée : au moins une ligne gardée affichée
  await expect(lignesElements(page).filter({ hasText: garde[0] }).first()).toBeVisible({ timeout: 15000 });
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
  let t = await tableauEtapes(page);
  const titres = async () => (await t.locator('thead th').allInnerTexts()).map((x) => x.trim());
  let i = (await titres()).findIndex((x) => x.includes(etape));
  if (i < 1) {
    // Étape masquée (sans date obligatoire) : « Toutes les étapes » affichées
    const avant = await t.locator('thead th').count();
    await page.locator('.etapes-ordre [data-tout]').click();
    t = await tableauEtapes(page);
    await expect(t.locator('thead th')).not.toHaveCount(avant);
    i = (await titres()).findIndex((x) => x.includes(etape));
  }
  if (i < 1) throw new Error(`Étape « ${etape} » absente du tableau : ${(await titres()).join(' | ')}`);
  return t.locator('tbody tr').filter({ has: page.locator('th', { hasText: ligne }) }).locator('td').nth(i - 1);
}

/**
 * Validation d'une étape (bouton « Valider » de sa colonne ; les étapes masquées qui la précèdent sont validées d'office).
 * Sans `refus` : l'étape porte ensuite sa date de validation et son auteur ; avec `refus` : message d'erreur attendu.
 */
export async function validerEtape(page: Page, etape: string, { auteur, refus }: { auteur?: string; refus?: RegExp } = {}) {
  if (refus) {
    await (await celluleEtape(page, 'Validation', etape)).getByRole('button', { name: /Valider/ }).click();
    await expect(page.getByText(refus).first()).toBeVisible({ timeout: 10000 });
    return;
  }
  await expect(async () => {
    const cellule = await celluleEtape(page, 'Validation', etape);
    // Clic perdu (tableau redessiné à son chargement) : bouton encore là après l'attente, rejoué
    const bouton = cellule.getByRole('button', { name: /Valider/ });
    if (await bouton.count()) await bouton.click({ timeout: 3000 });
    await expect(cellule).toContainText(/\d{2}\/\d{2}\/\d{2}/, { timeout: 6000 });
    if (auteur) await expect(cellule).toContainText(auteur, { timeout: 1000 });
  }).toPass({ timeout: 25000 });
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

export type Besoin = { libelle: string; qte: string; unite: string; nature: string };

/**
 * Ligne de besoin d'un ordre saisi sans source (vue « Quantités » : sans prix) : nouvelle ligne avant le pied, libellé,
 * nature, unité, quantité.
 */
export async function ajouterBesoin(page: Page, b: Besoin) {
  await onglet(page, 'Lignes');
  const ligne = ligneGrille(page, b.libelle);
  await expect(async () => {
    if (await ligne.count()) return;
    await ligneGrille(page, 'Pied du document').locator('td.col-libelle').click();
    await page.keyboard.press('Control+Shift+Enter');
    await page.keyboard.press('Escape');
    await saisirCellule(page, corpsGrille(page).locator('tr.courante'), 'Libellé', b.libelle);
    await expect(ligne).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await saisirCellule(page, ligne, 'Nature', b.nature);
  await saisirCellule(page, ligne, 'U', b.unite);
  await saisirCellule(page, ligne, 'Qté', b.qte);
}

/**
 * Nouvel ordre saisi sans source (`/document/nouveau?type=…`) : objet, chantier (obligatoire : un ordre porte sur un
 * seul chantier), besoins et articles ; enregistré.
 */
export async function creerOrdre(page: Page, type: string, { objet, chantier, besoins = [], articles = [] }: { objet: string; chantier: string; besoins?: Besoin[]; articles?: LigneArticle[] }) {
  await page.goto(`/document/nouveau?type=${type}`);
  await attendreDocument(page);
  await attendreStatut(page, 'Brouillon');
  await saisirObjet(page, objet);
  await rattacher(page, 'Chantier', chantier);
  for (const b of besoins) await ajouterBesoin(page, b);
  for (const a of articles) await ajouterArticle(page, a);
  await enregistrer(page);
  return pieceOuverte(page);
}

/** Prix d'une ligne de la pièce ouverte (colonne PV de la vue affichée), puis enregistrée. */
export async function saisirPrix(page: Page, prix: Record<string, string>) {
  await onglet(page, 'Lignes');
  for (const [libelle, pv] of Object.entries(prix)) await saisirCellule(page, ligneGrille(page, libelle), 'PV', pv);
  await enregistrer(page);
}

/**
 * Ordre saisi sans source, validé : « Transmis » au service, puis « Validé par le tiers » = pris en charge par le service
 * (un ordre issu d'un autre est pris en charge dès sa validation).
 */
export async function transmettreEtPrendreEnCharge(page: Page) {
  await valider(page);
  await attendreStatut(page, 'Transmis');
  await actionDocument(page, 'Validé par le tiers');
  await attendreMessage(page, /validé par le tiers/i);
  await attendreStatut(page, 'Pris en charge');
}

/** Pièce validée puis acceptée par le tiers (demande de prix, appel d'offres : statut Validé). */
export async function validerEtAccepterPiece(page: Page) {
  await valider(page);
  await accepterSiEnvoyee(page);
}

/**
 * Pièce validée : validée d'office ou envoyée au tiers selon le paramétrage de son type (scripts de la base appliqués ou
 * non) ; envoyée, elle est acceptée (« Validé par le tiers »).
 */
export async function accepterSiEnvoyee(page: Page) {
  await onglet(page, 'Entête');
  const statut = statutDocument(page);
  await expect(statut).toContainText(/^(Envoyé|Validé) · v\d+/);
  if (/^Envoyé/.test(await statut.innerText())) {
    await actionDocument(page, 'Validé par le tiers');
    await attendreMessage(page, /validé par le tiers/i);
  }
  await attendreStatut(page, 'Validé');
}
