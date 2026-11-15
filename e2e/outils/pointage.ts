import { expect, type Browser, type Locator, type Page } from '@playwright/test';
import { attendreMessage, dialogue, patienterSurLimiteDebit } from './documents';
import { dateFr, choisirDansCombo } from './planning';

/**
 * Aides des scénarios du pointage (e2e/pointage-*.spec.ts) : borne d'atelier (`/parametres/bornes`, `/borne`), pointage
 * de terrain (`/terrain?onglet=pointage`), synthèse et validation (`/pointage/synthese`), congés (`/pointage/conges`).
 * Données de démonstration attendues en base : salariés « Bonnet Jérôme », « Blanc Chloé », « Boyer Inès » (Atelier),
 * chantiers CH-2026-001 et INT-ATELIER, types de main-d'œuvre « Main-d'œuvre » (MO) et « Main-d'œuvre atelier », une
 * nature d'absence au moins.
 */

export const POINTAGE = Object.freeze({
  /** Salarié de la borne (PIN posé par le scénario). */
  BORNE: { nom: 'Bonnet', prenom: 'Jérôme' },
  /** Salarié du terrain : compte e2e_terrain, profil MOBILE (saisie libre pour lui seul). */
  TERRAIN: { nom: 'Blanc', prenom: 'Chloé', compte: process.env.E2E_TERRAIN_ID || 'e2e_terrain' },
  /** Salarié des congés. */
  CONGES: { nom: 'Boyer', prenom: 'Inès' },
  CHANTIER: 'CH-2026-001',
  CHANTIER_INTERNE: 'INT-ATELIER',
  /** Types de main-d'œuvre (codes) : main-d'œuvre, main-d'œuvre atelier. */
  TYPE_MO: 'MO',
  TYPE_MO_ATELIER: 'MO_ATELIER',
});

const iso = (d: Date) => d.toISOString().slice(0, 10);
const FERIES_FIXES = ['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25'];

/**
 * Date ISO du `rang`-ième jour ouvré passé (lundi à vendredi, hors fériés fixes) avant aujourd'hui (rang 0 : le plus
 * proche) ; la borne ne remonte que de sept jours.
 */
export function jourPasse(rang = 0) {
  const d = new Date(`${iso(new Date())}T00:00:00Z`);
  for (let n = -1; ;) {
    d.setUTCDate(d.getUTCDate() - 1);
    if ([0, 6].includes(d.getUTCDay()) || FERIES_FIXES.includes(iso(d).slice(5))) continue;
    if (++n === rang) return iso(d);
  }
}

/** Lundi de la semaine d'une date ISO. */
export function lundiDe(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return iso(d);
}

/** Écart en jours entre aujourd'hui et une date ISO passée. */
export const joursDepuis = (date: string) => Math.round((Date.parse(`${iso(new Date())}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000);

// ------------------------------------------------------------------ bornes (administration)

/** Nouvelle borne (PIN exigé) créée dans `/parametres/bornes` : rend son jeton, affiché une seule fois. */
export async function creerBorne(page: Page, libelle: string) {
  await page.goto('/parametres/bornes');
  const zone = page.locator('[data-bornes]');
  await expect(zone.locator('[data-libelle]')).toBeVisible({ timeout: 15000 });
  await zone.locator('[data-libelle]').fill(libelle);
  await expect(zone.locator('[data-pin]')).toBeChecked();
  await zone.locator('[data-creer]').click();
  const jeton = page.locator('[data-jeton]');
  await expect(jeton).toContainText('/borne?jeton=');
  await expect(zone.locator('tr[data-borne]').filter({ hasText: libelle })).toBeVisible();
  return /\/borne\?jeton=([^\s)]+)/.exec(await jeton.innerText())![1];
}

/** PIN d'un salarié posé depuis la section « Codes PIN » (salariés d'un service). */
export async function poserPin(page: Page, service: string, salarie: string, pin: string) {
  const zone = page.locator('[data-pins]');
  await choisirDansCombo(page, zone.locator('[data-service]').getByRole('combobox'), service);
  const ligne = zone.locator('tbody tr').filter({ hasText: salarie });
  await ligne.locator('input[data-pin]').fill(pin);
  await ligne.locator('[data-poser]').click();
  await attendreMessage(page, 'PIN enregistré');
  await expect(zone.locator('tbody tr').filter({ hasText: salarie })).not.toContainText('sans PIN');
}

// ------------------------------------------------------------------ borne (appareil, sans session)

/**
 * Page de la borne dans un contexte de navigateur sans session (appareil d'atelier) ; le jeton passé dans l'adresse est
 * gardé par ce navigateur.
 */
export async function ouvrirBorne(browser: Browser, jeton: string) {
  const contexte = await browser.newContext({ serviceWorkers: 'block' });
  const borne = await contexte.newPage();
  await patienterSurLimiteDebit(borne);
  await borne.goto(`/borne?jeton=${encodeURIComponent(jeton)}`);
  await expect(borne.locator('[data-cherche]')).toBeVisible({ timeout: 15000 });
  return borne;
}

/** Zone de la borne. */
export const zoneBorne = (borne: Page) => borne.locator('[data-borne]');

/** Identification : carte du salarié (recherche par le nom), PIN au clavier ; une saisie interrompue est abandonnée. */
export async function identifierBorne(borne: Page, salarie: { nom: string; prenom: string }, pin: string) {
  await borne.locator('[data-cherche]').fill(salarie.nom);
  await borne.locator('.borne-carte').filter({ hasText: `${salarie.prenom} ${salarie.nom}` }).click();
  await expect(zoneBorne(borne)).toContainText('code PIN');
  for (const k of pin) await borne.locator(`[data-k="${k}"]`).click();
  await borne.locator('[data-k="ok"]').click();
  const reprise = borne.locator('[data-nouvelle]');
  const journee = borne.locator('.borne-entete-saisie');
  await expect(reprise.or(journee).first()).toBeVisible({ timeout: 10000 });
  if (await reprise.isVisible()) await reprise.click();
  await expect(journee).toContainText(`${salarie.prenom} ${salarie.nom}`);
}

/** Journée de la borne ramenée à une date passée (◀ jour précédent, sept jours au plus). */
export async function allerAuJourBorne(borne: Page, date: string) {
  for (let i = joursDepuis(date); i > 0; i--) {
    const avant = await borne.locator('.borne-date span').first().innerText();
    await borne.locator('[data-jour="-1"]').click();
    await expect(borne.locator('.borne-date span').first()).not.toHaveText(avant);
  }
}

/** Chantier choisi à la borne (« Tous », filtre, tuile), puis type de main-d'œuvre (code) et activité (si proposés). */
export async function choisirChantierBorne(borne: Page, chantier: string, type: string, activite?: string) {
  // « Tous » reste actif d'un choix à l'autre de la même saisie (un clic de plus le désactiverait).
  if (!/principal/.test(await borne.locator('[data-tous]').getAttribute('class') ?? '')) await borne.locator('[data-tous]').click();
  await expect(borne.locator('[data-tous]')).toHaveClass(/principal/);
  await borne.locator('[data-ordre]').fill(chantier);
  await borne.locator('[data-tuiles] .borne-carte').filter({ hasText: chantier }).first().click();
  await expect(zoneBorne(borne)).toContainText("Type de main-d'œuvre");
  // Carte du type : libellé puis code en détail (<small>).
  await zoneBorne(borne).locator('.borne-carte').filter({ has: borne.locator('small', { hasText: new RegExp(`^${type}$`) }) }).first().click();
  const activites = zoneBorne(borne).locator('[data-o]');
  if (await zoneBorne(borne).getByText(/^Activité/).count() || await activites.count()) {
    await (activite ? activites.filter({ hasText: activite }).first() : activites.first()).click();
  }
  await expect(zoneBorne(borne).locator('.borne-entete-saisie')).toContainText('Pointages du jour');
}

/** Lignes de la liste des pointages de la journée (borne). */
export const lignesBorne = (borne: Page) => zoneBorne(borne).locator('.borne-ligne');

/** Total « Déjà saisi … ce jour » affiché par la borne. */
export const totalJourBorne = (borne: Page) => borne.locator('[data-total-jour]');

// ------------------------------------------------------------------ terrain

/** Onglet Pointage de l'application de terrain, à une date. */
export async function ouvrirPointageTerrain(page: Page, jour: string) {
  await page.goto(`/terrain?onglet=pointage&jour=${jour}`);
  await expect(page.locator('[data-enregistrer]').or(page.getByText('Journée validée')).first()).toBeVisible({ timeout: 15000 });
}

/** Ligne de saisie du pointage de terrain (rang). */
export const ligneTerrain = (page: Page, i: number) => page.locator(`.terrain-saisie[data-i="${i}"]`);

/** Combo d'une ligne de terrain : chantier, ordre, type, sous-type. */
export const comboTerrain = (ligne: Locator, nom: 'chantier' | 'ordre' | 'type' | 'sous-type') => ligne.locator(`[data-combo="${nom}"]`).getByRole('combobox');

// ------------------------------------------------------------------ synthèse

/** Synthèse d'une semaine, tous les salariés affichés (« Tout voir »), filtrée sur un nom. */
export async function ouvrirSynthese(page: Page, lundi: string, recherche: string) {
  await page.goto(`/pointage/synthese?lundi=${lundi}&tout=1`);
  await expect(page.locator('[data-semaine]')).not.toBeEmpty({ timeout: 15000 });
  const champ = page.locator('[data-recherche]');
  await champ.fill(recherche);
  await champ.dispatchEvent('change');
  await expect(page.locator('[data-liste] tbody tr').first()).toBeVisible({ timeout: 15000 });
}

/** Ligne de la synthèse d'un salarié (« Nom Prénom »). */
export const ligneSynthese = (page: Page, salarie: { nom: string; prenom: string }) => page.locator('[data-liste] tbody tr').filter({ hasText: `${salarie.nom} ${salarie.prenom}` }).first();

/** Cellule d'un jour (date ISO) d'une ligne de la synthèse : colonne repérée par son entête « jj/mm ». */
export async function celluleJourSynthese(page: Page, ligne: Locator, date: string) {
  const titres = await page.locator('[data-liste] thead th').allInnerTexts();
  const i = titres.findIndex((t) => t.includes(`${date.slice(8, 10)}/${date.slice(5, 7)}`));
  if (i < 0) throw new Error(`Jour ${date} absent de la synthèse : ${titres.join(' | ')}`);
  return ligne.locator('td').nth(i);
}

/** Dévalide la semaine d'un salarié (sélection, motif demandé par la fenêtre du socle). */
export async function devalider(page: Page, salarie: { nom: string; prenom: string }, motif: string) {
  await ligneSynthese(page, salarie).locator('[data-choix]').check();
  await page.locator('[data-devalider]').click();
  const d = dialogue(page);
  await expect(d).toContainText('Motif de la dévalidation');
  await d.getByRole('textbox').fill(motif);
  await d.getByRole('button', { name: 'OK', exact: true }).click();
  await attendreMessage(page, /1 salarié\(s\) dévalidé\(s\)/);
}

/**
 * Jour d'un salarié laissé validé par un passage interrompu : dévalidé, pour que le scénario se rejoue (un jour validé
 * est bloqué à la saisie).
 */
export async function libererJour(page: Page, salarie: { nom: string; prenom: string }, jour: string, motif: string) {
  await ouvrirSynthese(page, lundiDe(jour), salarie.nom);
  const cellule = await celluleJourSynthese(page, ligneSynthese(page, salarie), jour);
  if (/etat-valide/.test(await cellule.getAttribute('class') ?? '')) await devalider(page, salarie, motif);
}

// ------------------------------------------------------------------ congés

/** Page des congés filtrée sur une période et un salarié. */
export async function ouvrirConges(page: Page, du: string, au: string, recherche: string) {
  await page.goto(`/pointage/conges?du=${du}&au=${au}&recherche=${encodeURIComponent(recherche)}`);
  await expect(page.locator('[data-resultat] p.aide').first()).toBeVisible({ timeout: 15000 });
}

/** Ligne d'un congé (commentaire unique). */
export const ligneConge = (page: Page, commentaire: string) => page.locator('[data-resultat] tbody tr').filter({ hasText: commentaire });

/** Fenêtre de congé ouverte. */
export const fenetreConge = (page: Page) => dialogue(page);

/** Saisit les dates (jj/mm/aaaa) et le commentaire de la fenêtre de congé. */
export async function saisirConge(page: Page, { salarie, du, au, commentaire }: { salarie?: string; du: string; au: string; commentaire: string }) {
  const d = fenetreConge(page);
  if (salarie) await choisirDansCombo(page, d.locator('[data-salarie]').getByRole('combobox'), new RegExp(salarie), salarie);
  for (const [champ, date] of [['[data-du]', du], ['[data-au]', au]] as const) {
    await d.locator(champ).fill(dateFr(date));
    await d.locator(champ).press('Tab');
  }
  await d.locator('[data-commentaire]').fill(commentaire);
}

/** Nature d'absence choisie dans la fenêtre (service RH), « Congés payés » par défaut ; rend son libellé. */
export async function choisirNature(page: Page, nature = 'Congés payés') {
  const combo = fenetreConge(page).locator('[data-nature]').getByRole('combobox');
  await choisirDansCombo(page, combo, new RegExp(`^${nature}`));
  await expect(combo).toHaveValue(nature);
  return nature;
}
