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
    public const string B2CInt = "B2CINT";
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
    /// <summary>BR-FR-06 : une fois au plus.</summary>
    public const string MentionTaxe = "TXD";
    /// <summary>Clause de réserve : retenue de garantie des situations de travaux (cœur, lot 23).</summary>
    public const string Reserve = "ABU";
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

    /// <summary>Statuts dont le motif est obligatoire (STATUTS_MOTIF_OBLIGATOIRE, BR-FR-CDV-15).</summary>
    public static readonly string[] MotifObligatoire = [ApprouveePartiellement, EnLitige, Suspendue, Refusee, Rejetee, Irrecevable];

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
    /// <summary>CDAR : matricule d'une plateforme (PA, PPF, Chorus Pro).</summary>
    public const string Plateforme = "0238";
    /// <summary>UBL : identifiant de créancier SEPA (BT-90) dans PartyIdentification, hors identifiants de la partie.</summary>
    public const string CreancierSepa = "SEPA";
    /// <summary>UBL : TaxScheme/ID du numéro de TVA (BT-31, BT-48, BT-63) ; tout autre régime porte l'identifiant fiscal (BT-32).</summary>
    public const string TvaUbl = "VAT";
    // E-reporting (flux 10, G2.19) : identifiant d'une entreprise sans SIREN.
    public const string UeHorsFrance = "0223";
    public const string HorsUe = "0227";
    public const string Ridet = "0228";
    public const string Tahiti = "0229";
}

/// <summary>CDAR : matricule (schéma 0238) des plateformes publiques.</summary>
public static class MatriculePlateforme
{
    public const string Ppf = "0000";
    /// <summary>Refusée B2G : motifs propres (BR-FR-CDV-CL-09) si l'expéditeur est Chorus Pro.</summary>
    public const string ChorusPro = "9999";
}

/// <summary>CDAR : rôle d'une partie du message (UNCL 3035, BR-FR-CDV-CL-02 à CL-04, CL-07, CL-08).</summary>
public static class RoleCdar
{
    public const string Acheteur = "BY";
    public const string RepresentantAcheteur = "AB";
    public const string Affactureur = "DL";
    public const string Vendeur = "SE";
    public const string AgentVendeur = "SR";
    public const string Plateforme = "WK";
    public const string Ppf = "DFH";
    public const string Beneficiaire = "PE";
    public const string Payeur = "PR";
    public const string Facturant = "II";
    public const string Facture = "IV";
}

/// <summary>CDAR MDT-77 : phase du statut (UNCL 1001, BR-FR-CDV-09).</summary>
public static class TypeAccuseCdar
{
    /// <summary>Phase de traitement.</summary>
    public const string Information = "23";
    /// <summary>Phase de transmission.</summary>
    public const string Acquittement = "305";
}

/// <summary>CDAR MDT-2 : processus métier (BR-FR-CDV-CL-01).</summary>
public static class ProcessusCdv
{
    public const string Reglemente = "REGULATED";
    public const string NonReglemente = "NON_REGULATED";
    public const string B2C = "B2C";
    public const string B2CInt = "B2CINT";
    public const string B2BInt = "B2BINT";
    public const string HorsReforme = "OUTOFSCOPE";
}

/// <summary>CDAR MDT-3 : profil du message (BR-FR-CDV-02 ; einvoicingF2 : message pour le seul PPF).</summary>
public static class ProfilCdv
{
    public const string Facture = "urn.cpro.gouv.fr:1p0:CDV:invoice";
    public const string Ppf = "urn.cpro.gouv.fr:1p0:CDV:einvoicingF2";
}

/// <summary>CDAR MDT-207 : nature d'une caractéristique du détail de statut (BR-FR-CDV-CL-11).</summary>
public static class CaracteristiqueCdv
{
    /// <summary>Montant encaissé TTC, avec le taux de TVA (Encaissée, BR-FR-CDV-14).</summary>
    public const string MontantEncaisse = "MEN";
    public const string MontantPaye = "MPA";
    public const string ResteAPayer = "RAP";
    public const string Escompte = "ESC";
    public const string Rabais = "RAB";
    public const string Remise = "REM";
    public const string MontantHtApprouve = "MAP";
    public const string MontantTtcApprouve = "MAPTTC";
    public const string MontantHtNonApprouve = "MNA";
    public const string MontantTtcNonApprouve = "MNATTC";
    public const string CoordonneesBancaires = "CBB";
    public const string DonneeInvalide = "DIV";
    public const string DonneeValideAttendue = "DVA";
    public const string DonneeAPrendre = "MAJ";
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
    // Réception (lot 12) : facture lue, pièce créée par l'application, création refusée pour une facture en double.
    public const string Lecture = "LECTURE";
    public const string PieceCreee = "PIECE_CREEE";
    public const string Doublon = "DOUBLON";
}

/// <summary>Auteur d'une étape du journal fe_evenement : utilisateur, LogiBTP (file, relève), plateforme (accusé, statut reçu).</summary>
public static class ActeurFe
{
    public const string Utilisateur = "UTILISATEUR";
    public const string Systeme = "SYSTEME";
    public const string Plateforme = "PLATEFORME";
}

/// <summary>Sens d'un statut de cycle de vie dans fe_statut : reçu de la plateforme, ou posé par la société.</summary>
public static class SensStatut
{
    public const string Recu = "RECU";
    public const string Pose = "POSE";
}

/// <summary>Découpage de l'e-reporting choisi par la société (Q20) : un envoi unique par période, ou plusieurs envois.</summary>
public static class DecoupageEreporting
{
    public const string Unique = "UNIQUE";
    public const string Plusieurs = "PLUSIEURS";
}

/// <summary>E-reporting (flux 10) : sous-flux, dans l'ordre de l'annexe A XP Z12-012 (onglet « E-REPORTING - Flux 10 »).</summary>
public static class SousFluxEreporting
{
    /// <summary>TG-8 : factures B2B internationales.</summary>
    public const string TransactionsUnitaires = "10.1";
    /// <summary>TG-34 : encaissements de ces factures.</summary>
    public const string PaiementsUnitaires = "10.2";
    /// <summary>TG-31 : ventes B2C cumulées par jour.</summary>
    public const string TransactionsAgregees = "10.3";
    /// <summary>TG-37 : encaissements B2C cumulés par jour.</summary>
    public const string PaiementsAgreges = "10.4";

    public static readonly string[] Tous = [TransactionsUnitaires, PaiementsUnitaires, TransactionsAgregees, PaiementsAgreges];
}

/// <summary>E-reporting TT-4 : type de transmission (G8.01 ; CO et MO de l'annexe A absents du XSD du paquet FNFE).</summary>
public static class TypeTransmission
{
    public const string Initiale = "IN";
    public const string Rectificative = "RE";
}

/// <summary>E-reporting TT-81 : catégorie des transactions agrégées (G1.68).</summary>
public static class CategorieTransactions
{
    /// <summary>Livraisons de biens soumises à la TVA.</summary>
    public const string Biens = "TLB1";
    /// <summary>Prestations de services soumises à la TVA.</summary>
    public const string Services = "TPS1";
    /// <summary>Opérations non soumises à la TVA en France.</summary>
    public const string NonTaxables = "TNT1";
    /// <summary>Régime de TVA sur la marge.</summary>
    public const string Marge = "TMA1";

    public static readonly string[] Toutes = [Biens, Services, NonTaxables, Marge];
}

/// <summary>E-reporting TT-29 : profil des transactions unitaires (S1.12).</summary>
public static class ProfilEreporting
{
    public const string Transactions = "urn.cpro.gouv.fr:1p0:ereporting";
}

/// <summary>Régime de TVA de la société, qui fixe la périodicité de l'e-reporting (<see cref="ReglesEreporting.Periodicite"/>).</summary>
public static class RegimeEreporting
{
    public const string ReelNormalMensuel = "REEL_NORMAL_MENSUEL";
    public const string ReelNormalTrimestriel = "REEL_NORMAL_TRIMESTRIEL";
    public const string Simplifie = "SIMPLIFIE";
    public const string Franchise = "FRANCHISE";
}

/// <summary>Durée d'une période d'e-reporting.</summary>
public static class PeriodiciteEreporting
{
    public const string Decade = "DECADE";
    public const string Mois = "MOIS";
    public const string Bimestre = "BIMESTRE";
}

/// <summary>
/// Règles contrôlées sur une transmission d'e-reporting avant l'envoi (<see cref="ReglesEreporting.Controler"/>) : codes des
/// règles de gestion de l'annexe 7 v1.8 (schematron Flux10 du paquet FNFE), plus LOGIBTP-PERIODE (date hors période).
/// </summary>
public static class RegleEreporting
{
    /// <summary>type de facture.</summary>
    public const string G101 = "G1.01";
    /// <summary>cadre de facturation.</summary>
    public const string G102 = "G1.02";
    /// <summary>identifiant de facture.</summary>
    public const string G105 = "G1.05";
    /// <summary>date AAAAMMJJ, année 2000 à 2099 (G1.36).</summary>
    public const string G109 = "G1.09";
    /// <summary>devise ISO 4217.</summary>
    public const string G110 = "G1.10";
    /// <summary>montant : 2 décimales, 19 chiffres.</summary>
    public const string G114 = "G1.14";
    /// <summary>montant encaissé : positif, 6 décimales, 19 chiffres.</summary>
    public const string G116 = "G1.16";
    /// <summary>taux de TVA.</summary>
    public const string G124 = "G1.24";
    /// <summary>facture antérieure d'un avoir ou d'une rectificative.</summary>
    public const string G132 = "G1.32";
    /// <summary>motif d'exonération.</summary>
    public const string G140 = "G1.40";
    /// <summary>totaux = somme des ventilations.</summary>
    public const string G153 = "G1.53";
    /// <summary>acompte en cadre définitif.</summary>
    public const string G160 = "G1.60";
    /// <summary>catégorie de transactions.</summary>
    public const string G168 = "G1.68";
    /// <summary>TVA du vendeur si exonération.</summary>
    public const string G1102 = "G1.102";
    /// <summary>identifiant de transmission.</summary>
    public const string G1104 = "G1.104";
    /// <summary>code pays.</summary>
    public const string G201 = "G2.01";
    /// <summary>type d'identifiant d'une entreprise.</summary>
    public const string G219 = "G2.19";
    /// <summary>catégorie de TVA.</summary>
    public const string G231 = "G2.31";
    /// <summary>numéro de TVA.</summary>
    public const string G233 = "G2.33";
    /// <summary>VATEX-FR-CNWVAT réservé aux avoirs.</summary>
    public const string G621 = "G6.21";
    /// <summary>émetteur : matricule de plateforme.</summary>
    public const string G622 = "G6.22";
    /// <summary>TVA de la facture en euros.</summary>
    public const string G623 = "G6.23";
    /// <summary>fin de période après le début.</summary>
    public const string G625 = "G6.25";
    /// <summary>déclarant : SIREN.</summary>
    public const string G626 = "G6.26";
    /// <summary>encaissement en euros.</summary>
    public const string G627 = "G6.27";
    /// <summary>identifiant de l'acheteur (B2B international).</summary>
    public const string G628 = "G6.28";
    /// <summary>un seul rapport par transmission.</summary>
    public const string G629 = "G6.29";
    /// <summary>rôle de l'émetteur.</summary>
    public const string G751 = "G7.51";
    /// <summary>rôle du déclarant.</summary>
    public const string G752 = "G7.52";
    /// <summary>type de transmission.</summary>
    public const string G801 = "G8.01";
    /// <summary>transaction ou paiement daté hors de la période de la transmission.</summary>
    public const string Periode = "LOGIBTP-PERIODE";
}

/// <summary>Code de motif d'exonération (VATEX, BT-121) attendu d'une ventilation autoliquidée (catégorie AE) : autoliquidation française.</summary>
public static class CodeExoneration
{
    public const string Autoliquidation = "VATEX-FR-AE";
}

/// <summary>
/// Écarts signalés à la réception d'une facture de sous-traitance (lot 15) : jamais bloquants, notés au rapport de la
/// pièce. Payeur (EXT-FR-FE-BG-02) et cadre S5 (BT-23) ; autoliquidation (AE / VATEX-FR-AE) comparée à celle attendue du
/// sous-traitant ; contrat du paiement direct (BT-12) non retrouvé, sans paiement direct prévu, ou payeur autre que le
/// maître d'ouvrage.
/// </summary>
public static class EcartReception
{
    public const string PayeurAbsent = "PAYEUR_ABSENT";
    public const string PayeurHorsS5 = "PAYEUR_HORS_S5";
    public const string AutoliquidationAbsente = "AUTOLIQUIDATION_ABSENTE";
    public const string AutoliquidationInattendue = "AUTOLIQUIDATION_INATTENDUE";
    public const string VatexAutoliquidation = "VATEX_AUTOLIQUIDATION";
    public const string ContratIntrouvable = "CONTRAT_INTROUVABLE";
    public const string PaiementDirectNonPrevu = "PAIEMENT_DIRECT_NON_PREVU";
    public const string PayeurDifferent = "PAYEUR_DIFFERENT";
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
    // Écriture des factures (lot 16)
    public const string ProfilNonEcrit = "PROFIL_NON_ECRIT";
    public const string DonneeHorsProfil = "DONNEE_HORS_PROFIL";
    // Connecteur de plateforme (lot 6) : demande refusée avant l'envoi, puis réponses de la plateforme (XP Z12-013, 400 à 503).
    /// <summary>Connecteur : code de connecteur non enregistré dans la fabrique.</summary>
    public const string ConnecteurInconnu = "CONNECTEUR_INCONNU";
    /// <summary>Connecteur : paramètre absent ou invalide (adresse de l'API, connexion OAuth).</summary>
    public const string ParametreConnecteur = "PARAMETRE_CONNECTEUR";
    /// <summary>Connecteur : fonction non offerte par ce connecteur (annuaire du dépôt manuel, abonnement, 501).</summary>
    public const string FonctionNonPriseEnCharge = "FONCTION_NON_PRISE_EN_CHARGE";
    /// <summary>Connecteur : demande refusée avant l'envoi (fichier vide, nom ou identifiant trop long, SIREN, curseur…).</summary>
    public const string DemandeInvalide = "DEMANDE_INVALIDE";
    /// <summary>400 : requête refusée par la plateforme.</summary>
    public const string RequeteRefusee = "REQUETE_REFUSEE";
    /// <summary>401 : jeton absent, expiré ou refusé.</summary>
    public const string NonAuthentifie = "NON_AUTHENTIFIE";
    /// <summary>403 : accès refusé (organisation, délégation).</summary>
    public const string AccesRefusePlateforme = "ACCES_REFUSE_PLATEFORME";
    /// <summary>404 : flux, fichier ou ligne d'annuaire introuvable.</summary>
    public const string RessourceIntrouvable = "RESSOURCE_INTROUVABLE";
    /// <summary>408 ou délai d'attente dépassé.</summary>
    public const string DelaiDepasse = "DELAI_DEPASSE";
    /// <summary>413 : fichier trop volumineux (100 Mo au plus).</summary>
    public const string FichierTropGros = "FICHIER_TROP_GROS";
    /// <summary>422 : données incohérentes.</summary>
    public const string DonneesIncoherentes = "DONNEES_INCOHERENTES";
    /// <summary>429 : trop de requêtes.</summary>
    public const string TropDeRequetes = "TROP_DE_REQUETES";
    /// <summary>500 et autres réponses inattendues de la plateforme.</summary>
    public const string ErreurPlateforme = "ERREUR_PLATEFORME";
    /// <summary>503 ou plateforme injoignable.</summary>
    public const string PlateformeIndisponible = "PLATEFORME_INDISPONIBLE";
    /// <summary>Réponse de la plateforme illisible ou contraire au contrat.</summary>
    public const string ReponseIllisible = "REPONSE_ILLISIBLE";
    // File, relève et journal (lot 8).
    /// <summary>Flux inconnu de la base de la société.</summary>
    public const string FluxIntrouvable = "FLUX_INTROUVABLE";
    /// <summary>Action impossible dans l'état du flux (nouvelle tentative d'un flux acquitté, confirmation d'un dépôt non manuel…).</summary>
    public const string EtatFluxInvalide = "ETAT_FLUX_INVALIDE";
    /// <summary>Paramètres du module invalides (connecteur, adresses, fréquence de relève).</summary>
    public const string ParametreInvalide = "PARAMETRE_INVALIDE";
    // Réception (lot 12) : facture déjà enregistrée chez l'application (même fournisseur, même numéro).
    public const string FactureEnDouble = "FACTURE_EN_DOUBLE";
}

/// <summary>Connecteur de plateforme (lot 6) : AFNOR XP Z12-013, plateforme simulée, dépôt manuel ; une PA propre s'ajoute à la fabrique.</summary>
public static class ConnecteurFe
{
    public const string Afnor = "AFNOR";
    public const string Simule = "SIMULE";
    public const string Manuel = "MANUEL";
}

/// <summary>Document d'un flux à télécharger (docType de GET /v1/flows/{flowId}).</summary>
public static class TypeDocumentFlux
{
    public const string Metadonnees = "Metadata";
    public const string Original = "Original";
    public const string Converti = "Converted";
    public const string Lisible = "ReadableView";
}

/// <summary>Origine de la règle de traitement d'un flux (processingRuleSource) : fournie au dépôt ou calculée par la plateforme.</summary>
public static class OrigineRegle
{
    public const string Fournie = "Input";
    public const string Calculee = "Computed";
}

/// <summary>Opérateur d'un filtre de recherche dans l'annuaire (Directory Service).</summary>
public static class OperateurAnnuaire
{
    public const string Egal = "strict";
    public const string Contient = "contains";
    public const string CommencePar = "startWith";
}

/// <summary>Type de plateforme de réception d'une ligne d'annuaire (platformType) : plateforme agréée ou PPF.</summary>
public static class TypePlateformeAnnuaire
{
    public const string Pa = "WK";
    public const string Ppf = "DFH";
}

/// <summary>État d'une ligne d'annuaire (directoryLineStatus).</summary>
public static class EtatLigneAnnuaire
{
    public const string Active = "Enabled";
    public const string Inactive = "Disabled";
    public const string AVenir = "Upcoming";
}

/// <summary>Type d'une pièce jointe (BT-123, liste BR-FR-17) ; LISIBLE une fois au plus (BR-FR-18).</summary>
public static class TypePieceJointe
{
    public const string Rib = "RIB";
    public const string Lisible = "LISIBLE";
    public const string FeuilleDeStyle = "FEUILLE_DE_STYLE";
    public const string Pja = "PJA";
    public const string BordereauSuivi = "BORDEREAU_SUIVI";
    public const string DocumentAnnexe = "DOCUMENT_ANNEXE";
    public const string BonLivraison = "BON_LIVRAISON";
    public const string BonCommande = "BON_COMMANDE";
    public const string BordereauSuiviValidation = "BORDEREAU_SUIVI_VALIDATION";
    public const string EtatAcompte = "ETAT_ACOMPTE";
    public const string FacturePaiementDirect = "FACTURE_PAIEMENT_DIRECT";
    public const string RecapitulatifCotraitance = "RECAPITULATIF_COTRAITANCE";

    /// <summary>Types admis (BR-FR-17).</summary>
    public static readonly IReadOnlyList<string> Tous = [Rib, Lisible, FeuilleDeStyle, Pja, BordereauSuivi, DocumentAnnexe, BonLivraison, BonCommande, BordereauSuiviValidation, EtatAcompte, FacturePaiementDirect, RecapitulatifCotraitance];
}

/// <summary>Niveau d'un écart du contrôle de complétude (lot 16, Q5) : bloquant pour un tiers B2B / B2G, avertissement sinon.</summary>
public static class NiveauCompletude
{
    public const string Bloquant = "BLOQUANT";
    public const string Avertissement = "AVERTISSEMENT";
}

/// <summary>
/// Règle du contrôle de complétude d'une facture émise (lot 16 : <c>completude.js</c> ↔ <see cref="ReglesCompletude"/>) :
/// règles françaises du schematron BR-FR-Flux2 (FNFE 1.4.0.04), sommes EN16931 (BR-CO), et deux règles propres à LogiBTP
/// (profil écrit, cadre émis).
/// </summary>
public static class RegleCompletude
{
    public const string Profil = "LOGIBTP-PROFIL";
    public const string Cadre = "LOGIBTP-CADRE";
    public const string BrFr01 = "BR-FR-01";
    public const string BrFr02 = "BR-FR-02";
    public const string BrFr03 = "BR-FR-03";
    public const string BrFr04 = "BR-FR-04";
    public const string BrFr05 = "BR-FR-05";
    public const string BrFr06 = "BR-FR-06";
    public const string BrFr08 = "BR-FR-08";
    public const string BrFr09 = "BR-FR-09";
    public const string BrFr10 = "BR-FR-10";
    public const string BrFr11 = "BR-FR-11";
    public const string BrFr12 = "BR-FR-12";
    public const string BrFr13 = "BR-FR-13";
    public const string BrFr15 = "BR-FR-15";
    public const string BrFr16 = "BR-FR-16";
    public const string BrFr17 = "BR-FR-17";
    public const string BrFr18 = "BR-FR-18";
    public const string BrFr20 = "BR-FR-20";
    public const string BrFr21 = "BR-FR-21";
    public const string BrFr22 = "BR-FR-22";
    public const string BrFr23 = "BR-FR-23";
    public const string BrFr24 = "BR-FR-24";
    public const string BrFr25 = "BR-FR-25";
    public const string BrFr26 = "BR-FR-26";
    public const string BrFr31 = "BR-FR-31";
    public const string BrFr32 = "BR-FR-32";
    public const string BrFrCo03 = "BR-FR-CO-03";
    public const string BrFrCo04 = "BR-FR-CO-04";
    public const string BrFrCo05 = "BR-FR-CO-05";
    public const string BrFrCo07 = "BR-FR-CO-07";
    public const string BrFrCo08 = "BR-FR-CO-08";
    public const string BrFrCo09 = "BR-FR-CO-09";
    public const string BrFrCo12 = "BR-FR-CO-12";
    public const string BrFrDec01 = "BR-FR-DEC-01";
    public const string BrFrDec02 = "BR-FR-DEC-02";
    public const string BrFrDec03 = "BR-FR-DEC-03";
    public const string BrFrDec04 = "BR-FR-DEC-04";
    public const string BrCo10 = "BR-CO-10";
    public const string BrCo11 = "BR-CO-11";
    public const string BrCo12 = "BR-CO-12";
    public const string BrCo13 = "BR-CO-13";
    public const string BrCo14 = "BR-CO-14";
    public const string BrCo15 = "BR-CO-15";
    public const string BrCo16 = "BR-CO-16";
    public const string BrCo17 = "BR-CO-17";
}

/// <summary>Moyen de paiement BT-81 (UNTDID 4461) écrit à l'émission (lot 22) ; virement : IBAN BT-84 exigé (BR-61).</summary>
public static class MoyenPaiementFe
{
    public const string NonDefini = "1";
    public const string Especes = "10";
    public const string Cheque = "20";
    public const string Virement = "30";
    public const string Carte = "48";
    public const string Prelevement = "49";
    public const string VirementSepa = "58";
    public const string PrelevementSepa = "59";
}
