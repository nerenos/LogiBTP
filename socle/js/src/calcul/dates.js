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
