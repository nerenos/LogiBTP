// Dates « AAAA-MM-JJ » sans fuseau (jour civil) : calculs à minuit UTC, sans changement d'heure ni DOM.
// La date du jour se lit dans le fuseau du poste : `toISOString()` donnerait la date UTC, la veille entre 0 h et 2 h
// en France.

const JOUR_MS = 86400000;
const pad = (n, l = 2) => String(n).padStart(l, '0');
const ms = (d) => Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`);

/** Date « AAAA-MM-JJ » d'un instant (Date, horodatage ou texte ISO) dans le fuseau du poste. */
export function dateLocale(instant = new Date()) {
  const d = instant instanceof Date ? instant : new Date(instant);
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Date du jour « AAAA-MM-JJ » dans le fuseau du poste. */
export const aujourdhui = () => dateLocale();

/** Numéro de jour (jours depuis le 1970-01-01). */
export const numeroJour = (d) => Math.round(ms(d) / JOUR_MS);
export const depuisNumero = (n) => new Date(n * JOUR_MS).toISOString().slice(0, 10);
export const ajouterJours = (d, n) => depuisNumero(numeroJour(d) + n);
/** Nombre de jours de `de` à `a`. */
export const joursEntre = (de, a) => numeroJour(a) - numeroJour(de);
/** Jour ISO de la semaine : 1 lundi … 7 dimanche. */
export const jourSemaine = (d) => ((new Date(ms(d)).getUTCDay() + 6) % 7) + 1;
/** Nombre de jours du mois (m : 1 à 12). */
export const joursDuMois = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();

/** Date + n mois, jour ramené au dernier du mois s'il n'existe pas (31 janvier + 1 mois = 28 ou 29 février). */
export function ajouterMois(d, n) {
  const [a, m, j] = String(d).slice(0, 10).split('-').map(Number);
  const total = a * 12 + (m - 1) + n;
  const an = Math.floor(total / 12);
  const mois = total - an * 12 + 1;
  return `${pad(an, 4)}-${pad(mois)}-${pad(Math.min(j, joursDuMois(an, mois)))}`;
}

/**
 * Saisie abrégée d'une date (champs de date de l'interface) → « AAAA-MM-JJ », '' si la saisie est vide, null si elle
 * ne désigne aucune date. Le jour, le mois et l'année absents sont ceux de `reference` (la date du jour) :
 *   « 15 » → 15 du mois en cours ; « 16/05 » → 16/05 de l'année en cours ; séparateurs / . - ou espace ;
 *   sans séparateur : « 1505 » (JJMM), « 150523 » (JJMMAA), « 15052023 » (JJMMAAAA) ;
 *   année < 100 (« 23 », « 0023 ») → 20xx, sauf au-delà de l'année en cours + 10 → 19xx (« 65 » → 1965) ;
 *   « +3 » / « -2 » : jours à partir d'aujourd'hui ; « t » ou « a » : aujourd'hui ; « JJ/MM/AAAA » ou « AAAA-MM-JJ » complets.
 */
export function completerDate(saisie, reference = aujourdhui()) {
  const s = String(saisie ?? '').trim().toLowerCase();
  if (s === '') return '';
  const [ra, rm] = String(reference).slice(0, 10).split('-').map(Number);
  if (s === 't' || s === 'a') return String(reference).slice(0, 10);
  const decalage = /^([+-])\s*(\d{1,4})$/.exec(s);
  if (decalage) return ajouterJours(reference, (decalage[1] === '-' ? -1 : 1) * Number(decalage[2]));
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  let parts;
  if (iso) parts = [iso[3], iso[2], iso[1]];
  else if (/^\d+$/.test(s)) {
    if (s.length <= 2) parts = [s];
    else if (s.length === 4) parts = [s.slice(0, 2), s.slice(2)];
    else if (s.length === 6 || s.length === 8) parts = [s.slice(0, 2), s.slice(2, 4), s.slice(4)];
    else return null;
  } else {
    parts = s.split(/[/.\-\s]+/);
    if (parts.length > 3 || parts.some((p) => !/^\d{1,4}$/.test(p))) return null;
  }
  const j = Number(parts[0]);
  const m = parts.length > 1 ? Number(parts[1]) : rm;
  let a = ra;
  if (parts.length > 2) {
    a = Number(parts[2]);
    if (parts[2].length > 4) return null;
    if (a < 100) a += a > (ra % 100) + 10 ? 1900 : 2000;
    if (parts[1].length > 2) return null;
  }
  if (parts.length > 1 && String(parts[1]).length > 2) return null;
  if (String(parts[0]).length > 2) return null;
  if (m < 1 || m > 12 || j < 1 || j > joursDuMois(a, m)) return null;
  return `${pad(a, 4)}-${pad(m)}-${pad(j)}`;
}

/** « AAAA-MM-JJ » → « JJ/MM/AAAA » (texte d'un champ de date) ; autre valeur → ''. */
export function texteDate(iso) {
  const r = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return r ? `${r[3]}/${r[2]}/${r[1]}` : '';
}
