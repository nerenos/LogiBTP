// Styles des lignes (plan fiches-lignes-documents, lot 5), répliqués dans Calcul/StylesLignes.cs (jeu partagé
// modules/document/tests/styles/01_styles_lignes.json).
//
// Classe d'une ligne selon son type et sa position (CLASSE_STYLE_LIGNE) : titre de profondeur n (TRANCHE_n, au-delà
// de 5 : TRANCHE_5), section, ouvrage (SOUS_OUVRAGE sous un ouvrage), élément (COMPOSANTE sous un ouvrage), texte,
// sous-total ; les autres types (image, saut de page, pieds) n'ont pas de classe.
//
// Style résolu, propriété par propriété : défaut du programme (aucun) < global < famille < type de document <
// document (ent_styles_lignes) < style propre de la ligne (lig_style). Les couleurs sont un #rrggbb ou une variable
// du thème (--nom) ; la mise en forme saisie dans le libellé reste au-dessus (rendu, caractère par caractère).

import { CLASSE_STYLE_LIGNE, TAILLE_STYLE_LIGNE } from './codes.js';
import { TL } from './types.js';

/** Propriétés d'un style de ligne, dans l'ordre d'affichage. */
export const PROPRIETES_STYLE_LIGNE = Object.freeze(['couleur', 'fond', 'gras', 'italique', 'souligne', 'barre', 'taille']);
const COULEURS = new Set(['couleur', 'fond']);
const BOOLEENS = new Set(['gras', 'italique', 'souligne', 'barre']);
const TAILLES = new Set(Object.values(TAILLE_STYLE_LIGNE));
const CLASSES = new Set(Object.values(CLASSE_STYLE_LIGNE));

/** Défauts du programme : aucun style (le rendu actuel). */
export const STYLES_DEFAUT_LIGNE = Object.freeze(Object.fromEntries(Object.values(CLASSE_STYLE_LIGNE).map((c) => [c, Object.freeze({})])));

const couleurValide = (v) => typeof v === 'string' && /^(#[0-9a-fA-F]{6}|--[a-z0-9-]+)$/.test(v);

function valeurValide(propriete, v) {
  if (COULEURS.has(propriete)) return couleurValide(v);
  if (BOOLEENS.has(propriete)) return typeof v === 'boolean';
  return TAILLES.has(v);
}

/** Style nettoyé : seules les propriétés connues à valeur valide (null et valeurs invalides ignorés), hexadécimal en minuscules. */
export function normaliserStyle(style) {
  const res = {};
  if (!style || typeof style !== 'object' || Array.isArray(style)) return res;
  for (const p of PROPRIETES_STYLE_LIGNE) {
    const v = style[p];
    if (v === null || v === undefined || !valeurValide(p, v)) continue;
    res[p] = COULEURS.has(p) && v.startsWith('#') ? v.toLowerCase() : v;
  }
  return res;
}

/** Fautes d'un style saisi : propriété inconnue ou valeur invalide (null admis = pas de valeur). */
export function erreursStyle(style) {
  if (style === null || style === undefined) return [];
  if (typeof style !== 'object' || Array.isArray(style)) return ['STYLE_FORME'];
  const fautes = [];
  for (const [p, v] of Object.entries(style)) {
    if (!PROPRIETES_STYLE_LIGNE.includes(p)) fautes.push(`STYLE_PROPRIETE:${p}`);
    else if (v !== null && !valeurValide(p, v)) fautes.push(`STYLE_VALEUR:${p}`);
  }
  return fautes;
}

/** Fautes des styles par classe d'un document : { CLASSE: style }. */
export function erreursStylesDocument(styles) {
  if (styles === null || styles === undefined) return [];
  if (typeof styles !== 'object' || Array.isArray(styles)) return ['STYLE_FORME'];
  return Object.entries(styles).flatMap(([c, s]) => (CLASSES.has(c) ? erreursStyle(s) : [`STYLE_CLASSE:${c}`]));
}

/** Classe de chaque ligne : Map lig_id → classe de style (null : type sans style de classe). */
export function classesLignes(lignes) {
  const parId = new Map(lignes.map((l) => [l.lig_id, l]));
  const ancetres = (l) => {
    const res = [];
    let p = parId.get(l.lig_parent_id);
    while (p && res.length <= lignes.length) { res.push(p); p = parId.get(p.lig_parent_id); }
    return res;
  };
  const classes = new Map();
  for (const l of lignes) {
    let classe = null;
    switch (l.lig_tyl_id) {
      case TL.TITRE: {
        const n = Math.min(1 + ancetres(l).filter((a) => a.lig_tyl_id === TL.TITRE).length, 5);
        classe = CLASSE_STYLE_LIGNE[`TRANCHE_${n}`];
        break;
      }
      case TL.SECTION: classe = CLASSE_STYLE_LIGNE.SECTION; break;
      case TL.OUVRAGE: classe = ancetres(l).some((a) => a.lig_tyl_id === TL.OUVRAGE) ? CLASSE_STYLE_LIGNE.SOUS_OUVRAGE : CLASSE_STYLE_LIGNE.OUVRAGE; break;
      case TL.ELEMENT: classe = ancetres(l).some((a) => a.lig_tyl_id === TL.OUVRAGE) ? CLASSE_STYLE_LIGNE.COMPOSANTE : CLASSE_STYLE_LIGNE.ELEMENT; break;
      case TL.TEXTE: classe = CLASSE_STYLE_LIGNE.TEXTE; break;
      case TL.SOUS_TOTAL: classe = CLASSE_STYLE_LIGNE.SOUS_TOTAL; break;
      default: break;
    }
    classes.set(l.lig_id, classe);
  }
  return classes;
}

/**
 * Style paramétré d'une classe pour un document : défaut, global, famille, type, document.
 * contexte : { famille, type (code), styles: [{ classe, famille, type, valeur }], document: { CLASSE: style } | null }.
 */
export function styleDeClasse(classe, contexte = {}) {
  const lignes = (contexte.styles ?? []).filter((s) => s.classe === classe);
  const niveau = (f) => normaliserStyle(lignes.find(f)?.valeur);
  return {
    ...normaliserStyle(STYLES_DEFAUT_LIGNE[classe]),
    ...niveau((s) => !s.famille && !s.type),
    ...(contexte.famille ? niveau((s) => !s.type && s.famille === contexte.famille) : {}),
    ...(contexte.type ? niveau((s) => !s.famille && s.type === contexte.type) : {}),
    ...normaliserStyle(contexte.document?.[classe]),
  };
}

/** Style résolu d'une ligne : style de sa classe, puis style propre de la ligne (lig_style). Objet vide : rendu actuel. */
export function styleLigne(ligne, classe, contexte = {}) {
  return { ...(classe ? styleDeClasse(classe, contexte) : {}), ...normaliserStyle(ligne.lig_style) };
}

/** Styles résolus de toutes les lignes ayant un style : Map lig_id → style. */
export function stylesLignes(lignes, contexte = {}) {
  const classes = classesLignes(lignes);
  const res = new Map();
  for (const l of lignes) {
    const s = styleLigne(l, classes.get(l.lig_id), contexte);
    if (Object.keys(s).length) res.set(l.lig_id, s);
  }
  return res;
}
