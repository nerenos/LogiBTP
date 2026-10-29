// Chrono du code d'une fiche (code prévisionnel, contrôle, code suivant), répliqué dans LogiBTP.Fiches/ChronoFiche.cs
// (jeu partagé modules/fiche/tests/cas/02_chrono.json).
//
// Format : jetons {P} (préfixe), {AAAA} ou {AA} (année de l'exercice), {N} ou {N:k} (rang, sur k chiffres au moins),
// {PARENT} (code de la fiche parente : rang = plus grand rang des codes du parent + 1, sans compteur) ; le reste est
// littéral. Le rang est remis à zéro chaque exercice (raz A, l'année doit figurer dans le code) ou jamais (J).

export const FORMAT_CHRONO_DEFAUT = '{P}{N:6}';

const JETONS = /\{(P|AAAA|AA|PARENT|N(?::([1-9]))?)\}/g;
const echapperRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const effectif = (format) => (format && format.trim() ? format.trim() : FORMAT_CHRONO_DEFAUT);
const jetons = (f) => [...f.matchAll(JETONS)];

/** Exercice du compteur : l'année, ou 0 pour un rang jamais remis à zéro (J). */
export const exerciceChrono = (raz, annee) => (raz === 'J' ? 0 : annee);

/** Message d'erreur du format, null s'il est valable. */
export function controlerChrono({ format, raz }) {
  const f = effectif(format);
  if (f.length > 40) return 'Format de 40 caractères au plus';
  const js = jetons(f).map((m) => m[1]);
  const reste = f.replace(JETONS, '');
  if (reste.includes('{') || reste.includes('}')) return 'Jeton inconnu : {P}, {AAAA}, {AA}, {N}, {N:k} ou {PARENT} seulement';
  if (js.filter((j) => j.startsWith('N')).length !== 1) return 'Le format porte un rang {N} (ou {N:k}), une seule fois';
  if (js.filter((j) => j === 'AAAA' || j === 'AA').length > 1) return 'Une seule année dans le format';
  if (js.filter((j) => j === 'PARENT').length > 1) return 'Un seul {PARENT} dans le format';
  if (raz === 'A' && !js.some((j) => j === 'AAAA' || j === 'AA')) return "Rang remis à zéro chaque exercice : l'année ({AAAA} ou {AA}) doit figurer dans le code";
  return null;
}

/** Code d'un rang pour l'année (et le parent) donnés. */
export function formaterCode({ format, prefixe }, { annee = 0, rang, parent = '' }) {
  return effectif(format).replace(JETONS, (_, j, k) => {
    if (j === 'P') return prefixe ?? '';
    if (j === 'AAAA') return String(annee).padStart(4, '0');
    if (j === 'AA') return String(annee % 100).padStart(2, '0');
    if (j === 'PARENT') return parent ?? '';
    return String(rang).padStart(k ? Number(k) : 1, '0');
  });
}

/** Année et rang d'un code au format, null s'il ne le suit pas (rang nul refusé). */
export function lireCode({ format, prefixe }, code, { parent = '' } = {}) {
  if (code === null || code === undefined || !String(code).trim()) return null;
  const f = effectif(format);
  let motif = '^';
  let i = 0;
  for (const m of jetons(f)) {
    motif += echapperRegex(f.slice(i, m.index));
    const j = m[1];
    motif += j === 'P' ? echapperRegex(prefixe ?? '') : j === 'PARENT' ? echapperRegex(parent ?? '')
      : j === 'AAAA' ? '(?<a>\\d{4})' : j === 'AA' ? '(?<aa>\\d{2})' : '(?<n>\\d{1,9})';
    i = m.index + m[0].length;
  }
  motif += `${echapperRegex(f.slice(i))}$`;
  const r = new RegExp(motif).exec(String(code).trim());
  if (!r) return null;
  const rang = Number(r.groups.n);
  if (rang <= 0) return null;
  const annee = r.groups.a ? Number(r.groups.a) : r.groups.aa ? 2000 + Number(r.groups.aa) : null;
  return { annee, rang };
}

/**
 * Début commun des codes (filtre des codes pris) : jusqu'au rang, l'année remplacée (codes d'un exercice) ; sans
 * année (annee null : compteur jamais remis à zéro), jusqu'au premier jeton variable.
 */
export function debutCode({ format, prefixe }, { annee = null, parent = '' } = {}) {
  const f = effectif(format);
  const m = jetons(f).find((x) => x[1].startsWith('N') || (annee === null && (x[1] === 'AAAA' || x[1] === 'AA')));
  return formaterCode({ format: m ? f.slice(0, m.index) : f, prefixe }, { annee: annee ?? 0, rang: 0, parent });
}

/**
 * Code suivant une saisie déjà prise : nombre final augmenté de 1 sur la même longueur (CH-2026-010 → CH-2026-011,
 * 099 → 100), sinon « 1 » ajouté (DUPONT → DUPONT1, puis DUPONT2…).
 */
export function codeSuivant(code) {
  const s = String(code ?? '').trim();
  if (!s) return null;
  const m = /(\d+)$/.exec(s);
  if (!m) return `${s}1`;
  const n = String(BigInt(m[1]) + 1n);
  return s.slice(0, m.index) + n.padStart(m[1].length, '0');
}
