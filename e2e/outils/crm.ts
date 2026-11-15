import { expect, type Locator, type Page } from '@playwright/test';
import { attendreMessage, choisirDansListe, dialogue } from './documents';
import { choisirDansCombo } from './planning';

/**
 * Données de démonstration employées par les scénarios du CRM (`scripts/demo`, `client/scripts/generer-modules-demo.mjs`) :
 * tiers de l'annuaire, salariée du service Administration (bureau) qui reçoit messages et tâches, compte de connexion
 * créé pour elle par `compteDeTest` (profil SAISIE, droits du CRM ; variable `E2E_CRM_ID` de `e2e/.env`, sinon
 * `e2e_crm`).
 */
export const CRM = Object.freeze({
  TIERS: 'SCI Les Érables',
  PROSPECT: 'Bâtir Ensemble Immobilier',
  ARCHITECTE: "Atelier d'architecture Durand et associés",
  CONTROLEUR: 'Contrôle Bâtiment Sud-Est – Lyon',
  SALARIEE: { nom: 'Garçon', prenom: 'Maëlys', compte: process.env.E2E_CRM_ID || 'e2e_crm', service: 'Administration (bureau)' },
});

/** Libellé d'un salarié dans les combos du CRM (« Prénom Nom », suivi de l'emploi). */
export const optionSalarie = (s: { nom: string; prenom: string }) => new RegExp(`^${s.prenom} ${s.nom}`);

/** Échéance au format du champ date et heure (AAAA-MM-JJTHH:MM), à n jours d'aujourd'hui. */
export function echeanceDans(jours: number, heure = '10:00') {
  const d = new Date();
  d.setDate(d.getDate() + jours);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${iso}T${heure}`;
}

// ------------------------------------------------------------------ notes

/** Page d'une note (création ou consultation). */
export const pageNote = (page: Page) => page.locator('.page-parametres.page-crm-note');

/** Combo de la note par son libellé (Nature, État, Type, Service, Responsable). */
export const comboNote = (page: Page, nom: 'Nature' | 'État' | 'Type' | 'Service' | 'Responsable') => pageNote(page).getByRole('combobox', { name: nom, exact: true });

export type SaisieNote = {
  objet: string;
  nature?: 'Action' | 'Message' | 'Tâche';
  type?: string;
  etat?: string;
  service?: string;
  responsable?: RegExp;
  echeance?: string;
  message?: string;
  tiers?: string;
  destinataire?: RegExp;
  privee?: boolean;
  fil?: boolean;
};

/** Nouvelle note (`/crm/note/nouveau`), nature donnée par l'adresse. */
export async function nouvelleNote(page: Page, nature: 'ACTION' | 'MESSAGE' | 'TACHE' = 'ACTION', parent?: string) {
  await page.goto(`/crm/note/nouveau?nature=${nature}${parent ? `&parent=${parent}` : ''}`);
  await expect(pageNote(page).getByRole('heading', { level: 1 })).toContainText(/Nouvelle note/, { timeout: 15000 });
}

/**
 * Saisie d'une note : type d'abord (son modèle de texte peut remplir le message), puis nature, état, service,
 * responsable, échéance, objet, message, tiers rattaché, destinataire, cases.
 */
export async function saisirNote(page: Page, n: SaisieNote) {
  const p = pageNote(page);
  if (n.type) await choisirDansCombo(page, comboNote(page, 'Type'), new RegExp(n.type));
  if (n.nature) await choisirDansCombo(page, comboNote(page, 'Nature'), new RegExp(n.nature));
  if (n.etat) await choisirDansCombo(page, comboNote(page, 'État'), n.etat);
  if (n.service) await choisirDansCombo(page, comboNote(page, 'Service'), n.service);
  if (n.responsable) await choisirDansCombo(page, comboNote(page, 'Responsable'), n.responsable);
  if (n.echeance) await p.getByRole('textbox', { name: 'Échéance', exact: true }).fill(n.echeance);
  await p.getByRole('textbox', { name: 'Objet', exact: true }).fill(n.objet);
  if (n.message) {
    const texte = p.locator('.crm-riche-texte').first();
    await texte.click();
    await texte.fill(n.message);
  }
  if (n.tiers) await rattacherTiers(page, n.tiers);
  if (n.destinataire) await ajouterDestinataire(page, n.destinataire);
  if (n.privee) await p.getByRole('checkbox', { name: 'Privée', exact: true }).check();
  if (n.fil) await p.getByRole('checkbox', { name: "Dans le fil d'actualité", exact: true }).check();
}

/** Tiers de l'annuaire rattaché à la note (type « Tiers » par défaut) : recherche, puis choix dans les résultats. */
export async function rattacherTiers(page: Page, tiers: string) {
  const zone = pageNote(page).locator('[data-liens]');
  await zone.locator('[data-recherche]').fill(tiers);
  await zone.locator('[data-ajouter]').click();
  await zone.locator('[data-choix]').filter({ hasText: tiers }).first().click();
  await expect(zone.locator('.crm-liens')).toContainText(tiers);
}

/** Destinataire (salarié de notre société) ajouté à la note. */
export async function ajouterDestinataire(page: Page, salarie: RegExp) {
  const zone = pageNote(page).locator('[data-destinataires]');
  await choisirDansCombo(page, zone.getByRole('combobox', { name: 'Salarié de notre société' }), salarie);
  await zone.locator('[data-ajouter]').click();
  await expect(zone.locator('.crm-liens li')).toHaveCount(1);
}

/** Enregistre la note : message de succès, adresse de la note créée ; renvoie son identifiant. */
export async function enregistrerNote(page: Page) {
  await pageNote(page).locator('[data-enregistrer]').click();
  await attendreMessage(page, 'Note enregistrée');
  await expect(page).toHaveURL(/\/crm\/note\/\d+/);
  return page.url().match(/\/crm\/note\/(\d+)/)![1];
}

/** Ouvre une note par son identifiant. */
export async function ouvrirNote(page: Page, id: string) {
  await page.goto(`/crm/note/${id}`);
  await expect(pageNote(page).locator('h1.page-titre')).toBeVisible({ timeout: 15000 });
  await expect(pageNote(page).locator('.crm-etat').first()).toBeVisible();
}

/** Pastille d'état de la note ouverte. */
export const etatNote = (page: Page) => pageNote(page).locator('h1 .crm-etat');

/** Liste des notes (`/crm`) d'une vue, tous états, filtrée par la recherche. */
export async function ouvrirNotes(page: Page, vue: 'mes' | 'a_prendre' | 'recues' | 'creees' | 'toutes', recherche: string) {
  await page.goto(`/crm?vue=${vue}&etat=&recherche=${encodeURIComponent(recherche)}`);
  await expect(page.locator('.crm-principal [data-corps]').locator('table, p.aide').first()).toBeVisible({ timeout: 15000 });
}

/** Ligne d'une note dans la liste, par son objet. */
export const ligneNote = (page: Page, objet: string) => page.locator('.crm-principal .crm-table tbody tr').filter({ hasText: objet });

/** Rappel ajouté à la note ouverte : à date (date et heure) ou avant l'échéance (délai en jours). */
export async function ajouterRappel(page: Page, r: { quand: string } | { delai: number }) {
  const zone = pageNote(page).locator('[data-rappels]');
  const avant = 'delai' in r;
  await choisirDansCombo(page, zone.locator('.crm-ajout-rappel').getByRole('combobox').first(), avant ? "Avant l'échéance" : 'À date');
  if (avant) await zone.locator('[data-delai]').fill(String(r.delai));
  else await zone.locator('[data-quand]').fill(r.quand);
  const n = await zone.locator('.crm-liens li').count();
  await zone.locator('[data-ajouter-rappel]').click();
  await expect(zone.locator('.crm-liens li')).toHaveCount(n + 1);
}

// ------------------------------------------------------------------ demandes

/** Page d'une demande (création ou consultation). */
export const pageDemande = (page: Page) => page.locator('.page-parametres.page-crm-note');

/** Combo de la demande par son libellé (État, Motif, Service, Responsable). */
export const comboDemande = (page: Page, nom: 'État' | 'Motif' | 'Service' | 'Responsable') => pageDemande(page).getByRole('combobox', { name: nom, exact: true });

/** Enregistre la demande ; renvoie son identifiant (adresse). */
export async function enregistrerDemande(page: Page) {
  await pageDemande(page).locator('[data-enregistrer]').click();
  await attendreMessage(page, 'Demande enregistrée');
  await expect(page).toHaveURL(/\/crm\/demande\/\d+/);
  return page.url().match(/\/crm\/demande\/(\d+)/)![1];
}

/** Tiers de la demande choisi dans l'annuaire (liste de choix). */
export async function choisirTiersDemande(page: Page, tiers: string) {
  await pageDemande(page).locator('[data-choisir-tiers]').click();
  await choisirDansListe(page, tiers);
  await expect(pageDemande(page).locator('.crm-tiers').first()).toContainText(tiers);
}

/** Liste des demandes, tous états, filtrée par la recherche. */
export async function ouvrirDemandes(page: Page, vue: 'mes' | 'a_prendre' | 'creees' | 'toutes', recherche: string) {
  await page.goto(`/crm/demandes?vue=${vue}&etat=&recherche=${encodeURIComponent(recherche)}`);
  await expect(page.locator('[data-corps]').locator('table, p.aide').first()).toBeVisible({ timeout: 15000 });
}

/** Ligne d'une demande dans la liste, par son objet. */
export const ligneDemande = (page: Page, objet: string) => page.locator('[data-corps] .crm-table tbody tr').filter({ hasText: objet });

// ------------------------------------------------------------------ plans et bordereaux

/** Page d'un plan. */
export const pagePlan = (page: Page) => page.locator('.page-parametres.page-crm-note');

/** Bloc d'un indice (« Indice A », « Premier indice (vide) »). */
export const blocIndice = (page: Page, libelle: string) => pagePlan(page).locator('.crm-indice').filter({ has: page.locator('.crm-indice-entete b', { hasText: libelle }) });

/** Pastille de statut du plan ouvert. */
export const statutPlan = (page: Page) => pagePlan(page).locator('h1 .crm-etat');

/** Indice ajouté au plan ouvert : lettre (vide : suivant), date de diffusion (vide : à diffuser), motif. */
export async function ajouterIndice(page: Page, { indice, date, motif }: { indice?: string; date?: string; motif?: string }) {
  const p = pagePlan(page);
  const n = await p.locator('.crm-indice').count();
  if (indice) await p.locator('[data-nouvel-indice]').fill(indice);
  if (date) await p.locator('[data-date-indice]').fill(date);
  if (motif) await p.locator('[data-motif-indice]').fill(motif);
  await p.locator('[data-ajouter-indice]').click();
  await expect(pagePlan(page).locator('.crm-indice')).toHaveCount(n + 1);
}

/** Visa attendu d'un tiers sur un indice (choisi dans l'annuaire). */
export async function ajouterVisa(page: Page, indice: string, tiers: string) {
  const bloc = blocIndice(page, indice);
  const n = await bloc.locator('tr[data-visa]').count();
  await bloc.locator('[data-ajouter-visa]').click();
  await choisirDansListe(page, tiers);
  await expect(blocIndice(page, indice).locator('tr[data-visa]')).toHaveCount(n + 1);
}

/** Visa reçu d'un tiers : statut, date de réception, observation, enregistré. */
export async function saisirVisa(page: Page, indice: string, tiers: string, { statut, recu, observation }: { statut: string; recu: string; observation?: string }) {
  const ligne = (): Locator => blocIndice(page, indice).locator('tr[data-visa]').filter({ hasText: tiers });
  await choisirDansCombo(page, ligne().getByRole('combobox').first(), statut);
  await ligne().locator('[data-recu]').fill(recu);
  if (observation) await ligne().locator('[data-observation]').fill(observation);
  await ligne().locator('[data-enregistrer-visa]').click();
  await attendreMessage(page, 'Visa enregistré');
}

/** Ligne d'un visa (après rechargement de la page). */
export const ligneVisa = (page: Page, indice: string, tiers: string) => blocIndice(page, indice).locator('tr[data-visa]').filter({ hasText: tiers });

/** Destinataire ajouté au bordereau en préparation (annuaire), avec ou sans visa attendu. */
export async function ajouterDestinataireBordereau(page: Page, tiers: string, vise: boolean) {
  const zone = page.locator('[data-destinataires]');
  const n = await zone.locator('tr[data-i]').count();
  await page.locator('.page-crm [data-ajouter]').click();
  await choisirDansListe(page, tiers);
  const ligne = zone.locator('tr[data-i]').filter({ hasText: tiers });
  await expect(zone.locator('tr[data-i]')).toHaveCount(n + 1);
  const visa = ligne.locator('[data-visa]');
  if (vise) await visa.check(); else await visa.uncheck();
}

/** Fenêtre ouverte (réexport). */
export { dialogue };
