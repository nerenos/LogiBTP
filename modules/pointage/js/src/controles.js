// Contrôles des pointages d'un salarié sur une semaine, règle répliquée dans ReglesPointage.cs (jeu
// modules/pointage/tests/cas/01_controles.json) : erreurs (bloquantes à l'enregistrement) et avertissements (signalés
// seulement : amplitude, chantier clos). Durées en minutes entières, dates « AAAA-MM-JJ », heures de début et de fin en
// minutes depuis minuit (ANALYSE-MODULE-POINTAGE.md § 6 « Contrôles visibles avant l'envoi »).

/** Paramètres par défaut de la société (poi_parametre). */
export const PARAMETRES_DEFAUT = { pas_minutes: 15, amplitude_jour: 600, amplitude_semaine: 2880, ordre_nom: 'NP', validation: 'SIMPLE', blocage: 'SEMAINE' };

export const MESSAGES_POINTAGE = {
  POI_CHANTIER: 'Chantier obligatoire (chantier interne pour le temps hors chantier)',
  POI_TYPE: 'Type de main-d\'œuvre obligatoire',
  POI_MINUTES: 'Durée invalide (de 1 minute à 24 heures)',
  POI_PAS: 'Durée hors du pas de saisie',
  POI_PLAGE: 'Début et fin incohérents avec la durée',
  POI_CHEVAUCHEMENT: 'Plages horaires qui se chevauchent',
  POI_MOTIF: 'Motif obligatoire pour une non-conformité',
  POI_JOUR: 'Amplitude journalière dépassée',
  POI_SEMAINE: 'Amplitude hebdomadaire dépassée',
  POI_CHANTIER_CLOS: 'Chantier clos',
};

const avertissement = (code, cle, date) => ({ code, niveau: 'AVERTISSEMENT', ...(cle !== undefined ? { cle } : {}), ...(date ? { date } : {}) });
const erreur = (code, cle) => ({ code, niveau: 'ERREUR', cle });

/**
 * Contrôle une semaine : `pointages` [{ cle, date, cha_id, chantier_clos, type_mo, non_conformite, motif, minutes,
 * debut, fin }]. Résultat ordonné : pour chaque pointage dans l'ordre (chantier, type, durée, pas, plage, motif,
 * chantier clos), puis chevauchements par date (paire dans l'ordre de saisie), puis dépassements par date, puis de la
 * semaine.
 */
export function controlerSemaine({ parametres = {}, pointages = [] } = {}) {
  const p = { ...PARAMETRES_DEFAUT, ...parametres };
  const r = [];
  for (const x of pointages) {
    if (x.cha_id == null) r.push(erreur('POI_CHANTIER', x.cle));
    if (x.type_mo == null || x.type_mo === '') r.push(erreur('POI_TYPE', x.cle));
    const m = x.minutes;
    if (!Number.isInteger(m) || m <= 0 || m > 1440) r.push(erreur('POI_MINUTES', x.cle));
    else if (p.pas_minutes > 0 && m % p.pas_minutes !== 0) r.push(erreur('POI_PAS', x.cle));
    if (x.debut != null || x.fin != null) {
      if (x.debut == null || x.fin == null || x.fin <= x.debut || x.fin - x.debut !== m) r.push(erreur('POI_PLAGE', x.cle));
    }
    if (x.non_conformite && !String(x.motif ?? '').trim()) r.push(erreur('POI_MOTIF', x.cle));
    if (x.chantier_clos) r.push(avertissement('POI_CHANTIER_CLOS', x.cle));
  }
  const dates = [...new Set(pointages.map((x) => x.date))].sort();
  for (const d of dates) {
    const plages = pointages.filter((x) => x.date === d && x.debut != null && x.fin != null && x.fin > x.debut);
    for (let i = 0; i < plages.length; i++) {
      for (let j = i + 1; j < plages.length; j++) {
        if (plages[i].debut < plages[j].fin && plages[j].debut < plages[i].fin) r.push(erreur('POI_CHEVAUCHEMENT', plages[j].cle));
      }
    }
  }
  const valides = (x) => Number.isInteger(x.minutes) && x.minutes > 0 && x.minutes <= 1440;
  for (const d of dates) {
    const total = pointages.filter((x) => x.date === d && valides(x)).reduce((s, x) => s + x.minutes, 0);
    if (p.amplitude_jour > 0 && total > p.amplitude_jour) r.push(avertissement('POI_JOUR', undefined, d));
  }
  const semaine = pointages.filter(valides).reduce((s, x) => s + x.minutes, 0);
  if (p.amplitude_semaine > 0 && semaine > p.amplitude_semaine) r.push(avertissement('POI_SEMAINE'));
  return r;
}

/** Vrai si un des contrôles est une erreur (enregistrement refusé). */
export const bloquant = (controles) => controles.some((c) => c.niveau === 'ERREUR');

/** Lundi de la semaine d'une date « AAAA-MM-JJ ». */
export function lundiDe(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Les sept dates de la semaine commençant le lundi donné. */
export function joursSemaine(lundi) {
  const d = new Date(`${lundi}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => new Date(d.getTime() + i * 86400000).toISOString().slice(0, 10));
}

/**
 * Lit une durée saisie : « 7:30 », « 7h30 », « 7h », « 7,5 », « 7.25 » → minutes ; vide → 0 ; illisible → null.
 * Les décimales sont des heures (7,5 = 7 h 30).
 */
export function lireDuree(texte) {
  const t = String(texte ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return 0;
  let m = /^(\d{1,2})(?:[:h](\d{1,2})?)$/.exec(t);
  if (m) return Number(m[2] ?? 0) < 60 ? Number(m[1]) * 60 + Number(m[2] ?? 0) : null;
  m = /^(\d{1,2})(?:[.,](\d{1,2}))?$/.exec(t);
  if (m) return Math.round((Number(m[1]) + Number(`0.${m[2] ?? 0}`)) * 60);
  return null;
}

/** Écrit une durée en minutes : 450 → « 7:30 », 0 → « ». */
export const ecrireDuree = (minutes) => (minutes ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}` : '');
