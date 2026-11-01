import { texte } from '@logibtp/socle/dictionnaire';
import { Dec } from '@logibtp/socle';

// Lexeur du langage de script des métrés (réplique de Script/Lexeur.cs).
// Jetons : nb (nombre), ch (chaîne), ref ({{…}} ou variable de portée), id (identifiant), mc (mot-clé),
// op (opérateur), nl (fin d'instruction), fin (fin du texte). Chaque jeton porte sa ligne, sa colonne
// (1 = premier caractère) et ses positions dans le texte (debut, fin).

// Lettres accentuées et lettre de base (table explicite, identique côté C# : pas de normalisation Unicode,
// indisponible en mode de globalisation invariante).
const ACCENTUEES = 'àáâãäåāăąçćĉċčďèéêëēĕėęěĝğġģĥìíîïĩīĭįıĵķĺļľñńņňŉòóôõöōŏőŕŗřśŝşšţťùúûüũūŭůűųŵýÿŷźżž';
const BASES = 'aaaaaaaaacccccdeeeeeeeeegggghiiiiiiiiijklllnnnnnoooooooorrrssssttuuuuuuuuuuwyyyzzz';

/** Forme normalisée d'un mot : minuscules sans accents (mots-clés, types, fonctions). */
export function normaliser(mot) {
  let r = '';
  for (const c of mot.toLowerCase()) {
    const k = ACCENTUEES.indexOf(c);
    r += k < 0 ? c : BASES[k];
  }
  return r;
}

/** Mots réservés (forme normalisée) ; « est », « un », les types et « à » ne le sont qu'en contexte. */
export const MOTS_CLES = new Set([
  'si', 'alors', 'sinon', 'sinonsi', 'fin', 'pour', 'renvoyer', 'sortir', 'continuer',
  'et', 'ou', 'pas', 'modulo', 'vrai', 'faux', 'local',
]);

const OPERATEURS_DOUBLES = ['<>', '<=', '>=', '+=', '-=', '*=', '/=', '++', '--'];
const OPERATEURS_SIMPLES = '+-*/();=<>';
const UNICODE = { '×': '*', '÷': '/', '−': '-', '≤': '<=', '≥': '>=', '≠': '<>' };

// Une fin de ligne est ignorée après ces jetons (l'instruction continue) ou avant ceux de SUITE.
const CONTINUE_APRES = new Set(['+', '-', '*', '/', '=', '<>', '<', '<=', '>', '>=', ';', '(', '+=', '-=', '*=', '/=', 'et', 'ou', 'modulo', 'pas']);
const SUITE = new Set(['+', '-', '*', '/', '<>', '<', '<=', '>', '>=', 'et', 'ou', 'modulo']);

// Plus grande valeur d'un decimal C# (réplique exacte des deux côtés).
export const MAX_DECIMAL = new Dec('79228162514264337593543950335');

const RE_DEBUT_ID = /[\p{L}_]/u;
const RE_SUITE_ID = /[\p{L}\p{N}_]/u;
const estChiffre = (c) => c !== undefined && c >= '0' && c <= '9';

/** Découpe le texte ; renvoie { jetons, erreurs } (erreurs de syntaxe : { code, message, ligne, colonne }). */
export function decouper(script) {
  const s = script ?? '';
  const brut = [];
  const erreurs = [];
  let i = 0;
  let ligne = 1;
  let debutLigne = 0;
  let profondeur = 0;
  const pos = (k) => ({ ligne, colonne: k - debutLigne + 1 });
  const erreur = (k, message) => erreurs.push({ code: 'SYNTAXE', message, ...pos(k) });
  const pousser = (t, v, debut, fin, extra) => brut.push({ t, v, debut, fin, ...pos(debut), ...extra });

  while (i < s.length) {
    const c = s[i];
    if (c === '\n') {
      if (profondeur === 0) pousser('nl', null, i, i + 1);
      i++;
      ligne++;
      debutLigne = i;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || /\s/.test(c)) { i++; continue; }
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (c === '{' && s[i + 1] === '{') {
      const fin = s.indexOf('}}', i + 2);
      const finLigne = s.indexOf('\n', i);
      if (fin < 0 || (finLigne >= 0 && finLigne < fin)) {
        erreur(i, texte('metre.script.accolades'));
        i = finLigne < 0 ? s.length : finLigne;
        continue;
      }
      pousser('ref', s.slice(i + 2, fin).trim(), i, fin + 2);
      i = fin + 2;
      continue;
    }
    if ((c === '$' || c === '@') && s[i + 1] !== undefined) {
      const double = s[i + 1] === c;
      let j = i + (double ? 2 : 1);
      if (RE_DEBUT_ID.test(s[j] ?? '')) {
        while (j < s.length && RE_SUITE_ID.test(s[j])) j++;
        pousser('ref', s.slice(i, j), i, j);
        i = j;
        continue;
      }
    }
    if (estChiffre(c)) {
      let j = i;
      while (estChiffre(s[j])) j++;
      if ((s[j] === '.' || s[j] === ',') && estChiffre(s[j + 1])) {
        j++;
        while (estChiffre(s[j])) j++;
      }
      if (RE_SUITE_ID.test(s[j] ?? '')) {
        erreur(j, texte('metre.script.apres_nombre', { caractere: s[j] }));
        while (j < s.length && RE_SUITE_ID.test(s[j])) j++;
        i = j;
        continue;
      }
      const v = new Dec(s.slice(i, j).replace(',', '.'));
      if (v.gt(MAX_DECIMAL)) erreur(i, texte('metre.script.nombre_trop_grand'));
      pousser('nb', v.gt(MAX_DECIMAL) ? new Dec(0) : v, i, j);
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let v = '';
      let ferme = false;
      while (j < s.length && s[j] !== '\n') {
        if (s[j] === '"') {
          if (s[j + 1] === '"') { v += '"'; j += 2; continue; }
          ferme = true;
          j++;
          break;
        }
        v += s[j++];
      }
      // Chaîne non fermée : signalée, mais gardée pour ne pas provoquer d'autres erreurs.
      if (!ferme) erreur(i, texte('metre.script.guillemet'));
      pousser('ch', v, i, j);
      i = j;
      continue;
    }
    if (RE_DEBUT_ID.test(c)) {
      let j = i;
      while (j < s.length && RE_SUITE_ID.test(s[j])) j++;
      const mot = s.slice(i, j);
      const n = normaliser(mot);
      pousser(MOTS_CLES.has(n) ? 'mc' : 'id', mot, i, j, { n });
      i = j;
      continue;
    }
    const double = s.slice(i, i + 2);
    if (OPERATEURS_DOUBLES.includes(double)) {
      pousser('op', double, i, i + 2);
      i += 2;
      continue;
    }
    const op = UNICODE[c] ?? (OPERATEURS_SIMPLES.includes(c) ? c : null);
    if (op) {
      if (op === '(') profondeur++;
      if (op === ')') profondeur = Math.max(0, profondeur - 1);
      pousser('op', op, i, i + 1);
      i++;
      continue;
    }
    if (c === ',') {
      // Virgule entre deux arguments : signalée, puis lue comme un point-virgule.
      erreur(i, texte('metre.script.point_virgule'));
      pousser('op', ';', i, i + 1);
    } else erreur(i, texte('metre.script.caractere', { caractere: c }));
    i++;
  }
  brut.push({ t: 'fin', v: null, debut: s.length, fin: s.length, ...pos(s.length) });

  // Fins de ligne : une seule entre deux instructions, ignorées quand l'instruction continue.
  const cle = (j) => (j.t === 'op' ? j.v : j.t === 'mc' ? j.n : null);
  const jetons = [];
  for (let k = 0; k < brut.length; k++) {
    const j = brut[k];
    if (j.t === 'nl') {
      const prec = jetons[jetons.length - 1];
      if (!prec || prec.t === 'nl' || CONTINUE_APRES.has(cle(prec))) continue;
      let m = k + 1;
      while (brut[m].t === 'nl') m++;
      if (SUITE.has(cle(brut[m]))) continue;
    }
    jetons.push(j);
  }
  return { jetons, erreurs };
}
