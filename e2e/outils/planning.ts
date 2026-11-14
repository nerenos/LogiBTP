import { expect, type Locator, type Page } from '@playwright/test';
import { attendreMessage, dialogue } from './documents';

/**
 * Aides des scénarios du planning (e2e/planning-*.spec.ts) : page `/planning?vue=` (vue fournie, période, échelle,
 * recherche), panneau Tâche (saisie, ressources, équipes, enregistrement), barres et lignes de la `VuePlanning`, onglet
 * Jalons ; page des équipes `/planning/equipes` (compositions datées).
 * Données de démonstration attendues en base : vues fournies du module (`089_planning`), services Atelier, Chantier
 * (travaux), Pose, Logistique ; salariés « André François » (Atelier), « Boyer Frédéric », « Blanc Loïc » (Chantier),
 * matériels « M00022 Mini-pelle 2,5 t n° 122 », « M00004 Utilitaire léger n° 104 » ; chantiers CH-2026-001 et CH-2026-002.
 */

export const PLANNING = Object.freeze({
  CHANTIER: 'CH-2026-001',
  CHANTIER_GANTT: 'CH-2026-002',
  /** Entête de la ligne du chantier CH-2026-002 (vue par chantier). */
  CHANTIER_GANTT_LIGNE: 'CH-2026-002 Résidence Les Érables – bâtiment A',
  SALARIE_ATELIER: 'André François',
  SALARIE_CHANTIER: 'Boyer Frédéric',
  SALARIE_CHANTIER_2: 'Blanc Loïc',
  MATERIEL: 'M00022 Mini-pelle 2,5 t n° 122',
  MATERIEL_2: 'M00004 Utilitaire léger n° 104',
});

/** Vues fournies du module (089_planning) : code, libellé, regroupement des lignes et échelle de départ. */
export const VUES = Object.freeze({
  ATELIER_JOUR: { code: 'ATELIER_JOUR', libelle: 'Atelier par jour', echelle: 'Jour' },
  POSE_SEMAINE: { code: 'POSE_SEMAINE', libelle: 'Pose par semaine', echelle: 'Demi-journée' },
  CHANTIERS_GANTT: { code: 'CHANTIERS_GANTT', libelle: 'Chantiers (Gantt)', echelle: 'Semaine' },
  CHARGE_SERVICE: { code: 'CHARGE_SERVICE', libelle: 'Charge par service', echelle: 'Jour' },
  LIVRAISONS: { code: 'LIVRAISONS', libelle: 'Livraisons', echelle: 'Heure' },
});

export type Vue = (typeof VUES)[keyof typeof VUES];

const iso = (d: Date) => d.toISOString().slice(0, 10);
// Fériés à date fixe (les fériés mobiles tombent rarement un mardi, mercredi ou jeudi de la fenêtre choisie).
const FERIES_FIXES = ['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25'];

/** Férié à date fixe (date ISO). */
export const estFerieFixe = (date: string) => FERIES_FIXES.includes(date.slice(5));

/**
 * Date ISO du `rang`-ième mardi, mercredi ou jeudi non férié à partir de demain (rang 0 : le premier) : jour ouvré de
 * toutes les vues fournies, la plus courte (Livraisons) montrant six jours après aujourd'hui.
 */
export function jourOuvre(rang = 0) {
  const d = new Date(`${iso(new Date())}T00:00:00Z`);
  for (let n = -1; ;) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (![2, 3, 4].includes(d.getUTCDay()) || FERIES_FIXES.includes(iso(d).slice(5))) continue;
    if (++n === rang) return iso(d);
  }
}

/** Date ISO décalée de `jours` jours. */
export function decaler(date: string, jours: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return iso(d);
}

/** Date ISO affichée par les champs de date du socle (jj/mm/aaaa). */
export const dateFr = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/** Choix d'une option d'un combo du socle (libellé exact ou expression). */
export async function choisirDansCombo(page: Page, combo: Locator, option: string | RegExp, saisie?: string) {
  await combo.click();
  if (saisie !== undefined) await combo.fill(saisie);
  await page.getByRole('option', { name: option, exact: typeof option === 'string' ? true : undefined }).first().click();
}

// ------------------------------------------------------------------ page du planning

/** Ouvre le planning sur une vue fournie : barre d'outils et lignes affichées. */
export async function ouvrirPlanning(page: Page, vue: Vue, du?: string) {
  await page.goto(`/planning?vue=${vue.code}${du ? `&du=${du}` : ''}`);
  await expect(page.locator('.barre-planning')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-vue]').getByRole('combobox')).toHaveValue(vue.libelle);
  await expect(page.locator('[data-etat]')).toContainText(/ligne/, { timeout: 15000 });
}

/** Recherche de la barre (ressource, chantier, service…) : le serveur ne rend que les lignes qui correspondent. */
export async function rechercher(page: Page, texte: string) {
  const champ = page.locator('[data-recherche]');
  await champ.fill(texte);
  await champ.press('Enter');
  await champ.dispatchEvent('change');
  await expect(page.locator('.vp-ligne').first()).toBeVisible();
}

/**
 * Décorations d'une ligne (charge d'un service par jour, jalons, attentes) : elles n'ont pas d'attribut de ligne et sont
 * posées un pixel sous le haut de la ligne.
 */
export async function decorationsSurLigne(page: Page, ligne: string) {
  const l = page.locator('.vp-ligne').filter({ hasText: new RegExp(`^\\s*${ligne.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).first();
  await expect(l).toBeVisible({ timeout: 10000 });
  const y = parseFloat((await l.getAttribute('style'))!.match(/top:\s*([\d.]+)px/)![1]);
  return page.locator(`.vp-deco[style*="top:${y + 1}px"]`);
}

/** Ligne de la vue dont l'entête porte un texte (ressource, chantier, service). */
export const ligneVue = (page: Page, texte: string | RegExp) => page.locator('.vp-ligne').filter({ hasText: texte }).first();

/** Barres d'une tâche (libellé) dessinées sur une ligne de la vue. */
export async function barresSurLigne(page: Page, ligne: string | RegExp, libelle: string) {
  const l = ligneVue(page, ligne);
  await expect(l).toBeVisible({ timeout: 10000 });
  const i = await l.getAttribute('data-i');
  return page.locator(`.vp-barre[data-ligne="${i}"]`).filter({ hasText: libelle });
}

/** Toutes les barres d'une tâche (libellé), quelle que soit la ligne. */
export const barres = (page: Page, libelle: string) => page.locator('.vp-barre').filter({ hasText: libelle });

/** Panneau de saisie de la tâche et sa barre de boutons (Aperçu du calcul, Enregistrer, Annuler). */
export const panneauTache = (page: Page) => page.locator('[data-panneau="tache"]');
const actionsTache = (page: Page) => page.locator('[data-actions-tache]');

export type SaisieTache = {
  libelle: string;
  chantier?: string;
  service?: string;
  /** Date ISO (aaaa-mm-jj) et heure (hh:mm) de début. */
  debut: string;
  heure?: string;
  /** Durée « h:mm ». */
  heures?: string;
  ressources?: { recherche: string; libelle: string | RegExp }[];
  equipe?: string;
  etat?: string;
};

/** Champ de date et heure du panneau, validé par Tab (le panneau peut se redessiner après). */
async function saisirChamp(champ: Locator, valeur: string) {
  await expect(async () => {
    await champ.fill(valeur);
    await champ.press('Tab');
    await expect(champ).toHaveValue(valeur, { timeout: 1000 });
  }).toPass({ timeout: 10000 });
}

/** Ressource ajoutée à la tâche du panneau (recherche dans le combo, puis option choisie). */
export async function ajouterRessource(page: Page, recherche: string, libelle: string | RegExp) {
  const p = panneauTache(page);
  const combo = p.getByRole('combobox', { name: /Ajouter une ressource/ });
  await combo.fill(recherche);
  await page.getByRole('option', { name: libelle }).first().click();
  await expect(p.locator('ul').first()).toContainText(typeof libelle === 'string' ? libelle : recherche);
}

/**
 * Équipe ajoutée à la tâche du panneau (recherche sur son libellé) : aperçu de sa composition à la date de début (membres
 * cochés), puis « Ajouter à la tâche » ; rend les membres de l'aperçu.
 */
export async function ajouterEquipe(page: Page, equipe: string) {
  const p = panneauTache(page);
  const combo = p.getByRole('combobox', { name: /Ajouter une équipe/ });
  await combo.click();
  await combo.fill(equipe);
  // Option : libellé de l'équipe, code en détail.
  await page.getByRole('option').filter({ hasText: equipe }).first().click();
  const apercu = p.locator('.apercu-equipe');
  await expect(apercu).toContainText(equipe);
  const membres = (await apercu.locator('li').allInnerTexts()).map((t) => t.trim());
  await apercu.locator('[data-ajouter-membres]').click();
  await expect(apercu).toHaveCount(0);
  await expect(p.locator('li.ligne-equipe').filter({ hasText: equipe })).toBeVisible();
  return membres;
}

/** Nouvelle tâche (bouton « Tâche » de la barre) saisie dans le panneau puis enregistrée. */
export async function creerTache(page: Page, t: SaisieTache) {
  await page.locator('[data-nouvelle]').click();
  const p = panneauTache(page);
  await expect(p).toBeVisible();
  await expect(p.getByText('Nouvelle tâche', { exact: true })).toBeVisible();
  await p.getByRole('textbox', { name: 'Libellé', exact: true }).fill(t.libelle);
  if (t.chantier) await choisirDansCombo(page, p.locator('[data-element]').getByRole('combobox'), new RegExp(`^${t.chantier}`));
  if (t.service) await choisirDansCombo(page, p.locator('[data-service]').getByRole('combobox'), t.service);
  await saisirChamp(p.getByRole('textbox', { name: 'Début', exact: true }), `${t.debut}T${t.heure ?? '08:00'}`);
  if (t.heures) await saisirChamp(p.getByRole('textbox', { name: 'Heures', exact: true }), t.heures);
  if (t.etat) await choisirEtat(page, t.etat);
  for (const r of t.ressources ?? []) await ajouterRessource(page, r.recherche, r.libelle);
  if (t.equipe) await ajouterEquipe(page, t.equipe);
  await enregistrerTache(page);
}

/** État de la tâche du panneau (Option, Confirmé…). */
export async function choisirEtat(page: Page, etat: string | RegExp) {
  await choisirDansCombo(page, panneauTache(page).locator('[data-etat-tache]').getByRole('combobox'), etat);
}

/** Enregistre la tâche du panneau. */
export async function enregistrerTache(page: Page) {
  await actionsTache(page).getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await attendreMessage(page, 'Tâche enregistrée');
}

/** Valeur de fin calculée affichée par le panneau (aaaa-mm-jjThh:mm). */
export const finTache = (page: Page) => panneauTache(page).getByRole('textbox', { name: 'Fin', exact: true });

/** Sélectionne la barre (le panneau affiche la tâche). */
export async function selectionner(page: Page, barre: Locator, libelle: string) {
  await barre.click();
  await expect(barre).toHaveClass(/selection/);
  await expect(panneauTache(page).getByRole('textbox', { name: 'Libellé', exact: true })).toHaveValue(libelle);
}

/** Supprime la tâche de la barre sélectionnée (touche Suppr, confirmation). */
export async function supprimerSelection(page: Page, barre: Locator, libelle: string) {
  await selectionner(page, barre, libelle);
  const avant = await barres(page, libelle).count();
  await page.keyboard.press('Delete');
  const d = dialogue(page);
  await expect(d).toContainText('Supprimer la tâche sélectionnée ?');
  await d.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await attendreMessage(page, 'Tâche supprimée');
  await expect(barres(page, libelle)).toHaveCount(avant - 1, { timeout: 10000 });
}

/** Onglet du panneau du planning (par son titre). */
export async function ongletPanneau(page: Page, nom: 'À planifier' | 'Ressources et équipes' | 'Tâche' | 'Alertes' | 'Jalons' | RegExp) {
  const b = page.locator('.panneau-planning .entete-panneau').getByRole('button', { name: nom, exact: typeof nom === 'string' ? true : undefined });
  await b.click();
  await expect(b).toHaveClass(/actif/);
}

// ------------------------------------------------------------------ équipes

/** Zone de détail de la page des équipes. */
export const detailEquipe = (page: Page) => page.locator('[data-detail]');

/** Composition de l'équipe affichée commençant à une date ISO. */
export async function composition(page: Page, du: string) {
  const d = detailEquipe(page);
  const blocs = d.locator('.periode-equipe');
  const n = await blocs.count();
  for (let i = 0; i < n; i++) if ([du, dateFr(du)].includes(await blocs.nth(i).locator('[data-du]').inputValue())) return blocs.nth(i);
  throw new Error(`Aucune composition au ${du}`);
}

/** Membre ajouté à une composition (recherche dans le combo, option choisie). */
export async function ajouterMembre(page: Page, bloc: Locator, recherche: string, libelle: string | RegExp) {
  await bloc.getByRole('combobox', { name: /Ajouter un membre/ }).fill(recherche);
  await page.getByRole('option', { name: libelle }).first().click();
  await expect(bloc.locator('li.ligne-ressource').filter({ hasText: libelle })).toBeVisible();
}

/** Membre d'une composition (ligne de la liste). */
export const membre = (bloc: Locator, libelle: string | RegExp) => bloc.locator('li.ligne-ressource').filter({ hasText: libelle });

/** Action d'un membre (bouton visible au survol de sa ligne) : `chef` (désigner / retirer le chef) ou `retirer`. */
export async function actionMembre(bloc: Locator, libelle: string | RegExp, action: 'chef' | 'retirer') {
  const li = membre(bloc, libelle);
  await li.hover();
  await li.locator(`[data-${action}]`).click();
}

/** Enregistre l'équipe affichée : message, retour en consultation. */
export async function enregistrerEquipe(page: Page) {
  await detailEquipe(page).getByRole('button', { name: /Enregistrer/ }).click();
  await attendreMessage(page, 'Équipe enregistrée');
  await expect(detailEquipe(page).locator('.badge-mode')).not.toHaveClass(/modification/);
}
