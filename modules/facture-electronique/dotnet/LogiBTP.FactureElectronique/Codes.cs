namespace LogiBTP.FactureElectronique;

// Codes du module Facturation électronique, répliqués dans modules/facture-electronique/js/src/codes.js (parité vérifiée
// par CodesTests). Valeurs reprises des normes : EN16931 et XP Z12-012 (annexe A V1.4, schematrons FNFE BR-FR et
// BR-FR-CDV), XP Z12-013 (API Flow Service 1.3.0).

/// <summary>Type de facture BT-3 autorisé par BR-FR-04 (UNTDID 1001 restreint).</summary>
public static class TypeFacture
{
    public const string Facture = "380";
    public const string Autofacture = "389";
    public const string Affacturee = "393";
    public const string AutofactureAffacturee = "501";
    public const string Acompte = "386";
    public const string AcompteAutofacture = "500";
    public const string Rectificative = "384";
    public const string RectificativeAutofacturee = "471";
    public const string RectificativeAffacturee = "472";
    public const string RectificativeAutofactureeAffacturee = "473";
    public const string AvoirAutofacture = "261";
    public const string AvoirRemiseGlobale = "262";
    public const string Avoir = "381";
    public const string AvoirAffacture = "396";
    public const string AvoirAutofactureAffacture = "502";
    public const string AvoirAcompte = "503";
}

/// <summary>
/// Cadre de facturation BT-23 (BR-FR-08) : B biens, S services, M mixte ; 1 dépôt, 2 déjà payée, 3 sous-traitance B2G en
/// paiement direct, 4 définitive après acompte, 5 sous-traitant, 6 cotraitant, 7 TVA déjà collectée (e-reporting),
/// 8 multi-vendeurs, 9 bidirectionnelle.
/// </summary>
public static class CadreFacturation
{
    public const string B1 = "B1";
    public const string S1 = "S1";
    public const string M1 = "M1";
    public const string B2 = "B2";
    public const string S2 = "S2";
    public const string M2 = "M2";
    public const string S3 = "S3";
    public const string B4 = "B4";
    public const string S4 = "S4";
    public const string M4 = "M4";
    public const string S5 = "S5";
    public const string S6 = "S6";
    public const string B7 = "B7";
    public const string S7 = "S7";
    public const string B8 = "B8";
    public const string S8 = "S8";
    public const string M8 = "M8";
    public const string B9 = "B9";
    public const string S9 = "S9";
    public const string M9 = "M9";
}

/// <summary>Catégorie de TVA EN16931 (BT-118, BT-151) admise par BR-FR-15.</summary>
public static class CategorieTva
{
    public const string Normale = "S";
    public const string Exoneree = "E";
    public const string Autoliquidation = "AE";
    public const string Intracommunautaire = "K";
    public const string Exportation = "G";
    public const string HorsChamp = "O";
    public const string TauxZero = "Z";
}

/// <summary>Traitement attendu, note de code sujet BAR (BR-FR-20) ; ARCHIVEONLY : avoir interne d'une facture rejetée ou refusée.</summary>
public static class Traitement
{
    public const string B2B = "B2B";
    public const string B2BInt = "B2BINT";
    public const string B2C = "B2C";
    public const string HorsReforme = "OUTOFSCOPE";
    public const string ArchivageSeul = "ARCHIVEONLY";
}

/// <summary>Code sujet d'une note de facture (BT-21) exigé par BR-FR-05/06 et BR-FR-20.</summary>
public static class CodeNote
{
    public const string IndemniteRecouvrement = "PMT";
    public const string Penalites = "PMD";
    public const string Escompte = "AAB";
    public const string Traitement = "BAR";
}

/// <summary>Sous-type de ligne EXT-FR-FE-163 (profil EXTENDED-CTC-FR) : détail, regroupement, information.</summary>
public static class SousTypeLigne
{
    public const string Detail = "DETAIL";
    public const string Groupe = "GROUP";
    public const string Information = "INFORMATION";
}

/// <summary>Statut de cycle de vie d'une facture (CDAR, liste BR-FR-CDV-CL-06 : codes utiles à LogiBTP).</summary>
public static class StatutCdv
{
    public const string Deposee = "200";
    public const string Emise = "201";
    public const string Recue = "202";
    public const string MiseADisposition = "203";
    public const string PriseEnCharge = "204";
    public const string Approuvee = "205";
    public const string ApprouveePartiellement = "206";
    public const string EnLitige = "207";
    public const string Suspendue = "208";
    public const string Completee = "209";
    public const string Refusee = "210";
    public const string PaiementTransmis = "211";
    public const string Encaissee = "212";
    public const string Rejetee = "213";
    public const string Visee = "214";
    public const string Annulee = "220";
    public const string ErreurRoutage = "221";
    public const string DemandePaiementDirect = "224";
    public const string Affacturee = "225";
    public const string AffactureeConfidentiel = "226";
    public const string ChangementCompteAPayer = "227";
    public const string NonAffacturee = "228";
    public const string Irrecevable = "501";

    /// <summary>Tous les statuts, dans l'ordre de codes.js.</summary>
    public static readonly string[] Tous =
    [
        Deposee, Emise, Recue, MiseADisposition, PriseEnCharge, Approuvee, ApprouveePartiellement, EnLitige, Suspendue,
        Completee, Refusee, PaiementTransmis, Encaissee, Rejetee, Visee, Annulee, ErreurRoutage, DemandePaiementDirect,
        Affacturee, AffactureeConfidentiel, ChangementCompteAPayer, NonAffacturee, Irrecevable,
    ];

    /// <summary>Statuts terminaux : plus de statut obligatoire ensuite (STATUTS_TERMINAUX).</summary>
    public static readonly string[] Terminaux = [Refusee, Rejetee];

    /// <summary>Statuts dont le motif est obligatoire (STATUTS_MOTIF_OBLIGATOIRE).</summary>
    public static readonly string[] MotifObligatoire = [EnLitige, Refusee, Rejetee];

    /// <summary>Statuts obligatoirement transmis au PPF (STATUTS_OBLIGATOIRES_PPF).</summary>
    public static readonly string[] ObligatoiresPpf = [Deposee, Refusee, Encaissee, Rejetee];
}

/// <summary>Acteur qui pose un statut (émetteur MDG-16 du message CDV).</summary>
public static class EmetteurStatut
{
    public const string PaE = "PA_E";
    public const string PaR = "PA_R";
    public const string Vendeur = "VENDEUR";
    public const string Acheteur = "ACHETEUR";
    public const string Agent = "AGENT";
}

/// <summary>Sens d'une facture pour la société : émise (vente) ou reçue (achat, sous-traitance).</summary>
public static class SensFacture
{
    public const string Emise = "E";
    public const string Recue = "R";
}

/// <summary>Motif de statut (liste BR-FR-CDV-CL-09, onglet « Tableau des motifs de STATUTS » de l'annexe A XP Z12-012).</summary>
public static class MotifStatut
{
    public const string NonTransmise = "NON_TRANSMISE";
    public const string JustifAbs = "JUSTIF_ABS";
    public const string RoutageErr = "ROUTAGE_ERR";
    public const string RetraitManServ = "RETRAIT_MAN_SERV";
    public const string StCtNonDeclar = "ST_CT_NON_DECLAR";
    public const string SupprCompAvoir = "SUPPR_COMP_AVOIR";
    public const string TransfPmntRegie = "TRANSF_PMNT_REGIE";
    public const string ContactAchtr = "CONTACT_ACHTR";
    public const string Autre = "AUTRE";
    public const string CoordBancErr = "COORD_BANC_ERR";
    public const string TxTvaErr = "TX_TVA_ERR";
    public const string MontanttotalErr = "MONTANTTOTAL_ERR";
    public const string CalculErr = "CALCUL_ERR";
    public const string NonConforme = "NON_CONFORME";
    public const string Doublon = "DOUBLON";
    public const string DestInc = "DEST_INC";
    public const string DestErr = "DEST_ERR";
    public const string TransacInc = "TRANSAC_INC";
    public const string EmmetInc = "EMMET_INC";
    public const string ContratTerm = "CONTRAT_TERM";
    public const string DoubleFact = "DOUBLE_FACT";
    public const string CmdErr = "CMD_ERR";
    public const string AdrErr = "ADR_ERR";
    public const string SiretErr = "SIRET_ERR";
    public const string CodeRoutageErr = "CODE_ROUTAGE_ERR";
    public const string RefCtAbsent = "REF_CT_ABSENT";
    public const string RefErr = "REF_ERR";
    public const string PuErr = "PU_ERR";
    public const string RemErr = "REM_ERR";
    public const string QteErr = "QTE_ERR";
    public const string ArtErr = "ART_ERR";
    public const string ModpaiErr = "MODPAI_ERR";
    public const string QualiteErr = "QUALITE_ERR";
    public const string LivrIncomp = "LIVR_INCOMP";
    public const string RejSeman = "REJ_SEMAN";
    public const string RejUni = "REJ_UNI";
    public const string RejCoh = "REJ_COH";
    public const string RejAdr = "REJ_ADR";
    public const string RejContB2g = "REJ_CONT_B2G";
    public const string RejRefPj = "REJ_REF_PJ";
    public const string RejAssPj = "REJ_ASS_PJ";
    public const string IrrVideF = "IRR_VIDE_F";
    public const string IrrTypeF = "IRR_TYPE_F";
    public const string IrrSyntax = "IRR_SYNTAX";
    public const string IrrTaillePj = "IRR_TAILLE_PJ";
    public const string IrrNomPj = "IRR_NOM_PJ";
    public const string IrrVidPj = "IRR_VID_PJ";
    public const string IrrExtDoc = "IRR_EXT_DOC";
    public const string IrrTailleF = "IRR_TAILLE_F";
    public const string IrrAntivirus = "IRR_ANTIVIRUS";
    public const string IrrNomF = "IRR_NOM_F";

    public static readonly string[] Tous =
    [
        NonTransmise, JustifAbs, RoutageErr, RetraitManServ, StCtNonDeclar, SupprCompAvoir,
        TransfPmntRegie, ContactAchtr, Autre, CoordBancErr, TxTvaErr, MontanttotalErr,
        CalculErr, NonConforme, Doublon, DestInc, DestErr, TransacInc,
        EmmetInc, ContratTerm, DoubleFact, CmdErr, AdrErr, SiretErr,
        CodeRoutageErr, RefCtAbsent, RefErr, PuErr, RemErr, QteErr,
        ArtErr, ModpaiErr, QualiteErr, LivrIncomp, RejSeman, RejUni,
        RejCoh, RejAdr, RejContB2g, RejRefPj, RejAssPj, IrrVideF,
        IrrTypeF, IrrSyntax, IrrTaillePj, IrrNomPj, IrrVidPj, IrrExtDoc,
        IrrTailleF, IrrAntivirus, IrrNomF,
    ];
}

/// <summary>Action attendue d'un statut (liste BR-FR-CDV-CL-10).</summary>
public static class ActionCdv
{
    public const string Aucune = "NOA";
    public const string Information = "PIN";
    public const string Rectificative = "NIN";
    public const string AvoirTotal = "CNF";
    public const string AvoirPartiel = "CNP";
    public const string Remboursement = "CNA";
    public const string Autre = "OTH";

    public static readonly string[] Tous = [Aucune, Information, Rectificative, AvoirTotal, AvoirPartiel, Remboursement, Autre];
}

/// <summary>Syntaxe d'un flux (flowSyntax de XP Z12-013).</summary>
public static class Syntaxe
{
    public const string Cii = "CII";
    public const string Ubl = "UBL";
    public const string FacturX = "Factur-X";
    public const string Cdar = "CDAR";
    public const string Frr = "FRR";
}

/// <summary>Profil d'un flux (flowProfile de XP Z12-013) : Basic, CIUS (EN16931), Extended-CTC-FR.</summary>
public static class ProfilFacture
{
    public const string Basic = "Basic";
    public const string En16931 = "CIUS";
    public const string ExtendedCtcFr = "Extended-CTC-FR";
    public const string NonDefini = "Undefined";
}

/// <summary>Identifiant de spécification (BT-24, GuidelineSpecifiedDocumentContextParameter) : profils Factur-X et CII.</summary>
public static class SpecificationFacture
{
    public const string Minimum = "urn:factur-x.eu:1p0:minimum";
    public const string BasicWl = "urn:factur-x.eu:1p0:basicwl";
    public const string Basic = "urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic";
    public const string En16931 = "urn:cen.eu:en16931:2017";
    public const string Extended = "urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended";
    public const string ExtendedZugferd = "urn:cen.eu:en16931:2017#conformant#urn:zugferd.de:2p0:extended";
    public const string ExtendedCtcFr = "urn:cen.eu:en16931:2017#conformant#urn.cpro.gouv.fr:1p0:extended-ctc-fr";
}

/// <summary>Type de document référencé (UNTDID 1001, AdditionalReferencedDocument/TypeCode) : BT-17, BT-18, BT-122.</summary>
public static class TypeDocumentReference
{
    public const string AppelOffres = "50";
    public const string ObjetFacture = "130";
    public const string Justificatif = "916";
    /// <summary>UBL CreditNote : BT-11 (projet) porté par AdditionalDocumentReference de ce type (pas de ProjectReference).</summary>
    public const string ProjetAvoirUbl = "50";
}

/// <summary>Schéma d'identifiant (ISO 6523 ICD, schemeID) et d'immatriculation fiscale (VA, FC).</summary>
public static class SchemaIdentifiant
{
    public const string Siren = "0002";
    public const string Siret = "0009";
    public const string CodeRoutage = "0224";
    public const string AdresseElectronique = "0225";
    public const string Tva = "VA";
    public const string Fiscal = "FC";
    /// <summary>UBL : identifiant de créancier SEPA (BT-90) dans PartyIdentification, hors identifiants de la partie.</summary>
    public const string CreancierSepa = "SEPA";
    /// <summary>UBL : TaxScheme/ID du numéro de TVA (BT-31, BT-48, BT-63) ; tout autre régime porte l'identifiant fiscal (BT-32).</summary>
    public const string TvaUbl = "VAT";
}

/// <summary>BT-8 : code de date d'exigibilité de la TVA, valeur du modèle (UNTDID 2475, CII DueDateTypeCode).</summary>
public static class CodeExigibiliteTva
{
    public const string DateFacture = "5";
    public const string DateLivraison = "29";
    public const string DatePaiement = "72";
}

/// <summary>BT-8 en UBL (UNTDID 2005, InvoicePeriod/DescriptionCode), converti en <see cref="CodeExigibiliteTva"/> à la lecture.</summary>
public static class CodeExigibiliteTvaUbl
{
    public const string DateFacture = "3";
    public const string DateLivraison = "35";
    public const string DatePaiement = "432";
}

/// <summary>Type d'un flux (flowType de XP Z12-013).</summary>
public static class TypeFlux
{
    public const string FactureClient = "CustomerInvoice";
    public const string FactureFournisseur = "SupplierInvoice";
    public const string CdvFactureClient = "CustomerInvoiceLC";
    public const string CdvFactureFournisseur = "SupplierInvoiceLC";
    public const string EtatCdvFactureClient = "StateCustomerInvoiceLC";
    public const string EtatCdvFactureFournisseur = "StateSupplierInvoiceLC";
    public const string TransactionsAgregees = "AggregatedCustomerTransactionReport";
    public const string TransactionsUnitaires = "UnitaryCustomerTransactionReport";
    public const string PaiementsAgreges = "AggregatedCustomerPaymentReport";
    public const string PaiementsUnitaires = "UnitaryCustomerPaymentReport";
    public const string TransactionsFournisseur = "UnitarySupplierTransactionReport";
    public const string RapportMultiflux = "MultiFlowReport";
    public const string EtatFactureClient = "StateCustomerInvoice";
    public const string EtatFactureFournisseur = "StateSupplierInvoice";
    public const string EtatTransactions = "StateTransactionReport";
    public const string EtatCdvTransactions = "StateTransactionReportLC";
    public const string EtatPaiements = "StatePaymentReport";
    public const string EtatCdvPaiements = "StatePaymentReportLC";
    public const string NonDefini = "Undefined";
}

/// <summary>Sens d'un flux vu de LogiBTP (flowDirection de XP Z12-013) : entrant (PA → LogiBTP), sortant (LogiBTP → PA).</summary>
public static class SensFlux
{
    public const string Entrant = "In";
    public const string Sortant = "Out";
}

/// <summary>Règle de traitement d'un flux (processingRule de XP Z12-013).</summary>
public static class RegleTraitement
{
    public const string B2B = "B2B";
    public const string B2BInt = "B2BInt";
    public const string B2C = "B2C";
    public const string B2G = "B2G";
    public const string B2GInt = "B2GInt";
    public const string HorsReforme = "OutOfScope";
    public const string B2GHorsReforme = "B2GOutOfScope";
    public const string ArchivageSeul = "ArchiveOnly";
    public const string NonApplicable = "NotApplicable";
    public const string NonDefini = "Undefined";
}

/// <summary>État de l'accusé d'un flux déposé (ackStatus de XP Z12-013).</summary>
public static class EtatAccuse
{
    public const string EnAttente = "Pending";
    public const string Ok = "Ok";
    public const string Erreur = "Error";
}

/// <summary>Étape de la validation d'une facture (note explicative FNFE 1.4.0 : XSD, puis schematron du profil, puis BR-FR-Flux2).</summary>
public static class EtapeControle
{
    public const string Xsd = "XSD";
    public const string Profil = "PROFIL";
    public const string France = "FRANCE";
}

/// <summary>Niveau d'un contrôle de schematron (attribut flag du SVRL ; « fatal » rejette la facture).</summary>
public static class NiveauControle
{
    public const string Fatal = "fatal";
    public const string Avertissement = "warning";
    public const string Information = "information";
}

/// <summary>Niveau d'un détail d'accusé (XP Z12-013).</summary>
public static class NiveauAccuse
{
    public const string Erreur = "Error";
    public const string Avertissement = "Warning";
}

/// <summary>Motif d'un détail d'accusé (reasonCode de XP Z12-013 ; une PA peut en ajouter).</summary>
public static class MotifAccuse
{
    public const string PjVide = "EmptyAttachement";
    public const string TypePj = "AttachmentTypeError";
    public const string FluxVide = "EmptyFlow";
    public const string AutreErreurTechnique = "OtherTechnicalError";
    public const string SchemaInvalide = "InvalidSchema";
    public const string TailleDepassee = "FileSizeExceeded";
    public const string TypeFlux = "FlowTypeError";
    public const string FluxExistant = "AlreadyExistingFlow";
    public const string Virus = "VirusFound";
    public const string Empreinte = "ChecksumMismatch";
    public const string CdvStatutInvalide = "InvoiceLCInvalidStatus";
    public const string CdvStatutErreur = "InvoiceLCStatusError";
    public const string CdvRegle = "InvoiceLCRuleError";
    public const string CdvAccesRefuse = "InvoiceLCAccessDenied";
    public const string CdvMontant = "InvoiceLCAmountError";
}

/// <summary>État d'un flux dans la file de LogiBTP.</summary>
public static class EtatFlux
{
    public const string AEnvoyer = "A_ENVOYER";
    public const string Envoye = "ENVOYE";
    public const string Acquitte = "ACQUITTE";
    public const string Erreur = "ERREUR";
    public const string Recu = "RECU";
    public const string Traite = "TRAITE";
    public const string Abandonne = "ABANDONNE";
}

/// <summary>Type d'une étape du journal chaîné d'une facture émise ou reçue (fe_evenement, lot 8).</summary>
public static class EvenementFe
{
    public const string Production = "PRODUCTION";
    public const string Controle = "CONTROLE";
    public const string Depot = "DEPOT";
    public const string Accuse = "ACCUSE";
    public const string Reception = "RECEPTION";
    public const string StatutRecu = "STATUT_RECU";
    public const string StatutPose = "STATUT_POSE";
    public const string Erreur = "ERREUR";
    public const string Reprise = "REPRISE";
    public const string ActionUtilisateur = "ACTION_UTILISATEUR";
    public const string AvoirInterne = "AVOIR_INTERNE";
    public const string Rattachement = "RATTACHEMENT";
    public const string ImportManuel = "IMPORT_MANUEL";
}

/// <summary>Erreurs du contrôle d'un statut de cycle de vie et de la lecture d'une facture (lot 2).</summary>
public static class ErreurFe
{
    public const string SensInconnu = "SENS_INCONNU";
    public const string StatutInconnu = "STATUT_INCONNU";
    public const string EmetteurNonAutorise = "EMETTEUR_NON_AUTORISE";
    public const string MotifInconnu = "MOTIF_INCONNU";
    public const string MotifNonAutorise = "MOTIF_NON_AUTORISE";
    public const string MotifObligatoire = "MOTIF_OBLIGATOIRE";
    public const string ActionInconnue = "ACTION_INCONNUE";
    public const string StatutTerminal = "STATUT_TERMINAL";
    public const string TransitionInterdite = "TRANSITION_INTERDITE";
    /// <summary>Lecture : XML mal formé.</summary>
    public const string XmlIllisible = "XML_ILLISIBLE";
    /// <summary>Lecture : élément racine d'une syntaxe non prise en charge.</summary>
    public const string SyntaxeInconnue = "SYNTAXE_INCONNUE";
    /// <summary>Lecture : XML non conforme au schéma XSD.</summary>
    public const string XsdInvalide = "XSD_INVALIDE";
    /// <summary>Lecture : profil (BT-24) absent ou non reconnu.</summary>
    public const string ProfilInconnu = "PROFIL_INCONNU";
    /// <summary>Lecture : terme obligatoire absent, date ou montant illisible.</summary>
    public const string DonneeInvalide = "DONNEE_INVALIDE";
    /// <summary>Factur-X : PDF illisible.</summary>
    public const string PdfIllisible = "PDF_ILLISIBLE";
    /// <summary>Factur-X : pas de fichier factur-x.xml embarqué.</summary>
    public const string XmlAbsent = "XML_ABSENT";
}
