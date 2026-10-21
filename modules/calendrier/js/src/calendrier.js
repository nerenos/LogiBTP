// Calendriers de travail et jours fermés, règles répliquées dans ReglesCalendrier.cs (jeux modules/calendrier/tests/cas).
// Dates « AAAA-MM-JJ », instants « AAAA-MM-JJTHH:MM » en heure locale (pas de fuseau : le calendrier est celui du
// chantier ou de l'atelier) ; durées en minutes entières (exactes, sans flottant).

export const REGLES_FERME = {
  DATE: 'Date unique', ANNUEL: 'Chaque année (jour et mois)', NIEME: 'N-ième jour de la semaine du mois', DERNIER: 'Dernier jour de la semaine du mois',
  PAQUES: 'Relatif à Pâques', PERIODE: 'Période de fermeture',
};
export const JOURS_SEMAINE = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
export const CYCLE_MAX = 8;
/** Recherche d'un temps de travail : au-delà, le calendrier est considéré comme vide. */
export const HORIZON_JOURS = 3660;

export const MESSAGES_CALENDRIER = {
  CAL_CYCLE: `Cycle de 1 à ${CYCLE_MAX} semaines`,
  CAL_REFERENCE: 'Date de référence obligatoire pour un cycle de plusieurs semaines',
  PLG_JOUR: 'Jour de la semaine de 1 (lundi) à 7 (dimanche)',
  PLG_SEMAINE: 'Semaine du cycle inexistante',
  PLG_HEURES: 'Plage horaire : début avant la fin, entre 0 h et 24 h',
  PLG_PERIODE: 'Période de la plage : fin avant le début',
  PLG_CHEVAUCHEMENT: 'Plages horaires qui se chevauchent',
  FER_REGLE: 'Règle de jour fermé inconnue',
  FER_DATE: 'Date obligatoire',
  FER_MOIS: 'Mois de 1 à 12',
  FER_JOUR: 'Jour invalide',
  FER_RANG: 'Rang de 1 à 5',
  FER_PERIODE: 'Période : début et fin obligatoires, fin après le début',
  CALENDRIER_VIDE: 'Aucun temps de travail dans le calendrier',
};

// ---------------------------------------------------------------- dates

const pad = (n) => String(n).padStart(2, '0');
const ms = (d) => Date.parse(`${d}T00:00:00Z`);
/** Numéro de jour (jours depuis le 1970-01-01). */
export const numeroJour = (d) => Math.round(ms(d) / 86400000);
export const depuisNumero = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
export const ajouterJours = (d, n) => depuisNumero(numeroJour(d) + n);
/** Jour ISO de la semaine : 1 lundi … 7 dimanche. */
export const jourSemaine = (d) => ((new Date(ms(d)).getUTCDay() + 6) % 7) + 1;
const joursDuMois = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();
const date = (a, m, j) => `${a}-${pad(m)}-${pad(j)}`;

/** Dimanche de Pâques (calendrier grégorien, algorithme de Meeus / Jones / Butcher). */
export function paques(annee) {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return date(annee, mois, jour);
}

/** Dates d'une règle de jour fermé dans une année (liste triée, éventuellement vide). */
export function datesRegle(r, annee) {
  switch (r.regle) {
    case 'DATE': return r.date && Number(r.date.slice(0, 4)) === annee ? [r.date] : [];
    case 'ANNUEL': return r.jour <= joursDuMois(annee, r.mois) ? [date(annee, r.mois, r.jour)] : [];
    case 'NIEME': {
      const premier = date(annee, r.mois, 1);
      const j = 1 + ((r.jour - jourSemaine(premier) + 7) % 7) + (r.rang - 1) * 7;
      return j <= joursDuMois(annee, r.mois) ? [date(annee, r.mois, j)] : [];
    }
    case 'DERNIER': {
      const n = joursDuMois(annee, r.mois);
      const dernier = date(annee, r.mois, n);
      return [date(annee, r.mois, n - ((jourSemaine(dernier) - r.jour + 7) % 7))];
    }
    case 'PAQUES': {
      const d = ajouterJours(paques(annee), r.decalage ?? 0);
      return Number(d.slice(0, 4)) === annee ? [d] : [];
    }
    case 'PERIODE': {
      if (!r.du || !r.au) return [];
      const de = Math.max(numeroJour(r.du), numeroJour(`${annee}-01-01`));
      const a = Math.min(numeroJour(r.au), numeroJour(`${annee}-12-31`));
      const res = [];
      for (let n = de; n <= a; n++) res.push(depuisNumero(n));
      return res;
    }
    default: return [];
  }
}

/** Jours fermés de la période [du, au] : [{ date, libelles }] triés (libellés dans l'ordre des règles, sans doublon). */
export function joursFermes(regles, du, au) {
  const res = new Map();
  for (let annee = Number(du.slice(0, 4)); annee <= Number(au.slice(0, 4)); annee++) {
    for (const r of regles.filter((x) => x.actif !== false)) {
      for (const d of datesRegle(r, annee)) {
        if (d < du || d > au) continue;
        const l = res.get(d) ?? [];
        if (!l.includes(r.libelle)) l.push(r.libelle);
        res.set(d, l);
      }
    }
  }
  return [...res.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([d, libelles]) => ({ date: d, libelles }));
}

// ---------------------------------------------------------------- plages horaires

/** Semaine du cycle (1 à N) d'une date : semaines comptées depuis le lundi de la semaine de référence. */
export function semaineDuCycle(cal, d) {
  const n = cal.cycle_semaines ?? 1;
  if (n <= 1 || !cal.reference) return 1;
  const lundi = (x) => numeroJour(x) - (jourSemaine(x) - 1);
  const w = Math.floor((lundi(d) - lundi(cal.reference)) / 7);
  return (((w % n) + n) % n) + 1;
}

const couvre = (p, d) => (!p.du || p.du <= d) && (!p.au || d <= p.au);

/**
 * Plages travaillées d'une date (hors jours fermés) : celles de la semaine du cycle et du jour ; des plages datées
 * (période) qui couvrent la date remplacent les plages permanentes de ce jour. Triées par début.
 */
export function plagesDuJour(cal, d) {
  const s = semaineDuCycle(cal, d);
  const j = jourSemaine(d);
  const candidates = (cal.plages ?? []).filter((p) => (p.semaine ?? 1) === s && p.jour === j);
  const datees = candidates.filter((p) => (p.du || p.au) && couvre(p, d));
  const retenues = datees.length ? datees : candidates.filter((p) => !p.du && !p.au);
  return retenues.map((p) => ({ debut: p.debut, fin: p.fin })).sort((a, b) => a.debut - b.debut);
}

/** Journée d'un calendrier : { date, fermee (libellés ou null), plages, minutes }. */
export function journee(cal, fermes, d) {
  const f = fermes.find((x) => x.date === d);
  const plages = f ? [] : plagesDuJour(cal, d);
  return { date: d, fermee: f ? f.libelles : null, plages, minutes: plages.reduce((s, p) => s + p.fin - p.debut, 0) };
}

/** Journées de [du, au]. */
export function journees(cal, fermes, du, au) {
  const res = [];
  for (let n = numeroJour(du); n <= numeroJour(au); n++) res.push(journee(cal, fermes, depuisNumero(n)));
  return res;
}

// ---------------------------------------------------------------- instants et temps de travail

const lireInstant = (i) => ({ date: i.slice(0, 10), minute: Number(i.slice(11, 13)) * 60 + Number(i.slice(14, 16)) });
/** Instant « AAAA-MM-JJTHH:MM » ; 24:00 s'écrit comme tel (fin de journée). */
export const instant = (d, minute) => `${d}T${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

class ErreurCalendrier extends Error {
  constructor(code) { super(MESSAGES_CALENDRIER[code]); this.code = code; }
}

/**
 * Fin d'un travail de `minutes` commencé à `debut`, en suivant les plages (un début hors plage attend la suivante ;
 * un travail qui finit en fin de plage s'arrête à cette fin). 0 minute : le début. Calendrier vide : erreur CALENDRIER_VIDE.
 */
export function ajouterMinutesTravail(cal, fermes, debut, minutes) {
  if (minutes <= 0) return debut;
  const d0 = lireInstant(debut);
  let reste = minutes;
  for (let n = numeroJour(d0.date), k = 0; k <= HORIZON_JOURS; n++, k++) {
    const d = depuisNumero(n);
    for (const p of journee(cal, fermes, d).plages) {
      const de = k === 0 ? Math.max(p.debut, d0.minute) : p.debut;
      if (de >= p.fin) continue;
      if (p.fin - de >= reste) return instant(d, de + reste);
      reste -= p.fin - de;
    }
  }
  throw new ErreurCalendrier('CALENDRIER_VIDE');
}

/** Minutes travaillées entre deux instants (0 si fin ≤ début). */
export function minutesTravail(cal, fermes, debut, fin) {
  if (fin <= debut) return 0;
  const a = lireInstant(debut);
  const b = lireInstant(fin);
  let total = 0;
  for (let n = numeroJour(a.date); n <= numeroJour(b.date); n++) {
    const d = depuisNumero(n);
    const bas = d === a.date ? a.minute : 0;
    const haut = d === b.date ? b.minute : 1440;
    for (const p of journee(cal, fermes, d).plages) total += Math.max(0, Math.min(p.fin, haut) - Math.max(p.debut, bas));
  }
  return total;
}

/** Premier instant travaillé à partir de `i` (lui-même s'il est dans une plage). */
export function prochainTravail(cal, fermes, i) {
  const d0 = lireInstant(i);
  for (let n = numeroJour(d0.date), k = 0; k <= HORIZON_JOURS; n++, k++) {
    const d = depuisNumero(n);
    for (const p of journee(cal, fermes, d).plages) {
      const de = k === 0 ? Math.max(p.debut, d0.minute) : p.debut;
      if (de < p.fin) return instant(d, de);
    }
  }
  throw new ErreurCalendrier('CALENDRIER_VIDE');
}

// ---------------------------------------------------------------- contrôles

/** Contrôle d'un calendrier (cycle, référence, plages) : codes triés, sans doublon. */
export function controlerCalendrier(cal) {
  const e = new Set();
  const n = cal.cycle_semaines ?? 1;
  if (!Number.isInteger(n) || n < 1 || n > CYCLE_MAX) e.add('CAL_CYCLE');
  if (n > 1 && !cal.reference) e.add('CAL_REFERENCE');
  const plages = cal.plages ?? [];
  for (const p of plages) {
    if (!Number.isInteger(p.jour) || p.jour < 1 || p.jour > 7) e.add('PLG_JOUR');
    if (!Number.isInteger(p.semaine ?? 1) || (p.semaine ?? 1) < 1 || (p.semaine ?? 1) > n) e.add('PLG_SEMAINE');
    if (!(p.debut >= 0 && p.fin <= 1440 && p.debut < p.fin)) e.add('PLG_HEURES');
    if (p.du && p.au && p.au < p.du) e.add('PLG_PERIODE');
  }
  // Chevauchement : même semaine, même jour, même période (permanente ou mêmes dates).
  for (let i = 0; i < plages.length; i++) {
    for (let k = i + 1; k < plages.length; k++) {
      const a = plages[i];
      const b = plages[k];
      if ((a.semaine ?? 1) === (b.semaine ?? 1) && a.jour === b.jour && (a.du ?? null) === (b.du ?? null) && (a.au ?? null) === (b.au ?? null)
        && a.debut < b.fin && b.debut < a.fin) e.add('PLG_CHEVAUCHEMENT');
    }
  }
  return [...e].sort();
}

/** Contrôle d'une règle de jour fermé : codes triés. */
export function controlerRegle(r) {
  const e = [];
  const mois = () => { if (!Number.isInteger(r.mois) || r.mois < 1 || r.mois > 12) e.push('FER_MOIS'); };
  const semaine = () => { if (!Number.isInteger(r.jour) || r.jour < 1 || r.jour > 7) e.push('FER_JOUR'); };
  switch (r.regle) {
    case 'DATE': if (!r.date) e.push('FER_DATE'); break;
    case 'ANNUEL': mois(); if (!Number.isInteger(r.jour) || r.jour < 1 || r.jour > 31 || (Number.isInteger(r.mois) && r.mois >= 1 && r.mois <= 12 && r.jour > joursDuMois(2024, r.mois))) e.push('FER_JOUR'); break;
    case 'NIEME': mois(); semaine(); if (!Number.isInteger(r.rang) || r.rang < 1 || r.rang > 5) e.push('FER_RANG'); break;
    case 'DERNIER': mois(); semaine(); break;
    case 'PAQUES': if (!Number.isInteger(r.decalage ?? 0)) e.push('FER_JOUR'); break;
    case 'PERIODE': if (!r.du || !r.au || r.au < r.du) e.push('FER_PERIODE'); break;
    default: e.push('FER_REGLE');
  }
  return e.sort();
}

// ---------------------------------------------------------------- saisie (interface)

/** « 8:00-12:00 13:30-17:00 » → [{ debut, fin }] (minutes) ; null si la saisie est mal formée. */
export function lirePlages(texte) {
  const t = String(texte ?? '').trim();
  if (!t) return [];
  const res = [];
  for (const morceau of t.split(/[\s,;]+/).filter(Boolean)) {
    const m = /^(\d{1,2})(?:[:h](\d{2})?)?-(\d{1,2})(?:[:h](\d{2})?)?$/.exec(morceau);
    if (!m) return null;
    res.push({ debut: Number(m[1]) * 60 + Number(m[2] ?? 0), fin: Number(m[3]) * 60 + Number(m[4] ?? 0) });
  }
  return res;
}

/** [{ debut, fin }] → « 8:00-12:00 13:30-17:00 ». */
export function ecrirePlages(plages) {
  const h = (m) => `${Math.floor(m / 60)}:${pad(m % 60)}`;
  return plages.map((p) => `${h(p.debut)}-${h(p.fin)}`).join(' ');
}

/** Durée lisible : 450 → « 7 h 30 ». */
export function duree(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${pad(m)}` : `${h} h`;
}
