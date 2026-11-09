// Module Facturation électronique LogiBTP : codes des normes (EN16931, XP Z12-012, XP Z12-013), règles du cycle de vie.
export {
  emetteurDuSens, emetteursStatut, motifsAutorises, statutTerminal, motifObligatoire, obligatoirePpf, controlerStatut,
  statutsPosables, statutAffiche,
} from './cycle-vie.js';
export {
  TYPE_FACTURE, CADRE_FACTURATION, CATEGORIE_TVA, TRAITEMENT, CODE_NOTE, SOUS_TYPE_LIGNE, STATUT_CDV, STATUTS_TERMINAUX,
  STATUTS_MOTIF_OBLIGATOIRE, STATUTS_OBLIGATOIRES_PPF, EMETTEUR_STATUT, SENS_FACTURE, MOTIF_STATUT, ACTION_CDV, SYNTAXE,
  PROFIL_FACTURE, SPECIFICATION_FACTURE, TYPE_DOCUMENT_REFERENCE, SCHEMA_IDENTIFIANT, TYPE_FLUX, SENS_FLUX,
  REGLE_TRAITEMENT, ETAT_ACCUSE, NIVEAU_ACCUSE, MOTIF_ACCUSE, ETAT_FLUX, EVENEMENT_FE, ERREUR_FE,
} from './codes.js';
