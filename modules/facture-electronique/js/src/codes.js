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
  B2C_INT: 'B2CINT',
  HORS_REFORME: 'OUTOFSCOPE',
  ARCHIVAGE_SEUL: 'ARCHIVEONLY',
});

/** Code sujet d'une note de facture (BT-21) exigé par BR-FR-05/06 et BR-FR-20. */
export const CODE_NOTE = Object.freeze({
  INDEMNITE_RECOUVREMENT: 'PMT',
  PENALITES: 'PMD',
  ESCOMPTE: 'AAB',
  TRAITEMENT: 'BAR',
  MENTION_TAXE: 'TXD', // BR-FR-06 : une fois au plus
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

/** Statuts dont le motif est obligatoire (BR-FR-CDV-15, schematron CDAR 1.4.0.04). */
export const STATUTS_MOTIF_OBLIGATOIRE = Object.freeze([STATUT_CDV.APPROUVEE_PARTIELLEMENT, STATUT_CDV.EN_LITIGE,
  STATUT_CDV.SUSPENDUE, STATUT_CDV.REFUSEE, STATUT_CDV.REJETEE, STATUT_CDV.IRRECEVABLE]);

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

/** Identifiant de spécification (BT-24) : profils Factur-X et CII. */
export const SPECIFICATION_FACTURE = Object.freeze({
  MINIMUM: 'urn:factur-x.eu:1p0:minimum',
  BASIC_WL: 'urn:factur-x.eu:1p0:basicwl',
  BASIC: 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic',
  EN16931: 'urn:cen.eu:en16931:2017',
  EXTENDED: 'urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended',
  EXTENDED_ZUGFERD: 'urn:cen.eu:en16931:2017#conformant#urn:zugferd.de:2p0:extended',
  EXTENDED_CTC_FR: 'urn:cen.eu:en16931:2017#conformant#urn.cpro.gouv.fr:1p0:extended-ctc-fr',
});

/** Type de document référencé (UNTDID 1001) : BT-17, BT-18, BT-122. */
export const TYPE_DOCUMENT_REFERENCE = Object.freeze({
  APPEL_OFFRES: '50',
  OBJET_FACTURE: '130',
  JUSTIFICATIF: '916',
  PROJET_AVOIR_UBL: '50', // UBL CreditNote : BT-11 en AdditionalDocumentReference
});

/** Schéma d'identifiant (ISO 6523 ICD) et d'immatriculation fiscale (VA, FC). */
export const SCHEMA_IDENTIFIANT = Object.freeze({
  SIREN: '0002',
  SIRET: '0009',
  CODE_ROUTAGE: '0224',
  ADRESSE_ELECTRONIQUE: '0225',
  TVA: 'VA',
  FISCAL: 'FC',
  PLATEFORME: '0238', // CDAR : matricule d'une plateforme (PA, PPF, Chorus Pro)
  CREANCIER_SEPA: 'SEPA', // UBL : BT-90 dans PartyIdentification
  TVA_UBL: 'VAT', // UBL : TaxScheme/ID du numéro de TVA
});

/** CDAR : matricule (schéma 0238) des plateformes publiques. */
export const MATRICULE_PLATEFORME = Object.freeze({
  PPF: '0000',
  CHORUS_PRO: '9999', // Refusée B2G : motifs propres (BR-FR-CDV-CL-09) si l'expéditeur est Chorus Pro
});

/** CDAR : rôle d'une partie du message (UNCL 3035, BR-FR-CDV-CL-02 à CL-04, CL-07, CL-08). */
export const ROLE_CDAR = Object.freeze({
  ACHETEUR: 'BY',
  REPRESENTANT_ACHETEUR: 'AB',
  AFFACTUREUR: 'DL',
  VENDEUR: 'SE',
  AGENT_VENDEUR: 'SR',
  PLATEFORME: 'WK',
  PPF: 'DFH',
  BENEFICIAIRE: 'PE',
  PAYEUR: 'PR',
  FACTURANT: 'II',
  FACTURE: 'IV',
});

/** CDAR MDT-77 : phase du statut (UNCL 1001, BR-FR-CDV-09). */
export const TYPE_ACCUSE_CDAR = Object.freeze({
  INFORMATION: '23', // phase de traitement
  ACQUITTEMENT: '305', // phase de transmission
});

/** CDAR MDT-2 : processus métier (BR-FR-CDV-CL-01). */
export const PROCESSUS_CDV = Object.freeze({
  REGLEMENTE: 'REGULATED',
  NON_REGLEMENTE: 'NON_REGULATED',
  B2C: 'B2C',
  B2C_INT: 'B2CINT',
  B2B_INT: 'B2BINT',
  HORS_REFORME: 'OUTOFSCOPE',
});

/** CDAR MDT-3 : profil du message (BR-FR-CDV-02 ; einvoicingF2 : message pour le seul PPF). */
export const PROFIL_CDV = Object.freeze({
  FACTURE: 'urn.cpro.gouv.fr:1p0:CDV:invoice',
  PPF: 'urn.cpro.gouv.fr:1p0:CDV:einvoicingF2',
});

/** CDAR MDT-207 : nature d'une caractéristique du détail de statut (BR-FR-CDV-CL-11). */
export const CARACTERISTIQUE_CDV = Object.freeze({
  MONTANT_ENCAISSE: 'MEN', // TTC, avec le taux de TVA (Encaissée, BR-FR-CDV-14)
  MONTANT_PAYE: 'MPA',
  RESTE_A_PAYER: 'RAP',
  ESCOMPTE: 'ESC',
  RABAIS: 'RAB',
  REMISE: 'REM',
  MONTANT_HT_APPROUVE: 'MAP',
  MONTANT_TTC_APPROUVE: 'MAPTTC',
  MONTANT_HT_NON_APPROUVE: 'MNA',
  MONTANT_TTC_NON_APPROUVE: 'MNATTC',
  COORDONNEES_BANCAIRES: 'CBB',
  DONNEE_INVALIDE: 'DIV',
  DONNEE_VALIDE_ATTENDUE: 'DVA',
  DONNEE_A_PRENDRE: 'MAJ',
});

/** BT-8 : code de date d'exigibilité de la TVA, valeur du modèle (UNTDID 2475, CII DueDateTypeCode). */
export const CODE_EXIGIBILITE_TVA = Object.freeze({
  DATE_FACTURE: '5',
  DATE_LIVRAISON: '29',
  DATE_PAIEMENT: '72',
});

/** BT-8 en UBL (UNTDID 2005, InvoicePeriod/DescriptionCode), converti en CODE_EXIGIBILITE_TVA à la lecture. */
export const CODE_EXIGIBILITE_TVA_UBL = Object.freeze({
  DATE_FACTURE: '3',
  DATE_LIVRAISON: '35',
  DATE_PAIEMENT: '432',
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

/** Étape de la validation d'une facture (note explicative FNFE 1.4.0 : XSD, puis schematron du profil, puis BR-FR-Flux2). */
export const ETAPE_CONTROLE = Object.freeze({
  XSD: 'XSD',
  PROFIL: 'PROFIL',
  FRANCE: 'FRANCE',
});

/** Niveau d'un contrôle de schematron (attribut flag du SVRL ; « fatal » rejette la facture). */
export const NIVEAU_CONTROLE = Object.freeze({
  FATAL: 'fatal',
  AVERTISSEMENT: 'warning',
  INFORMATION: 'information',
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
  // Réception (lot 12) : facture lue, pièce créée par l'application, création refusée pour une facture en double.
  LECTURE: 'LECTURE',
  PIECE_CREEE: 'PIECE_CREEE',
  DOUBLON: 'DOUBLON',
});

/** Auteur d'une étape du journal fe_evenement : utilisateur, LogiBTP (file, relève), plateforme (accusé, statut reçu). */
export const ACTEUR_FE = Object.freeze({
  UTILISATEUR: 'UTILISATEUR',
  SYSTEME: 'SYSTEME',
  PLATEFORME: 'PLATEFORME',
});

/** Sens d'un statut de cycle de vie dans fe_statut : reçu de la plateforme, ou posé par la société. */
export const SENS_STATUT = Object.freeze({
  RECU: 'RECU',
  POSE: 'POSE',
});

/** Découpage de l'e-reporting choisi par la société (Q20) : un envoi unique par période, ou plusieurs envois. */
export const DECOUPAGE_EREPORTING = Object.freeze({
  UNIQUE: 'UNIQUE',
  PLUSIEURS: 'PLUSIEURS',
});

/** Code de motif d'exonération (VATEX, BT-121) attendu d'une ventilation autoliquidée (catégorie AE) : autoliquidation française. */
export const CODE_EXONERATION = Object.freeze({
  AUTOLIQUIDATION: 'VATEX-FR-AE',
});

/**
 * Écarts signalés à la réception d'une facture de sous-traitance (lot 15) : jamais bloquants, notés au rapport de la
 * pièce. Payeur (EXT-FR-FE-BG-02) et cadre S5 (BT-23) ; autoliquidation (AE / VATEX-FR-AE) comparée à celle attendue du
 * sous-traitant ; contrat du paiement direct (BT-12) non retrouvé, sans paiement direct prévu, ou payeur autre que le
 * maître d'ouvrage.
 */
export const ECART_RECEPTION = Object.freeze({
  PAYEUR_ABSENT: 'PAYEUR_ABSENT',
  PAYEUR_HORS_S5: 'PAYEUR_HORS_S5',
  AUTOLIQUIDATION_ABSENTE: 'AUTOLIQUIDATION_ABSENTE',
  AUTOLIQUIDATION_INATTENDUE: 'AUTOLIQUIDATION_INATTENDUE',
  VATEX_AUTOLIQUIDATION: 'VATEX_AUTOLIQUIDATION',
  CONTRAT_INTROUVABLE: 'CONTRAT_INTROUVABLE',
  PAIEMENT_DIRECT_NON_PREVU: 'PAIEMENT_DIRECT_NON_PREVU',
  PAYEUR_DIFFERENT: 'PAYEUR_DIFFERENT',
});

/** Erreurs du contrôle d'un statut de cycle de vie et de la lecture d'une facture (lot 2). */
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
  // Lecture des factures (serveur, lot 2)
  XML_ILLISIBLE: 'XML_ILLISIBLE',
  SYNTAXE_INCONNUE: 'SYNTAXE_INCONNUE',
  XSD_INVALIDE: 'XSD_INVALIDE',
  PROFIL_INCONNU: 'PROFIL_INCONNU',
  DONNEE_INVALIDE: 'DONNEE_INVALIDE',
  PDF_ILLISIBLE: 'PDF_ILLISIBLE',
  XML_ABSENT: 'XML_ABSENT',
  // Écriture des factures (serveur, lot 16)
  PROFIL_NON_ECRIT: 'PROFIL_NON_ECRIT',
  DONNEE_HORS_PROFIL: 'DONNEE_HORS_PROFIL',
  // Connecteur de plateforme (serveur, lot 6) : demande refusée avant l'envoi, puis réponses de la plateforme (400 à 503)
  CONNECTEUR_INCONNU: 'CONNECTEUR_INCONNU',
  PARAMETRE_CONNECTEUR: 'PARAMETRE_CONNECTEUR',
  FONCTION_NON_PRISE_EN_CHARGE: 'FONCTION_NON_PRISE_EN_CHARGE',
  DEMANDE_INVALIDE: 'DEMANDE_INVALIDE',
  REQUETE_REFUSEE: 'REQUETE_REFUSEE',
  NON_AUTHENTIFIE: 'NON_AUTHENTIFIE',
  ACCES_REFUSE_PLATEFORME: 'ACCES_REFUSE_PLATEFORME',
  RESSOURCE_INTROUVABLE: 'RESSOURCE_INTROUVABLE',
  DELAI_DEPASSE: 'DELAI_DEPASSE',
  FICHIER_TROP_GROS: 'FICHIER_TROP_GROS',
  DONNEES_INCOHERENTES: 'DONNEES_INCOHERENTES',
  TROP_DE_REQUETES: 'TROP_DE_REQUETES',
  ERREUR_PLATEFORME: 'ERREUR_PLATEFORME',
  PLATEFORME_INDISPONIBLE: 'PLATEFORME_INDISPONIBLE',
  REPONSE_ILLISIBLE: 'REPONSE_ILLISIBLE',
  // File, relève et journal (serveur, lot 8)
  FLUX_INTROUVABLE: 'FLUX_INTROUVABLE',
  ETAT_FLUX_INVALIDE: 'ETAT_FLUX_INVALIDE',
  PARAMETRE_INVALIDE: 'PARAMETRE_INVALIDE',
  // Réception (lot 12) : facture déjà enregistrée chez l'application (même fournisseur, même numéro).
  FACTURE_EN_DOUBLE: 'FACTURE_EN_DOUBLE',
});

/** Connecteur de plateforme (lot 6) : AFNOR XP Z12-013, plateforme simulée, dépôt manuel ; une PA propre s'ajoute à la fabrique. */
export const CONNECTEUR_FE = Object.freeze({
  AFNOR: 'AFNOR',
  SIMULE: 'SIMULE',
  MANUEL: 'MANUEL',
});

/** Document d'un flux à télécharger (docType de GET /v1/flows/{flowId}). */
export const TYPE_DOCUMENT_FLUX = Object.freeze({
  METADONNEES: 'Metadata',
  ORIGINAL: 'Original',
  CONVERTI: 'Converted',
  LISIBLE: 'ReadableView',
});

/** Origine de la règle de traitement d'un flux (processingRuleSource) : fournie au dépôt ou calculée par la plateforme. */
export const ORIGINE_REGLE = Object.freeze({
  FOURNIE: 'Input',
  CALCULEE: 'Computed',
});

/** Opérateur d'un filtre de recherche dans l'annuaire (Directory Service). */
export const OPERATEUR_ANNUAIRE = Object.freeze({
  EGAL: 'strict',
  CONTIENT: 'contains',
  COMMENCE_PAR: 'startWith',
});

/** Type de plateforme de réception d'une ligne d'annuaire (platformType) : plateforme agréée ou PPF. */
export const TYPE_PLATEFORME_ANNUAIRE = Object.freeze({
  PA: 'WK',
  PPF: 'DFH',
});

/** État d'une ligne d'annuaire (directoryLineStatus). */
export const ETAT_LIGNE_ANNUAIRE = Object.freeze({
  ACTIVE: 'Enabled',
  INACTIVE: 'Disabled',
  A_VENIR: 'Upcoming',
});

/** Type d'une pièce jointe (BT-123, liste BR-FR-17) ; LISIBLE une fois au plus (BR-FR-18). */
export const TYPE_PIECE_JOINTE = Object.freeze({
  RIB: 'RIB',
  LISIBLE: 'LISIBLE',
  FEUILLE_DE_STYLE: 'FEUILLE_DE_STYLE',
  PJA: 'PJA',
  BORDEREAU_SUIVI: 'BORDEREAU_SUIVI',
  DOCUMENT_ANNEXE: 'DOCUMENT_ANNEXE',
  BON_LIVRAISON: 'BON_LIVRAISON',
  BON_COMMANDE: 'BON_COMMANDE',
  BORDEREAU_SUIVI_VALIDATION: 'BORDEREAU_SUIVI_VALIDATION',
  ETAT_ACOMPTE: 'ETAT_ACOMPTE',
  FACTURE_PAIEMENT_DIRECT: 'FACTURE_PAIEMENT_DIRECT',
  RECAPITULATIF_COTRAITANCE: 'RECAPITULATIF_COTRAITANCE',
});

/** Niveau d'un écart du contrôle de complétude (lot 16, Q5) : bloquant pour un tiers B2B / B2G, avertissement sinon. */
export const NIVEAU_COMPLETUDE = Object.freeze({
  BLOQUANT: 'BLOQUANT',
  AVERTISSEMENT: 'AVERTISSEMENT',
});

/**
 * Règle du contrôle de complétude d'une facture émise (lot 16 : completude.js ↔ ReglesCompletude.cs) : règles françaises
 * du schematron BR-FR-Flux2 (FNFE 1.4.0.04), sommes EN16931 (BR-CO), et deux règles propres à LogiBTP (profil écrit,
 * cadre émis).
 */
export const REGLE_COMPLETUDE = Object.freeze({
  PROFIL: 'LOGIBTP-PROFIL',
  CADRE: 'LOGIBTP-CADRE',
  BR_FR_01: 'BR-FR-01',
  BR_FR_02: 'BR-FR-02',
  BR_FR_03: 'BR-FR-03',
  BR_FR_04: 'BR-FR-04',
  BR_FR_05: 'BR-FR-05',
  BR_FR_06: 'BR-FR-06',
  BR_FR_08: 'BR-FR-08',
  BR_FR_09: 'BR-FR-09',
  BR_FR_10: 'BR-FR-10',
  BR_FR_11: 'BR-FR-11',
  BR_FR_12: 'BR-FR-12',
  BR_FR_13: 'BR-FR-13',
  BR_FR_15: 'BR-FR-15',
  BR_FR_16: 'BR-FR-16',
  BR_FR_17: 'BR-FR-17',
  BR_FR_18: 'BR-FR-18',
  BR_FR_20: 'BR-FR-20',
  BR_FR_21: 'BR-FR-21',
  BR_FR_22: 'BR-FR-22',
  BR_FR_23: 'BR-FR-23',
  BR_FR_24: 'BR-FR-24',
  BR_FR_25: 'BR-FR-25',
  BR_FR_26: 'BR-FR-26',
  BR_FR_31: 'BR-FR-31',
  BR_FR_32: 'BR-FR-32',
  BR_FR_CO_03: 'BR-FR-CO-03',
  BR_FR_CO_04: 'BR-FR-CO-04',
  BR_FR_CO_05: 'BR-FR-CO-05',
  BR_FR_CO_07: 'BR-FR-CO-07',
  BR_FR_CO_08: 'BR-FR-CO-08',
  BR_FR_CO_09: 'BR-FR-CO-09',
  BR_FR_CO_12: 'BR-FR-CO-12',
  BR_FR_DEC_01: 'BR-FR-DEC-01',
  BR_FR_DEC_02: 'BR-FR-DEC-02',
  BR_FR_DEC_03: 'BR-FR-DEC-03',
  BR_FR_DEC_04: 'BR-FR-DEC-04',
  BR_CO_10: 'BR-CO-10',
  BR_CO_11: 'BR-CO-11',
  BR_CO_12: 'BR-CO-12',
  BR_CO_13: 'BR-CO-13',
  BR_CO_14: 'BR-CO-14',
  BR_CO_15: 'BR-CO-15',
  BR_CO_16: 'BR-CO-16',
  BR_CO_17: 'BR-CO-17',
});
