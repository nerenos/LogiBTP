import { texte, textesParCode, pairesParCode } from '@logibtp/socle/dictionnaire';

// Validation des champs d'une fiche : même sémantique que ValidationFiche côté C# (jeu partagé
// modules/fiche/tests/cas/01_validation.json).
//
// Champ : { type: 'texte' | 'zone' | 'html' | 'json' | 'nombre' | 'booleen' | 'date' | 'liste' | 'motdepasse', format, longueur,
//           options, obligatoire (programme), obligatoire_parametre (paramétrage utilisateur) } ; un mot de passe se valide
//           comme un texte (longueur, format), sur sa valeur en clair.
// Formats : email, telephone, code_postal, masque numérique (999.99 : 3 chiffres entiers, 2 décimales), regex:…

export const MESSAGES = textesParCode('fiche.validation', ['OBLIGATOIRE', 'LONGUEUR', 'NOMBRE', 'DATE', 'LISTE', 'BOOLEEN', 'FORMAT']);

export const FORMATS_PREDEFINIS = pairesParCode('fiche.formats', ['email', 'telephone', 'code_postal']);

const vide = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const estObligatoire = (c) => !!(c.obligatoire || c.obligatoire_parametre);

/** Nombre d'une saisie (virgule acceptée), ou null si invalide. */
export function nombreSaisi(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/[\s  ]/g, '').replace(',', '.');
  return /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s) ? Number(s) : null;
}

function dateValide(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Masque numérique « 999.99 » : nombre maximal de chiffres entiers et de décimales. */
function respecteMasque(valeur, masque) {
  const [ent, dec = ''] = masque.split(/[.,]/);
  const s = String(typeof valeur === 'number' ? valeur : String(valeur).trim().replace(',', '.')).replace(/^[+-]/, '');
  const [e, d = ''] = s.split('.');
  return e.replace(/^0+(?=\d)/, '').length <= ent.length && d.length <= dec.length;
}

function respecteFormat(texte, format) {
  const t = String(texte).trim();
  switch (format) {
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t);
    case 'telephone': {
      const n = t.replace(/[\s.\-()]/g, '');
      return /^0[1-9]\d{8}$/.test(n) || /^\+\d{8,15}$/.test(n);
    }
    case 'code_postal': return /^\d{5}$/.test(t);
    default:
      if (format.startsWith('regex:')) {
        try { return new RegExp(format.slice(6)).test(t); } catch { return true; }
      }
      return true;
  }
}

/**
 * Requête SQL d'une liste de valeurs (champ supplémentaire) : une seule instruction SELECT (ou WITH … SELECT). Message
 * d'erreur, ou null si elle est acceptable (même règle que ServiceFiche.ErreurRequete ; le serveur l'exécute en lecture seule).
 */
export function erreurRequete(sql) {
  const t = String(sql ?? '').trim().replace(/;+\s*$/, '').trim();
  if (!t) return texte('fiche.requete.vide');
  if (!/^(select|with)\b/i.test(t)) return texte('fiche.requete.select');
  if (t.includes(';')) return texte('fiche.requete.une_instruction');
  return null;
}

/** Code d'erreur d'un champ pour une valeur, ou null si la valeur est acceptée. */
export function validerChamp(champ, valeur) {
  if (vide(valeur)) return estObligatoire(champ) ? 'OBLIGATOIRE' : null;
  switch (champ.type) {
    case 'nombre': {
      const n = nombreSaisi(valeur);
      if (n === null) return 'NOMBRE';
      if (champ.format && /^9+([.,]9+)?$/.test(champ.format) && !respecteMasque(valeur, champ.format)) return 'FORMAT';
      return null;
    }
    case 'date': return dateValide(valeur) ? null : 'DATE';
    case 'booleen': return typeof valeur === 'boolean' || ['true', 'false'].includes(String(valeur)) ? null : 'BOOLEEN';
    case 'liste': return (champ.options ?? []).some((o) => String(o.valeur) === String(valeur)) ? null : 'LISTE';
    case 'json':
      if (typeof valeur !== 'string') return null;
      try { JSON.parse(valeur); return null; } catch { return 'FORMAT'; }
    default: {
      const t = String(valeur);
      if (champ.longueur && [...t].length > champ.longueur) return 'LONGUEUR';
      if (champ.format && !respecteFormat(t, champ.format)) return 'FORMAT';
      return null;
    }
  }
}

/**
 * Erreurs d'une fiche : [{ champ, code, message, supplementaire }]. Les champs confidentiels masqués (valeur non
 * connue du poste) ne sont pas contrôlés ici : le serveur contrôle la ligne complète à l'enregistrement.
 */
export function validerFiche(definition, valeurs, proprietes = {}, { masques = new Set() } = {}) {
  const erreurs = [];
  for (const c of definition.champs) {
    if (c.lecture_seule || masques.has(c.code)) continue;
    const code = validerChamp(c, valeurs[c.code]);
    if (code) erreurs.push({ champ: c.code, code, message: MESSAGES[code], supplementaire: false });
  }
  for (const c of definition.supplementaires ?? []) {
    if (masques.has(`+${c.code}`)) continue;
    const code = validerChamp(c, proprietes[c.code]);
    if (code) erreurs.push({ champ: c.code, code, message: MESSAGES[code], supplementaire: true });
  }
  return erreurs;
}
