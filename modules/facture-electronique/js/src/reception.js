// Module Facturation électronique, réception hors plateforme (plans/facturation-electronique.md, lot 14) : fichier
// proposé comme facture reçue (glisser-déposer, pièce jointe d'un courriel). Règle miroir : ReglesReception.cs
// (jeu tests/cas/03_fichiers_facture.json). Le contenu reste contrôlé par la lecture du serveur. Sous-traitance (lot 15) :
// controlerSousTraitance ↔ ReglesReception.ControlerSousTraitance (jeu tests/cas/04_sous_traitance.json).

import { CADRE_FACTURATION, CATEGORIE_TVA, CODE_EXONERATION, ECART_RECEPTION } from './codes.js';

/** Extensions d'une facture reçue : Factur-X (PDF) ou XML CII / UBL. */
export const EXTENSIONS_FACTURE = Object.freeze(['.pdf', '.xml']);

/** Types MIME d'une facture reçue. */
export const TYPES_MIME_FACTURE = Object.freeze(['application/pdf', 'application/xml', 'text/xml']);

/** Vrai si le fichier (nom, type MIME) est proposé comme facture reçue : extension .pdf ou .xml, ou type MIME d'une facture. */
export function estFichierFacture(nom, type) {
  const n = String(nom ?? '').trim().toLowerCase();
  const t = String(type ?? '').split(';')[0].trim().toLowerCase();
  return EXTENSIONS_FACTURE.some((e) => n.endsWith(e)) || TYPES_MIME_FACTURE.includes(t);
}

const normaliser = (x) => String(x ?? '').trim().toUpperCase();

/**
 * Contrôle d'une facture de sous-traitance reçue (lot 15). Entrée : cadre (BT-23), payeur (bloc EXT-FR-FE-BG-02
 * présent), tva (ventilations BG-23 : { categorie, vatex }), autoliquidation (attendue du sous-traitant : vrai, faux, ou
 * null si inconnue). Paiement direct : cadre S5 avec un payeur. Écarts (ECART_RECEPTION, jamais bloquants) : S5 sans
 * payeur, payeur hors S5 ; autoliquidation attendue et une ventilation hors AE, non attendue et une ventilation AE ;
 * ventilation AE sans le code VATEX-FR-AE (casse et espaces ignorés).
 */
export function controlerSousTraitance({ cadre = null, payeur = false, tva = [], autoliquidation = null } = {}) {
  const s5 = normaliser(cadre) === CADRE_FACTURATION.S5;
  const ecarts = [];
  if (s5 && !payeur) ecarts.push(ECART_RECEPTION.PAYEUR_ABSENT);
  if (payeur && !s5) ecarts.push(ECART_RECEPTION.PAYEUR_HORS_S5);
  const categories = (tva ?? []).map((t) => normaliser(t?.categorie));
  const ae = (tva ?? []).filter((t) => normaliser(t?.categorie) === CATEGORIE_TVA.AUTOLIQUIDATION);
  if (autoliquidation === true && categories.some((c) => c !== CATEGORIE_TVA.AUTOLIQUIDATION)) ecarts.push(ECART_RECEPTION.AUTOLIQUIDATION_ABSENTE);
  if (autoliquidation === false && ae.length > 0) ecarts.push(ECART_RECEPTION.AUTOLIQUIDATION_INATTENDUE);
  if (ae.some((t) => normaliser(t?.vatex) !== CODE_EXONERATION.AUTOLIQUIDATION)) ecarts.push(ECART_RECEPTION.VATEX_AUTOLIQUIDATION);
  return { paiementDirect: s5 && Boolean(payeur), ecarts };
}
