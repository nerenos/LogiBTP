// Paramètres d'émission BTP d'une facture électronique (plans/facturation-electronique.md, lot 21 ; analyse § 2.9, Q8) :
// code BT-3 du type de pièce, nature biens / services / mixte de la pièce, cadre de facturation BT-23, code BT-8 (option
// TVA sur les débits) et notes légales PMT / PMD / AAB. Répliqué dans src/LogiBTP.Calcul/EmissionFeBtp.cs
// (jeu tests/emission-fe/01_emission.json).
import { TL, estChiffree, estPied } from '@logibtp/document';
import { TYPE_FACTURE, CADRE_FACTURATION, CODE_NOTE, CODE_EXIGIBILITE_TVA } from '@logibtp/facture-electronique';
import { NATURE_FE, SITUATION_CADRE_FE } from '../app/codes.js';

const NATURES_LIGNE = new Set([NATURE_FE.BIENS, NATURE_FE.SERVICES]);
const NATURES_PIECE = new Set([NATURE_FE.BIENS, NATURE_FE.SERVICES, NATURE_FE.MIXTE]);

/** Cadre BT-23 par situation et par nature (sous-traitant et cotraitant : services seulement). */
export const CADRES_FE = Object.freeze({
  [SITUATION_CADRE_FE.DEPOT]: { [NATURE_FE.BIENS]: CADRE_FACTURATION.B1, [NATURE_FE.SERVICES]: CADRE_FACTURATION.S1, [NATURE_FE.MIXTE]: CADRE_FACTURATION.M1 },
  [SITUATION_CADRE_FE.DEJA_PAYEE]: { [NATURE_FE.BIENS]: CADRE_FACTURATION.B2, [NATURE_FE.SERVICES]: CADRE_FACTURATION.S2, [NATURE_FE.MIXTE]: CADRE_FACTURATION.M2 },
  [SITUATION_CADRE_FE.DEFINITIVE_APRES_ACOMPTE]: { [NATURE_FE.BIENS]: CADRE_FACTURATION.B4, [NATURE_FE.SERVICES]: CADRE_FACTURATION.S4, [NATURE_FE.MIXTE]: CADRE_FACTURATION.M4 },
  [SITUATION_CADRE_FE.SOUS_TRAITANT]: { [NATURE_FE.SERVICES]: CADRE_FACTURATION.S5 },
  [SITUATION_CADRE_FE.COTRAITANT]: { [NATURE_FE.SERVICES]: CADRE_FACTURATION.S6 },
});

const vide = (v) => v === null || v === undefined || v === '';

/**
 * Lignes vendues d'une pièce : lignes de prix (élément, ouvrage) sans ancêtre ouvrage (une composante suit son ouvrage),
 * hors pied, hors écart d'arrondi, et sans type de prix hors total sur elles ou leurs ancêtres (option, variante, pour
 * mémoire, frais annexes).
 */
export function lignesVendues(lignes) {
  const parId = new Map(lignes.map((l) => [l.lig_id, l]));
  const parent = (l) => (vide(l.lig_parent_id) ? null : parId.get(l.lig_parent_id) ?? null);
  return lignes.filter((l) => {
    if (!estChiffree(l) || estPied(l) || l.lig_is_ecart_arrondi) return false;
    if ((l.lig_type_prix ?? 'V') !== 'V') return false;
    for (let x = parent(l); x; x = parent(x)) {
      if (x.lig_tyl_id === TL.OUVRAGE || (x.lig_type_prix ?? 'V') !== 'V') return false;
    }
    return true;
  });
}

/**
 * Nature d'une ligne vendue : celle de sa nature d'article (nat_fe_nature, B ou S) ; un ouvrage (fourniture et pose) et
 * une ligne dont la nature n'en porte pas sont des services (travaux immobiliers).
 * naturesFe : { [nat_id]: 'B' | 'S' }.
 */
export function natureLigne(l, naturesFe = {}) {
  if (l.lig_tyl_id === TL.OUVRAGE) return NATURE_FE.SERVICES;
  const n = vide(l.lig_nat_id) ? null : naturesFe[l.lig_nat_id] ?? naturesFe[String(l.lig_nat_id)] ?? null;
  return NATURES_LIGNE.has(n) ? n : NATURE_FE.SERVICES;
}

/**
 * Nature de la pièce : surcharge de l'entête (ent_fe_nature) si elle est valide, sinon B ou S si toutes les lignes vendues
 * sont de cette nature, M si les deux se mêlent ; sans ligne vendue : services.
 */
export function naturePiece(lignes, { naturesFe = {}, surcharge = null } = {}) {
  if (NATURES_PIECE.has(surcharge)) return surcharge;
  const natures = new Set(lignesVendues(lignes).map((l) => natureLigne(l, naturesFe)));
  if (natures.size > 1) return NATURE_FE.MIXTE;
  return natures.size === 1 ? [...natures][0] : NATURE_FE.SERVICES;
}

/**
 * Code BT-3 de la pièce : celui de son type (tyd_fe_type_facture ; vide : type jamais émis, null) ; un avoir (381) d'une
 * facture d'acompte (386) devient un avoir d'acompte (503).
 */
export function typeFacture(typeDuType, typeOrigine = null) {
  if (vide(typeDuType)) return null;
  if (typeDuType === TYPE_FACTURE.AVOIR && typeOrigine === TYPE_FACTURE.ACOMPTE) return TYPE_FACTURE.AVOIR_ACOMPTE;
  return typeDuType;
}

/**
 * Situation qui fixe le chiffre du cadre : sous-traitant (5) ou cotraitant (6) d'abord, puis facture (380) qui déduit une
 * facture d'acompte (4), puis pièce déjà payée (2), sinon dépôt (1).
 * role : SITUATION_CADRE_FE.SOUS_TRAITANT, SITUATION_CADRE_FE.COTRAITANT ou vide (titulaire, vente directe).
 */
export function situationCadre({ role = null, type = null, deduitAcompte = false, dejaPayee = false } = {}) {
  if (role === SITUATION_CADRE_FE.SOUS_TRAITANT || role === SITUATION_CADRE_FE.COTRAITANT) return role;
  if (type === TYPE_FACTURE.FACTURE && deduitAcompte) return SITUATION_CADRE_FE.DEFINITIVE_APRES_ACOMPTE;
  if (dejaPayee) return SITUATION_CADRE_FE.DEJA_PAYEE;
  return SITUATION_CADRE_FE.DEPOT;
}

/** Cadre BT-23 d'une nature dans une situation (sous-traitant, cotraitant : S5, S6 quelle que soit la nature). */
export function cadreFacturation(nature, situation) {
  const t = CADRES_FE[situation] ?? CADRES_FE[SITUATION_CADRE_FE.DEPOT];
  return t[nature] ?? t[NATURE_FE.SERVICES];
}

/** BT-8 (BR-FR-MAP-03) : date de facture (5) pour des services (S ou M) quand la société a opté pour la TVA sur les débits ; sinon rien. */
export function codeExigibiliteTva(nature, tvaDebits) {
  return tvaDebits === true && (nature === NATURE_FE.SERVICES || nature === NATURE_FE.MIXTE) ? CODE_EXIGIBILITE_TVA.DATE_FACTURE : null;
}

/**
 * Notes légales BR-FR-05/06 depuis les mentions de la société (Paramètres › Éditions, db/190) : PMT indemnité forfaitaire,
 * PMD pénalités, AAB escompte ; une mention vide ne donne pas de note (le contrôle de complétude la signale).
 */
export function notesLegales(mentions = {}) {
  return [[CODE_NOTE.INDEMNITE_RECOUVREMENT, mentions?.indemnite], [CODE_NOTE.PENALITES, mentions?.penalites], [CODE_NOTE.ESCOMPTE, mentions?.escompte]]
    .filter(([, t]) => typeof t === 'string' && t.trim() !== '')
    .map(([code_sujet, t]) => ({ code_sujet, texte: t.trim() }));
}

/**
 * Paramètres d'émission d'une pièce : null pour un type jamais émis, sinon { type_facture, nature, situation, cadre,
 * code_exigibilite_tva, notes }. Pièce émise comme sous-traitant ou cotraitant : nature services.
 * entree : { type_facture (du type), type_origine (BT-3 de la facture d'origine d'un avoir), ent_fe_nature, lignes,
 * natures_fe, role, deduit_acompte, deja_payee, mentions (indemnite, penalites, escompte, tva_debits) }.
 */
export function parametresEmission(entree) {
  const type = typeFacture(entree.type_facture, entree.type_origine ?? null);
  if (!type) return null;
  const situation = situationCadre({ role: entree.role ?? null, type, deduitAcompte: !!entree.deduit_acompte, dejaPayee: !!entree.deja_payee });
  const nature = situation === SITUATION_CADRE_FE.SOUS_TRAITANT || situation === SITUATION_CADRE_FE.COTRAITANT
    ? NATURE_FE.SERVICES
    : naturePiece(entree.lignes ?? [], { naturesFe: entree.natures_fe ?? {}, surcharge: entree.ent_fe_nature ?? null });
  return {
    type_facture: type,
    nature,
    situation,
    cadre: cadreFacturation(nature, situation),
    code_exigibilite_tva: codeExigibiliteTva(nature, entree.mentions?.tva_debits === true),
    notes: notesLegales(entree.mentions ?? {}),
  };
}
