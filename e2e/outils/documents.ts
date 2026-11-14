import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Aides des scénarios du cycle commercial (e2e/commercial-*.spec.ts) : page document (entête, grille des lignes,
 * menu ▾ du bouton Enregistrer, transformation), fenêtres du socle (`<dialog>`), messages du bandeau.
 * Données de démonstration attendues en base (scripts du manifeste) : clients « SCI Les Érables » et « Rhône Habitat »,
 * nature « MO ».
 */

/** Tiers de la base de démonstration employés par les scénarios. */
export const TIERS = Object.freeze({
  CLIENT: 'SCI Les Érables',
  PAYEUR: 'Rhône Habitat',
});

/** Nature des lignes de prix (obligatoire pour valider). */
export const NATURE = 'MO';

/**
 * Limite de débit de l'API (socle `LimiteDebit` : 50 requêtes d'avance, puis 10 par seconde et par session) : un
 * scénario enchaîne les écrans bien plus vite qu'un utilisateur et l'ouverture d'un document en lance des dizaines.
 * Les réponses 429 sont rejouées après l'attente demandée (`Retry-After`) ; le flux d'événements (`/api/diffusion`)
 * n'est pas intercepté.
 */
export async function patienterSurLimiteDebit(page: Page) {
  await page.route(/\/api\/(?!diffusion)/, async (route) => {
    try {
      for (let essai = 0; ; essai++) {
        const reponse = await route.fetch();
        if (reponse.status() !== 429 || essai >= 10) { await route.fulfill({ response: reponse }); return; }
        const attente = Number(reponse.headers()['retry-after'] ?? '1') || 1;
        await new Promise((r) => setTimeout(r, attente * 1000));
      }
    } catch {
      // Requête abandonnée par la page (navigation, fermeture) : plus rien à répondre.
    }
  });
}

/** Suffixe unique d'un passage (données distinctes d'un passage à l'autre). */
export const suffixe = () => Date.now().toString().slice(-6);

/** Message de succès du bandeau (historique des messages). */
export async function attendreMessage(page: Page, texte: RegExp | string) {
  await expect(page.getByRole('status').filter({ hasText: texte }).first()).toBeVisible({ timeout: 10000 });
}

/** Fenêtre `<dialog>` ouverte (la dernière). */
export const dialogue = (page: Page) => page.locator('dialog[open]').last();

/** Répond à une confirmation du socle (`confirmer`) : OK ou Annuler. */
export async function confirmer(page: Page, ok = true) {
  const d = dialogue(page);
  await expect(d).toBeVisible();
  await d.getByRole('button', { name: ok ? 'OK' : 'Annuler', exact: true }).click();
}

/** Répond à une saisie du socle (`saisir`) : texte puis OK. */
export async function saisirDansDialogue(page: Page, valeur: string) {
  const d = dialogue(page);
  await expect(d).toBeVisible();
  await d.getByRole('textbox').fill(valeur);
  await d.getByRole('button', { name: 'OK', exact: true }).click();
}

/**
 * Choisit une ligne dans une liste de choix en fenêtre (module Liste : tiers, rattachements…) : recherche puis
 * double-clic sur la ligne.
 */
export async function choisirDansListe(page: Page, texte: string) {
  const d = dialogue(page);
  await expect(d).toBeVisible();
  await d.getByRole('searchbox').fill(texte);
  const ligne = d.locator('tbody tr').filter({ hasText: texte }).first();
  await expect(ligne).toBeVisible();
  await ligne.dblclick();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

// ------------------------------------------------------------------ page document

/** Document chargé : barre d'actions présente, éventuel « Chargement… » terminé. */
export async function attendreDocument(page: Page) {
  await expect(page).toHaveURL(/\/document\/\d+/);
  // Pendant l'ouverture d'un document depuis un autre, l'ancienne page reste un instant dans le DOM.
  await expect(page.locator('div.page.page-document')).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator('[data-ouvrir-actions]')).toBeVisible({ timeout: 15000 });
  await onglet(page, 'Entête');
}

/** Identifiant du document ouvert (adresse `/document/<id>`). */
export const idDocument = (page: Page) => Number(new URL(page.url()).pathname.split('/').pop());

/** Numéro et indice affichés en tête de l'entête : « DV2026-00001 · indice A ». */
export async function numeroDocument(page: Page) {
  await onglet(page, 'Entête');
  const t = (await page.locator('#vue-entete .entete-titre .numero').innerText()).trim();
  const m = /^(\S+)(?: · indice (\S+))?/.exec(t);
  return { numero: m?.[1] ?? t, indice: m?.[2] ?? null };
}

/** Libellé du statut de l'entête (« Brouillon », « Envoyé », « Validé »…), sans la version. */
export const statutDocument = (page: Page) => page.locator('#vue-entete .entete-titre .statut');

export async function attendreStatut(page: Page, libelle: string) {
  await onglet(page, 'Entête');
  await expect(statutDocument(page)).toContainText(new RegExp(`^${libelle} · v\\d+`));
}

/** Total HT du tableau des totaux de l'entête (onglet Entête affiché). */
export async function attendreTotalHt(page: Page, montant: string) {
  await onglet(page, 'Entête');
  await expect(page.locator('#vue-entete table.totaux tr').filter({ hasText: 'Total HT' }).locator('td')).toHaveText(montant);
}

export async function onglet(page: Page, nom: 'Entête' | 'Règlements' | 'Lignes' | 'Suivi') {
  const tab = nom === 'Suivi' ? page.getByRole('tab', { name: /notes, tâches et courriels/ }) : page.getByRole('tab', { name: nom, exact: true });
  await tab.click({ timeout: 10000 });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  if (nom === 'Entête') await expect(page.locator('#vue-entete .entete-titre .numero')).not.toBeEmpty();
}

export async function enregistrer(page: Page) {
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await attendreMessage(page, /Enregistré \(version \d+\)/);
}

/** Action du menu ▾ du bouton Enregistrer (Valider, Transformer…, Dévalider…, Annuler par avoir…). */
export async function actionDocument(page: Page, nom: string) {
  // Une page masquée (fenêtre précédente gardée par l'application) peut rester dans le DOM : menu de la page affichée.
  const menu = page.locator('[data-menu-actions]:not([hidden])');
  if (!(await menu.count())) await page.locator('[data-ouvrir-actions]').filter({ visible: true }).last().click();
  await menu.getByRole('menuitem', { name: nom, exact: true }).click();
}

/** Valide le document (enregistré au préalable) ; les avertissements de gestion éventuels sont acceptés. */
export async function valider(page: Page) {
  await actionDocument(page, 'Valider');
  // Document modifié depuis l'enregistrement (contact repris du tiers choisi…) : « Enregistrer puis valider ? » accepté
  const confirmation = dialogue(page).getByText(/doit d'abord être enregistré/);
  const valide = page.getByRole('status').filter({ hasText: /Document validé/ }).first();
  // Message du bandeau remplacé par un suivant (avertissement, exécution…) : statut de l'entête sorti du brouillon
  const sortiDuBrouillon = async () => {
    await onglet(page, 'Entête');
    await expect(statutDocument(page)).not.toContainText(/^Brouillon/);
  };
  try {
    await expect(confirmation.or(valide)).toBeVisible({ timeout: 10000 });
  } catch {
    await sortiDuBrouillon();
    return;
  }
  if (!(await confirmation.isVisible())) return;
  await dialogue(page).getByRole('button', { name: 'OK', exact: true }).click();
  await attendreMessage(page, /Document validé/).catch(sortiDuBrouillon);
}

/** Transformation par la fenêtre de choix (cible désignée par le début de son libellé) ; ouvre le document créé. */
export async function transformer(page: Page, cible: RegExp) {
  const avant = page.url();
  await actionDocument(page, 'Transformer…');
  await dialogue(page).getByRole('button', { name: cible }).click();
  await expect(page).not.toHaveURL(avant);
  await attendreDocument(page);
}

/**
 * Objet de l'entête, validé par Tab : l'entête se redessine à la validation d'un champ, avant toute autre saisie
 * (sinon la saisie suivante, faite dans l'ancien rendu, est perdue).
 */
export async function saisirObjet(page: Page, objet: string) {
  const champ = page.getByRole('textbox', { name: 'Objet', exact: true });
  await champ.fill(objet);
  await champ.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Objet', exact: true })).toHaveValue(objet);
}

/** Rattachement de l'entête par code (Projet, Affaire, Chantier, Marché). */
export async function rattacher(page: Page, niveau: 'Projet' | 'Affaire' | 'Chantier' | 'Marché', code: string) {
  const champ = page.getByRole('group', { name: 'Rattachement' }).getByRole('textbox', { name: niveau, exact: true });
  // L'entête se redessine quand un champ précédent est validé (perte du focus) : saisie reprise si elle est perdue.
  await expect(async () => {
    await champ.fill(code);
    await champ.press('Enter');
    await expect(champ).toHaveValue(code, { timeout: 1000 });
  }).toPass({ timeout: 10000 });
}

/**
 * Intervenant de l'annuaire du document : nouvelle ligne, fonction (la première ligne est le client ou fournisseur,
 * fonction imposée), tiers choisi dans la liste (F4).
 */
export async function ajouterIntervenant(page: Page, tiers: string, fonction?: string) {
  const annuaire = page.getByRole('group', { name: 'Annuaire du document' });
  await annuaire.getByRole('button', { name: 'Intervenant', exact: true }).click();
  const ligne = annuaire.locator('tbody tr').last();
  if (fonction) {
    const combo = ligne.getByRole('combobox').first();
    await combo.click();
    await combo.fill(fonction);
    await page.getByRole('option', { name: fonction, exact: true }).click();
  }
  await ligne.getByRole('combobox', { name: /Rechercher un tiers/ }).press('F4');
  await choisirDansListe(page, tiers);
  await expect(ligne.getByRole('combobox', { name: /Rechercher un tiers/ })).toHaveValue(tiers);
}

/** Vue de colonnes de la grille des lignes (combo de la barre). */
export async function vueColonnes(page: Page, vue: RegExp) {
  await page.getByRole('combobox', { name: /Vue de colonnes/ }).click();
  await page.getByRole('option', { name: vue }).click();
}

// ------------------------------------------------------------------ grille des lignes

const grille = (page: Page) => page.locator('#vue-lignes div.grille:not(.metre-variables) > table');

/** Ligne de la grille contenant un texte (libellé). */
export const ligneGrille = (page: Page, texte: string) => grille(page).locator('tbody tr').filter({ hasText: texte }).first();

/** Cellule d'une ligne par le titre de sa colonne (la vue de colonnes décide de l'ordre). */
export async function cellule(page: Page, ligne: Locator, colonne: string) {
  const titres = (await grille(page).locator('thead th').allInnerTexts()).map((t) => t.split('\n')[0].trim());
  // Titre exact d'abord (« Qté » avant « Qté parent »), sinon titre suivi d'un bouton (« Libellé ⇔ »).
  const exact = titres.indexOf(colonne);
  const i = exact >= 0 ? exact : titres.findIndex((t) => t.startsWith(`${colonne} `));
  if (i < 0) throw new Error(`Colonne « ${colonne} » absente de la vue : ${titres.join(' | ')}`);
  // Première colonne : poignée sans data-col.
  return ligne.locator(`td[data-col="${i - 1}"]`);
}

/** Saisie d'une cellule : clic, Entrée (édition), remplacement du texte, Entrée (validation). */
export async function saisirCellule(page: Page, ligne: Locator, colonne: string, valeur: string) {
  await (await cellule(page, ligne, colonne)).click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(valeur);
  await page.keyboard.press('Enter');
}

export async function texteCellule(page: Page, ligne: Locator, colonne: string) {
  // Espaces insécables des milliers (« 3 600,00 ») ramenées à des espaces simples.
  return (await (await cellule(page, ligne, colonne)).innerText()).replace(/\s+/g, ' ').trim();
}

export type LignePrix = { libelle: string; qte: string; unite: string; pv: string; nature?: string };

/**
 * Ligne d'élément ajoutée avant le pied (Ctrl+Maj+Entrée sur le pied), dans la vue « Complet » : libellé, nature,
 * unité, quantité, prix de vente.
 */
export async function ajouterLigne(page: Page, l: LignePrix) {
  await onglet(page, 'Lignes');
  const pied = ligneGrille(page, 'Pied du document');
  await pied.locator('td.col-libelle').click();
  await page.keyboard.press('Control+Shift+Enter');
  await page.keyboard.press('Escape');
  const nouvelle = grille(page).locator('tbody tr.courante');
  const ligne = ligneGrille(page, l.libelle);
  // Saisie du libellé reprise si elle est perdue (grille redessinée juste après l'insertion de la ligne).
  await expect(async () => {
    if (await ligne.count()) return;
    await saisirCellule(page, nouvelle, 'Libellé', l.libelle);
    await expect(ligne).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await saisirCelluleVerifiee(page, ligne, 'Nature', l.nature ?? NATURE);
  await saisirCelluleVerifiee(page, ligne, 'U', l.unite);
  await saisirCelluleVerifiee(page, ligne, 'Qté', l.qte);
  await saisirCelluleVerifiee(page, ligne, 'PV', l.pv);
  return ligne;
}

/**
 * Saisie d'une cellule reprise tant que la cellule n'affiche pas la valeur (saisie perdue quand la grille est redessinée,
 * par exemple à la création du document par sa première ligne). Nombre : comparé une fois mis en forme (« 1 200,00 »).
 */
export async function saisirCelluleVerifiee(page: Page, ligne: Locator, colonne: string, valeur: string) {
  // Premier nombre affiché (la cellule peut porter une marque : métré, avertissement…)
  const nombre = (t: string) => Number((t.match(/-?\d[\d\s]*(,\d+)?/)?.[0] ?? '').replace(/\s/g, '').replace(',', '.'));
  const numerique = /^-?[\d\s]+([,.]\d+)?$/.test(valeur);
  await expect(async () => {
    const affiche = await texteCellule(page, ligne, colonne);
    if (numerique ? nombre(affiche) === nombre(valeur) : affiche.includes(valeur)) return;
    await saisirCellule(page, ligne, colonne, valeur);
    const apres = await texteCellule(page, ligne, colonne);
    expect(numerique ? nombre(apres) : apres).toEqual(numerique ? nombre(valeur) : expect.stringContaining(valeur));
  }).toPass({ timeout: 20000 });
}

// ------------------------------------------------------------------ parcours réutilisés

export type Devis = { id: number; numero: string; objet: string };

/**
 * Nouveau devis (bouton « Devis client » de la liste des devis, filtrée sur un projet s'il est donné) : objet,
 * rattachement au projet, client, une ligne de prix ; enregistré.
 */
export async function creerDevis(page: Page, { objet, projet, ligne }: { objet: string; projet?: string; ligne: LignePrix }): Promise<Devis> {
  await page.goto(projet ? `/liste/devis?projet=${projet}` : '/liste/devis');
  await page.getByRole('button', { name: 'Devis client', exact: true }).click();
  await attendreDocument(page);
  await attendreStatut(page, 'Brouillon');
  await saisirObjet(page, objet);
  if (projet) await rattacher(page, 'Projet', projet);
  await ajouterIntervenant(page, TIERS.CLIENT);
  await ajouterLigne(page, ligne);
  await enregistrer(page);
  return { id: idDocument(page), numero: (await numeroDocument(page)).numero, objet };
}

/** Devis enregistré puis validé (envoyé) et accepté par le client (statut Validé). */
export async function creerDevisValide(page: Page, options: { objet: string; projet?: string; ligne: LignePrix }) {
  const devis = await creerDevis(page, options);
  await valider(page);
  await attendreStatut(page, 'Envoyé');
  await actionDocument(page, 'Validé par le tiers');
  await attendreMessage(page, /validé par le tiers/i);
  await attendreStatut(page, 'Validé');
  return devis;
}
