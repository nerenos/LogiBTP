// Codes du module Facturation électronique, répliqués dans Codes.cs (parité vérifiée par CodesTests).
// Valeurs reprises des normes : EN16931 et XP Z12-012 (annexe A V1.4, schematrons FNFE BR-FR et BR-FR-CDV),
// XP Z12-013 (API Flow Service 1.3.0).

/** Type de facture BT-3 autorisé par BR-FR-04 (UNTDID 1001 restreint). */
export const TYPE_FACTURE = Object.freeze({
  FACTURE: '380',
  AUTOFACTURE: '389',
  AFFACTUREE: '393',
  AUTOFACTURE_AFFACTUREE: '501',
  ACOMPTE: '386',
  ACOMPTE_AUTOFACTURE: '500',
  RECTIFICATIVE: '384',
  RECTIFICATIVE_AUTOFACTUREE: '471',
  RECTIFICATIVE_AFFACTUREE: '472',
  RECTIFICATIVE_AUTOFACTUREE_AFFACTUREE: '473',
  AVOIR_AUTOFACTURE: '261',
  AVOIR_REMISE_GLOBALE: '262',
  AVOIR: '381',
  AVOIR_AFFACTURE: '396',
  AVOIR_AUTOFACTURE_AFFACTURE: '502',
  AVOIR_ACOMPTE: '503',
});

/**
 * Cadre de facturation BT-23 (BR-FR-08) : B biens, S services, M mixte ; 1 dépôt, 2 déjà payée, 3 sous-traitance B2G
 * en paiement direct, 4 définitive après acompte, 5 sous-traitant, 6 cotraitant, 7 TVA déjà collectée (e-reporting),
 * 8 multi-vendeurs, 9 bidirectionnelle.
 */
export const CADRE_FACTURATION = Object.freeze({
  B1: 'B1',
  S1: 'S1',
  M1: 'M1',
  B2: 'B2',
  S2: 'S2',
  M2: 'M2',
  S3: 'S3',
  B4: 'B4',
  S4: 'S4',
  M4: 'M4',
  S5: 'S5',
  S6: 'S6',
  B7: 'B7',
  S7: 'S7',
  B8: 'B8',
  S8: 'S8',
  M8: 'M8',
  B9: 'B9',
  S9: 'S9',
  M9: 'M9',
});

/** Catégorie de TVA EN16931 (BT-118, BT-151) admise par BR-FR-15. */
export const CATEGORIE_TVA = Object.freeze({
  NORMALE: 'S',
  EXONEREE: 'E',
  AUTOLIQUIDATION: 'AE',
  INTRACOMMUNAUTAIRE: 'K',
  EXPORTATION: 'G',
  HORS_CHAMP: 'O',
  TAUX_ZERO: 'Z',
});

/** Traitement attendu, note de code sujet BAR (BR-FR-20) ; ARCHIVEONLY : avoir interne d'une facture rejetée ou refusée. */
export const TRAITEMENT = Object.freeze({
  B2B: 'B2B',
  B2B_INT: 'B2BINT',
  B2C: 'B2C',
  HORS_REFORME: 'OUTOFSCOPE',
  ARCHIVAGE_SEUL: 'ARCHIVEONLY',
});

/** Code sujet d'une note de facture (BT-21) exigé par BR-FR-05/06 et BR-FR-20. */
export const CODE_NOTE = Object.freeze({
  INDEMNITE_RECOUVREMENT: 'PMT',
  PENALITES: 'PMD',
  ESCOMPTE: 'AAB',
  TRAITEMENT: 'BAR',
});

/** Sous-type de ligne EXT-FR-FE-163 (profil EXTENDED-CTC-FR) : détail, regroupement, information. */
export const SOUS_TYPE_LIGNE = Object.freeze({
  DETAIL: 'DETAIL',
  GROUPE: 'GROUP',
  INFORMATION: 'INFORMATION',
});

/** Statut de cycle de vie d'une facture (CDAR, liste BR-FR-CDV-CL-06 : codes utiles à LogiBTP). */
export const STATUT_CDV = Object.freeze({
  DEPOSEE: '200',
  EMISE: '201',
  RECUE: '202',
  MISE_A_DISPOSITION: '203',
  PRISE_EN_CHARGE: '204',
  APPROUVEE: '205',
  APPROUVEE_PARTIELLEMENT: '206',
  EN_LITIGE: '207',
  SUSPENDUE: '208',
  COMPLETEE: '209',
  REFUSEE: '210',
  PAIEMENT_TRANSMIS: '211',
  ENCAISSEE: '212',
  REJETEE: '213',
  VISEE: '214',
  ANNULEE: '220',
  ERREUR_ROUTAGE: '221',
  DEMANDE_PAIEMENT_DIRECT: '224',
  AFFACTUREE: '225',
  AFFACTUREE_CONFIDENTIEL: '226',
  CHANGEMENT_COMPTE_A_PAYER: '227',
  NON_AFFACTUREE: '228',
  IRRECEVABLE: '501',
});

/** Statuts terminaux : plus de statut obligatoire ensuite (le vendeur annule par un avoir interne). */
export const STATUTS_TERMINAUX = Object.freeze([STATUT_CDV.REFUSEE, STATUT_CDV.REJETEE]);

/** Statuts dont le motif est obligatoire. */
export const STATUTS_MOTIF_OBLIGATOIRE = Object.freeze([STATUT_CDV.EN_LITIGE, STATUT_CDV.REFUSEE, STATUT_CDV.REJETEE]);

/** Statuts obligatoirement transmis au PPF. */
export const STATUTS_OBLIGATOIRES_PPF = Object.freeze([STATUT_CDV.DEPOSEE, STATUT_CDV.REFUSEE, STATUT_CDV.ENCAISSEE, STATUT_CDV.REJETEE]);

/** Acteur qui pose un statut (émetteur MDG-16 du message CDV). */
export const EMETTEUR_STATUT = Object.freeze({
  PA_E: 'PA_E',
  PA_R: 'PA_R',
  VENDEUR: 'VENDEUR',
  ACHETEUR: 'ACHETEUR',
  AGENT: 'AGENT',
});

/** Sens d'une facture pour la société : émise (vente) ou reçue (achat, sous-traitance). */
export const SENS_FACTURE = Object.freeze({
  EMISE: 'E',
  RECUE: 'R',
});

/** Motif de statut (liste BR-FR-CDV-CL-09, onglet « Tableau des motifs de STATUTS » de l'annexe A XP Z12-012). */
export const MOTIF_STATUT = Object.freeze({
  NON_TRANSMISE: 'NON_TRANSMISE',
  JUSTIF_ABS: 'JUSTIF_ABS',
  ROUTAGE_ERR: 'ROUTAGE_ERR',
  RETRAIT_MAN_SERV: 'RETRAIT_MAN_SERV',
  ST_CT_NON_DECLAR: 'ST_CT_NON_DECLAR',
  SUPPR_COMP_AVOIR: 'SUPPR_COMP_AVOIR',
  TRANSF_PMNT_REGIE: 'TRANSF_PMNT_REGIE',
  CONTACT_ACHTR: 'CONTACT_ACHTR',
  AUTRE: 'AUTRE',
  COORD_BANC_ERR: 'COORD_BANC_ERR',
  TX_TVA_ERR: 'TX_TVA_ERR',
  MONTANTTOTAL_ERR: 'MONTANTTOTAL_ERR',
  CALCUL_ERR: 'CALCUL_ERR',
  NON_CONFORME: 'NON_CONFORME',
  DOUBLON: 'DOUBLON',
  DEST_INC: 'DEST_INC',
  DEST_ERR: 'DEST_ERR',
  TRANSAC_INC: 'TRANSAC_INC',
  EMMET_INC: 'EMMET_INC',
  CONTRAT_TERM: 'CONTRAT_TERM',
  DOUBLE_FACT: 'DOUBLE_FACT',
  CMD_ERR: 'CMD_ERR',
  ADR_ERR: 'ADR_ERR',
  SIRET_ERR: 'SIRET_ERR',
  CODE_ROUTAGE_ERR: 'CODE_ROUTAGE_ERR',
  REF_CT_ABSENT: 'REF_CT_ABSENT',
  REF_ERR: 'REF_ERR',
  PU_ERR: 'PU_ERR',
  REM_ERR: 'REM_ERR',
  QTE_ERR: 'QTE_ERR',
  ART_ERR: 'ART_ERR',
  MODPAI_ERR: 'MODPAI_ERR',
  QUALITE_ERR: 'QUALITE_ERR',
  LIVR_INCOMP: 'LIVR_INCOMP',
  REJ_SEMAN: 'REJ_SEMAN',
  REJ_UNI: 'REJ_UNI',
  REJ_COH: 'REJ_COH',
  REJ_ADR: 'REJ_ADR',
  REJ_CONT_B2G: 'REJ_CONT_B2G',
  REJ_REF_PJ: 'REJ_REF_PJ',
  REJ_ASS_PJ: 'REJ_ASS_PJ',
  IRR_VIDE_F: 'IRR_VIDE_F',
  IRR_TYPE_F: 'IRR_TYPE_F',
  IRR_SYNTAX: 'IRR_SYNTAX',
  IRR_TAILLE_PJ: 'IRR_TAILLE_PJ',
  IRR_NOM_PJ: 'IRR_NOM_PJ',
  IRR_VID_PJ: 'IRR_VID_PJ',
  IRR_EXT_DOC: 'IRR_EXT_DOC',
  IRR_TAILLE_F: 'IRR_TAILLE_F',
  IRR_ANTIVIRUS: 'IRR_ANTIVIRUS',
  IRR_NOM_F: 'IRR_NOM_F',
});

/** Action attendue d'un statut (liste BR-FR-CDV-CL-10). */
export const ACTION_CDV = Object.freeze({
  AUCUNE: 'NOA',
  INFORMATION: 'PIN',
  RECTIFICATIVE: 'NIN',
  AVOIR_TOTAL: 'CNF',
  AVOIR_PARTIEL: 'CNP',
  REMBOURSEMENT: 'CNA',
  AUTRE: 'OTH',
});

/** Syntaxe d'un flux (flowSyntax de XP Z12-013). */
export const SYNTAXE = Object.freeze({
  CII: 'CII',
  UBL: 'UBL',
  FACTUR_X: 'Factur-X',
  CDAR: 'CDAR',
  FRR: 'FRR',
});

/** Profil d'un flux (flowProfile de XP Z12-013) : Basic, CIUS (EN16931), Extended-CTC-FR. */
export const PROFIL_FACTURE = Object.freeze({
  BASIC: 'Basic',
  EN16931: 'CIUS',
  EXTENDED_CTC_FR: 'Extended-CTC-FR',
  NON_DEFINI: 'Undefined',
});

/** Type d'un flux (flowType de XP Z12-013). */
export const TYPE_FLUX = Object.freeze({
  FACTURE_CLIENT: 'CustomerInvoice',
  FACTURE_FOURNISSEUR: 'SupplierInvoice',
  CDV_FACTURE_CLIENT: 'CustomerInvoiceLC',
  CDV_FACTURE_FOURNISSEUR: 'SupplierInvoiceLC',
  ETAT_CDV_FACTURE_CLIENT: 'StateCustomerInvoiceLC',
  ETAT_CDV_FACTURE_FOURNISSEUR: 'StateSupplierInvoiceLC',
  TRANSACTIONS_AGREGEES: 'AggregatedCustomerTransactionReport',
  TRANSACTIONS_UNITAIRES: 'UnitaryCustomerTransactionReport',
  PAIEMENTS_AGREGES: 'AggregatedCustomerPaymentReport',
  PAIEMENTS_UNITAIRES: 'UnitaryCustomerPaymentReport',
  TRANSACTIONS_FOURNISSEUR: 'UnitarySupplierTransactionReport',
  RAPPORT_MULTIFLUX: 'MultiFlowReport',
  ETAT_FACTURE_CLIENT: 'StateCustomerInvoice',
  ETAT_FACTURE_FOURNISSEUR: 'StateSupplierInvoice',
  ETAT_TRANSACTIONS: 'StateTransactionReport',
  ETAT_CDV_TRANSACTIONS: 'StateTransactionReportLC',
  ETAT_PAIEMENTS: 'StatePaymentReport',
  ETAT_CDV_PAIEMENTS: 'StatePaymentReportLC',
  NON_DEFINI: 'Undefined',
});

/** Sens d'un flux vu de LogiBTP (flowDirection de XP Z12-013) : entrant (PA → LogiBTP), sortant (LogiBTP → PA). */
export const SENS_FLUX = Object.freeze({
  ENTRANT: 'In',
  SORTANT: 'Out',
});

/** Règle de traitement d'un flux (processingRule de XP Z12-013). */
export const REGLE_TRAITEMENT = Object.freeze({
  B2B: 'B2B',
  B2B_INT: 'B2BInt',
  B2C: 'B2C',
  B2G: 'B2G',
  B2G_INT: 'B2GInt',
  HORS_REFORME: 'OutOfScope',
  B2G_HORS_REFORME: 'B2GOutOfScope',
  ARCHIVAGE_SEUL: 'ArchiveOnly',
  NON_APPLICABLE: 'NotApplicable',
  NON_DEFINI: 'Undefined',
});

/** État de l'accusé d'un flux déposé (ackStatus de XP Z12-013). */
export const ETAT_ACCUSE = Object.freeze({
  EN_ATTENTE: 'Pending',
  OK: 'Ok',
  ERREUR: 'Error',
});

/** Niveau d'un détail d'accusé (XP Z12-013). */
export const NIVEAU_ACCUSE = Object.freeze({
  ERREUR: 'Error',
  AVERTISSEMENT: 'Warning',
});

/** Motif d'un détail d'accusé (reasonCode de XP Z12-013 ; une PA peut en ajouter). */
export const MOTIF_ACCUSE = Object.freeze({
  PJ_VIDE: 'EmptyAttachement',
  TYPE_PJ: 'AttachmentTypeError',
  FLUX_VIDE: 'EmptyFlow',
  AUTRE_ERREUR_TECHNIQUE: 'OtherTechnicalError',
  SCHEMA_INVALIDE: 'InvalidSchema',
  TAILLE_DEPASSEE: 'FileSizeExceeded',
  TYPE_FLUX: 'FlowTypeError',
  FLUX_EXISTANT: 'AlreadyExistingFlow',
  VIRUS: 'VirusFound',
  EMPREINTE: 'ChecksumMismatch',
  CDV_STATUT_INVALIDE: 'InvoiceLCInvalidStatus',
  CDV_STATUT_ERREUR: 'InvoiceLCStatusError',
  CDV_REGLE: 'InvoiceLCRuleError',
  CDV_ACCES_REFUSE: 'InvoiceLCAccessDenied',
  CDV_MONTANT: 'InvoiceLCAmountError',
});

/** État d'un flux dans la file de LogiBTP. */
export const ETAT_FLUX = Object.freeze({
  A_ENVOYER: 'A_ENVOYER',
  ENVOYE: 'ENVOYE',
  ACQUITTE: 'ACQUITTE',
  ERREUR: 'ERREUR',
  RECU: 'RECU',
  TRAITE: 'TRAITE',
  ABANDONNE: 'ABANDONNE',
});

/** Type d'une étape du journal chaîné d'une facture émise ou reçue (fe_evenement, lot 8). */
export const EVENEMENT_FE = Object.freeze({
  PRODUCTION: 'PRODUCTION',
  CONTROLE: 'CONTROLE',
  DEPOT: 'DEPOT',
  ACCUSE: 'ACCUSE',
  RECEPTION: 'RECEPTION',
  STATUT_RECU: 'STATUT_RECU',
  STATUT_POSE: 'STATUT_POSE',
  ERREUR: 'ERREUR',
  REPRISE: 'REPRISE',
  ACTION_UTILISATEUR: 'ACTION_UTILISATEUR',
  AVOIR_INTERNE: 'AVOIR_INTERNE',
  RATTACHEMENT: 'RATTACHEMENT',
  IMPORT_MANUEL: 'IMPORT_MANUEL',
});

/** Erreurs du contrôle d'un statut de cycle de vie. */
export const ERREUR_FE = Object.freeze({
  SENS_INCONNU: 'SENS_INCONNU',
  STATUT_INCONNU: 'STATUT_INCONNU',
  EMETTEUR_NON_AUTORISE: 'EMETTEUR_NON_AUTORISE',
  MOTIF_INCONNU: 'MOTIF_INCONNU',
  MOTIF_NON_AUTORISE: 'MOTIF_NON_AUTORISE',
  MOTIF_OBLIGATOIRE: 'MOTIF_OBLIGATOIRE',
  ACTION_INCONNUE: 'ACTION_INCONNUE',
  STATUT_TERMINAL: 'STATUT_TERMINAL',
  TRANSITION_INTERDITE: 'TRANSITION_INTERDITE',
});
