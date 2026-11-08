// Bornes des périodes glissantes d'un filtre de date, répliquées dans LogiBTP.Listes/Periodes.cs (jeu partagé
// tests/cas/04_periodes.json). Dates au format AAAA-MM-JJ, bornes incluses. Calcul pur : la date de référence
// (jour d'exécution) est fournie par l'appelant.
import { PERIODE, PERIODE_AVEC_NOMBRE, ERREUR_LISTE } from './codes.js';

const MS_JOUR = 86400000;
const lire = (iso) => { const [a, m, j] = iso.split('-').map(Number); return { a, m, j }; };
const utc = (a, m, j) => new Date(Date.UTC(a, m - 1, j));
const texte = (d) => d.toISOString().slice(0, 10);
const joursDuMois = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();
const ajouterJours = (d, n) => new Date(d.getTime() + n * MS_JOUR);

/** Date du même quantième, `n` mois plus loin (quantième ramené au dernier jour du mois si besoin). */
function ajouterMois(d, n) {
  const t = d.getUTCFullYear() * 12 + d.getUTCMonth() + n;
  const a = Math.floor(t / 12);
  const m = (t % 12) + 1;
  return utc(a, m, Math.min(d.getUTCDate(), joursDuMois(a, m)));
}

function erreur(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/**
 * Bornes [début, fin] d'une période.
 * @param {string} code code de `PERIODE`
 * @param {number|null} x nombre pour les périodes paramétrées (entier ≥ 1)
 * @param {string} reference date de référence AAAA-MM-JJ
 * @param {string|null} debutExercice date dont le mois et le jour donnent le début de l'exercice (année civile si absente)
 * @returns {{debut: string, fin: string}}
 */
export function bornesPeriode(code, x, reference, debutExercice = null) {
  const { a, m, j } = lire(reference);
  const ref = utc(a, m, j);
  const jour = (d) => ({ debut: texte(d), fin: texte(d) });
  const plage = (d, f) => ({ debut: texte(d), fin: texte(f) });
  const mois = (aa, mm) => plage(utc(aa, mm, 1), utc(aa, mm, joursDuMois(aa, mm)));
  const annee = (aa) => plage(utc(aa, 1, 1), utc(aa, 12, 31));
  const lundi = () => ajouterJours(ref, -((ref.getUTCDay() + 6) % 7));

  if (PERIODE_AVEC_NOMBRE.includes(code) && !(Number.isInteger(x) && x >= 1)) {
    throw erreur(ERREUR_LISTE.PERIODE_NOMBRE, `Période ${code} : nombre entier supérieur ou égal à 1 attendu`);
  }
  switch (code) {
    case PERIODE.AUJOURD_HUI: return jour(ref);
    case PERIODE.HIER: return jour(ajouterJours(ref, -1));
    case PERIODE.SEMAINE_EN_COURS: { const d = lundi(); return plage(d, ajouterJours(d, 6)); }
    case PERIODE.SEMAINE_PRECEDENTE: { const d = ajouterJours(lundi(), -7); return plage(d, ajouterJours(d, 6)); }
    case PERIODE.MOIS_EN_COURS: return mois(a, m);
    case PERIODE.MOIS_PRECEDENT: { const d = ajouterMois(utc(a, m, 1), -1); return mois(d.getUTCFullYear(), d.getUTCMonth() + 1); }
    case PERIODE.TRIMESTRE_EN_COURS: {
      const premier = Math.floor((m - 1) / 3) * 3 + 1;
      return plage(utc(a, premier, 1), utc(a, premier + 2, joursDuMois(a, premier + 2)));
    }
    case PERIODE.ANNEE_EN_COURS: return annee(a);
    case PERIODE.ANNEE_PRECEDENTE: return annee(a - 1);
    case PERIODE.EXERCICE_EN_COURS: {
      if (!debutExercice) return annee(a);
      const de = lire(debutExercice);
      const debutDe = (aa) => utc(aa, de.m, Math.min(de.j, joursDuMois(aa, de.m)));
      const debut = debutDe(a) > ref ? debutDe(a - 1) : debutDe(a);
      return plage(debut, ajouterJours(ajouterMois(debut, 12), -1));
    }
    case PERIODE.DERNIERS_JOURS: return plage(ajouterJours(ref, -(x - 1)), ref);
    case PERIODE.DERNIERS_MOIS: return plage(ajouterJours(ajouterMois(ref, -x), 1), ref);
    case PERIODE.PROCHAINS_JOURS: return plage(ref, ajouterJours(ref, x - 1));
    default: throw erreur(ERREUR_LISTE.PERIODE_INCONNUE, `Période inconnue : ${code}`);
  }
}
