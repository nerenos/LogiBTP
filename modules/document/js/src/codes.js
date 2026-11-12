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
