// Axe du temps du planning (sans métier) : instants locaux « AAAA-MM-JJTHH:MM » convertis en minutes depuis 1970
// (calculés en UTC pour ignorer les changements d'heure, comme le module Calendrier), échelles d'affichage, colonnes et
// groupes d'en-tête, arrondi au pas du glisser.

import { texte } from '@logibtp/socle/dictionnaire';

/** Échelles : minutes par colonne ; regroupement d'en-tête. */
const echelle = (code, minutes, groupe) => ({ get libelle() { return texte(`planning.echelles.${code}`); }, minutes, groupe });
export const ECHELLES = {
  HEURE: echelle('HEURE', 60, 'JOUR'),
  DEMI_JOUR: echelle('DEMI_JOUR', 720, 'JOUR'),
  JOUR: echelle('JOUR', 1440, 'SEMAINE'),
  SEMAINE: echelle('SEMAINE', 10080, 'MOIS'),
};

// Noms courts des jours (dimanche = 0) et noms des mois (module Personnalisation).
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'].map((j) => texte(`planning.temps.jours.${j}`));
const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre']
  .map((m) => texte(`planning.temps.mois.${m}`));
const jj = (d) => String(d.getUTCDate()).padStart(2, '0');
const mm = (d) => String(d.getUTCMonth() + 1).padStart(2, '0');
const LUNDI_1970 = 4 * 1440; // 1970-01-05 est un lundi.

/** « AAAA-MM-JJ » ou « AAAA-MM-JJTHH:MM » → minutes depuis 1970 (heure locale lue comme UTC). */
export const versMinutes = (s) => Date.parse(`${s.length === 10 ? `${s}T00:00` : s.slice(0, 16)}:00Z`) / 60000;

/** Minutes depuis 1970 → « AAAA-MM-JJTHH:MM ». */
export const depuisMinutes = (m) => new Date(m * 60000).toISOString().slice(0, 16);

/** Minutes → « AAAA-MM-JJ ». */
export const dateDe = (m) => depuisMinutes(m).slice(0, 10);

/** Début de l'unité contenant m : jour (minuit), semaine (lundi), mois (le 1er). */
export function debutUnite(m, unite) {
  if (unite === 'JOUR') return Math.floor(m / 1440) * 1440;
  if (unite === 'SEMAINE') return Math.floor((m - LUNDI_1970) / 10080) * 10080 + LUNDI_1970;
  if (unite === 'MOIS') { const d = new Date(m * 60000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 60000; }
  return m;
}

/** Unité suivante (le mois a une durée variable). */
function suivante(m, unite) {
  if (unite === 'JOUR') return m + 1440;
  if (unite === 'SEMAINE') return m + 10080;
  const d = new Date(m * 60000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 60000;
}

/** Numéro de semaine ISO. */
export function semaineIso(m) {
  const d = new Date(m * 60000);
  const jeudi = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)));
  const premier = new Date(Date.UTC(jeudi.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((jeudi - premier) / 86400000 - 3 + ((premier.getUTCDay() + 6) % 7)) / 7);
}

function libelleColonne(m, echelle) {
  const d = new Date(m * 60000);
  if (echelle === 'HEURE') return texte('planning.temps.heure', { heure: d.getUTCHours() });
  if (echelle === 'DEMI_JOUR') return d.getUTCHours() < 12 ? texte('planning.temps.matin') : texte('planning.temps.apres_midi');
  if (echelle === 'JOUR') return texte('planning.temps.colonne_jour', { jour: JOURS[d.getUTCDay()], numero: d.getUTCDate() });
  return texte('planning.temps.colonne_semaine', { semaine: semaineIso(m) });
}

function libelleGroupe(m, unite) {
  const d = new Date(m * 60000);
  if (unite === 'JOUR') return texte('planning.temps.groupe_jour', { jour: JOURS[d.getUTCDay()], date: `${jj(d)}/${mm(d)}/${d.getUTCFullYear()}` });
  if (unite === 'SEMAINE') return texte('planning.temps.groupe_semaine', { semaine: semaineIso(m), date: `${jj(d)}/${mm(d)}` });
  return texte('planning.temps.groupe_mois', { mois: MOIS[d.getUTCMonth()], annee: d.getUTCFullYear() });
}

/** Colonnes entre deux instants (minutes), alignées sur l'échelle : { debut, fin, libelle, weekend }. */
export function colonnes(debut, fin, echelle) {
  const e = ECHELLES[echelle];
  const r = [];
  let m = echelle === 'SEMAINE' ? debutUnite(debut, 'SEMAINE') : Math.floor(debut / e.minutes) * e.minutes;
  for (; m < fin; m += e.minutes) {
    const j = new Date(m * 60000).getUTCDay();
    r.push({ debut: m, fin: m + e.minutes, libelle: libelleColonne(m, echelle), weekend: echelle !== 'SEMAINE' && (j === 0 || j === 6) });
  }
  return r;
}

/** Unités (JOUR, SEMAINE, MOIS) couvrant la période : { debut, fin, libelle }. */
function unites(debut, fin, unite, libelle = libelleGroupe) {
  const r = [];
  for (let m = debutUnite(debut, unite); m < fin; m = suivante(m, unite)) r.push({ debut: m, fin: suivante(m, unite), libelle: libelle(m, unite) });
  return r;
}

/** Groupes d'en-tête (jours, semaines ou mois) couvrant la période : { debut, fin, libelle }. */
export const groupes = (debut, fin, echelle) => unites(debut, fin, ECHELLES[echelle].groupe);

/**
 * Lignes de l'en-tête : mois et année, puis jours (semaines à l'échelle SEMAINE), puis découpage de la journée (heures,
 * demi-journées ; absent à l'échelle du jour) : [{ niveau, cellules: [{ debut, fin, libelle, weekend }] }].
 */
export function lignesEntete(debut, fin, echelle) {
  const r = [{ niveau: 'MOIS', cellules: unites(debut, fin, 'MOIS', (m) => { const l = libelleGroupe(m, 'MOIS'); return l[0].toUpperCase() + l.slice(1); }) }];
  if (echelle === 'JOUR' || echelle === 'SEMAINE') return [...r, { niveau: echelle, cellules: colonnes(debut, fin, echelle) }];
  const jours = unites(debut, fin, 'JOUR', (m) => libelleColonne(m, 'JOUR')).map((x) => ({ ...x, weekend: [0, 6].includes(new Date(x.debut * 60000).getUTCDay()) }));
  return [...r, { niveau: 'JOUR', cellules: jours }, { niveau: echelle, cellules: colonnes(debut, fin, echelle) }];
}

/** Minuit du jour local (minutes depuis 1970, même convention que `versMinutes`). */
export const aujourdhui = (d = new Date()) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 60000;

/** Arrondi au pas (minutes) le plus proche. */
export const arrondirAuPas = (m, pas) => (pas > 0 ? Math.round(m / pas) * pas : Math.round(m));

/**
 * Période flottante : `avant` et `apres` jours autour d'une date (« deux semaines avant, quatre après »), bornes à
 * minuit ; renvoie { debut, fin } en minutes.
 */
export function periodeFlottante(aujourdhui, avant, apres) {
  const j = debutUnite(versMinutes(aujourdhui), 'JOUR');
  return { debut: j - avant * 1440, fin: j + (apres + 1) * 1440 };
}
