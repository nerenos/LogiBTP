// Codes du module Document, répliqués dans LogiBTP.Documents/Domaine/Codes.cs (parité vérifiée par CodesTests.cs).

/** Familles de documents : ventes, achats, stock, exécution, sous-traitance (achats de sous-traitance). */
export const FAMILLE_DOCUMENT = Object.freeze({
  VENTE: 'V',
  ACHAT: 'A',
  STOCK: 'S',
  EXECUTION: 'E',
  SOUS_TRAITANCE: 'T',
});

/**
 * Avancement d'un type de document (tyd_avancement) : S situation de travaux (cumul facturable), F facture d'avancement
 * (période), R reprise d'avancement, D situation de production (avancement réel, cumul, ni facturé ni comptable).
 */
export const TYPE_AVANCEMENT = Object.freeze({
  SITUATION: 'S',
  FACTURE: 'F',
  REPRISE: 'R',
  PRODUCTION: 'D',
});

/**
 * Nature d'un avoir (ent_nature_avoir) : ANNULATION, annulation d'une pièce par un avoir qui la reprend entièrement
 * (avancement compris : il garde les précédents de la pièce annulée) ; AVANCEMENT, facture d'avancement de période négative.
 */
export const NATURE_AVOIR = Object.freeze({
  ANNULATION: 'ANNULATION',
  AVANCEMENT: 'AVANCEMENT',
});

/** Statuts de documents connus du code (les autres statuts d'un type sont du paramétrage). */
export const STATUT_DOCUMENT = Object.freeze({
  BROUILLON: 'BROUILLON',
  VALIDE: 'VALIDE',
  ENVOYE: 'ENVOYE',
  ACCEPTE: 'ACCEPTE',
  NON_RETENU: 'NON_RETENU',
  SOLDE: 'SOLDE',
  ANNULE: 'ANNULE',
  REMPLACE: 'REMPLACE',
});

/** Statuts d'une pièce qui n'est plus en vigueur (annulée ou remplacée par un indice). */
export const STATUTS_HORS_VIGUEUR = Object.freeze([STATUT_DOCUMENT.ANNULE, STATUT_DOCUMENT.REMPLACE]);

/** Nœud des droits d'un type de document (module Droits) : documents/{famille}/{code}. */
export const noeudDroitsDocument = (famille, code) => `documents/${famille}/${code}`;

/**
 * Classe de style d'une ligne (styles des lignes : table style_ligne, ent_styles_lignes) : tranche de niveau 1 à 5
 * (au-delà, TRANCHE_5), section, ouvrage, sous-ouvrage (ouvrage sous un ouvrage), élément, composante (élément sous un
 * ouvrage), texte, sous-total.
 */
export const CLASSE_STYLE_LIGNE = Object.freeze({
  TRANCHE_1: 'TRANCHE_1',
  TRANCHE_2: 'TRANCHE_2',
  TRANCHE_3: 'TRANCHE_3',
  TRANCHE_4: 'TRANCHE_4',
  TRANCHE_5: 'TRANCHE_5',
  SECTION: 'SECTION',
  OUVRAGE: 'OUVRAGE',
  SOUS_OUVRAGE: 'SOUS_OUVRAGE',
  ELEMENT: 'ELEMENT',
  COMPOSANTE: 'COMPOSANTE',
  TEXTE: 'TEXTE',
  SOUS_TOTAL: 'SOUS_TOTAL',
});

/** Taille du texte d'un style de ligne. */
export const TAILLE_STYLE_LIGNE = Object.freeze({
  PETITE: 'PETITE',
  NORMALE: 'NORMALE',
  GRANDE: 'GRANDE',
});
