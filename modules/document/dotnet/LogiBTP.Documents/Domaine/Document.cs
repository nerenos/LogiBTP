using System.Text.Json;

namespace LogiBTP.Documents;

/// <summary>
/// Entête de document générique (table document du module Document). Classe mère : le cœur la spécialise
/// en ajoutant ses colonnes (DocumentBtp).
/// </summary>
public class Document
{
    public long EntId { get; set; }
    public int EntTydId { get; set; }
    /// <summary>Attribué à la validation pour les types à numérotation continue.</summary>
    public string? EntNumero { get; set; }
    public DateOnly EntDate { get; set; }
    public string? EntObjet { get; set; }
    /// <summary>Notre référence (dossier interne, numéro dans le logiciel d'origine d'un import).</summary>
    public string? EntNotreReference { get; set; }
    /// <summary>Référence du client ou du fournisseur.</summary>
    public string? EntReferenceExterne { get; set; }
    /// <summary>Durée de validité en jours.</summary>
    public short? EntValiditeJours { get; set; }
    /// <summary>Fin de validité : date de validation + durée, calculée par le serveur à la validation.</summary>
    public DateOnly? EntDateValidite { get; set; }
    public int EntStdId { get; set; }
    public long? EntTiersId { get; set; }
    public JsonDocument? EntAdresseFacturation { get; set; }
    public JsonDocument? EntAdresseLivraison { get; set; }
    public string EntDevise { get; set; } = "EUR";
    public JsonDocument? EntNumFormat { get; set; }
    public short EntPrecisionMontant { get; set; } = 2;
    public string? EntVersionCalcul { get; set; }
    public decimal EntTotalHt { get; set; }
    public decimal EntTotalTva { get; set; }
    public decimal EntTotalTtc { get; set; }
    public decimal EntNetAPayer { get; set; }
    public JsonDocument? EntProprietes { get; set; }
    /// <summary>Identifiant commun aux indices d'un même document.</summary>
    public long? EntGroupeId { get; set; }
    public string EntIndice { get; set; } = "A";
    public bool EntIsReference { get; set; } = true;
    public bool EntVerrouille { get; set; }
    public long? EntCopieDeId { get; set; }
    /// <summary>Document créé et validé automatiquement par une transformation directe (commande d'un devis facturé).</summary>
    public bool EntIntermediaire { get; set; }
    /// <summary>Avancement : C cumul (situation, reprise), P période (facture d'avancement) ; null sans avancement.</summary>
    public string? EntAvtPresentation { get; set; }
    /// <summary>Dépassement du montant du marché permis (option du marché).</summary>
    public bool EntAvtDepassement { get; set; }
    /// <summary>Avoir : ANNULATION (annule une facture) ou AVANCEMENT (facture d'avancement à période négative).</summary>
    public string? EntNatureAvoir { get; set; }
    /// <summary>Pièce comptable : A à transférer, T transférée, S sans écriture (total nul).</summary>
    public string? EntEtatCompta { get; set; }
    /// <summary>Numéro de situation (par marché ; modifiable pour une reprise d'un autre logiciel).</summary>
    public int? EntRangAvancement { get; set; }
    /// <summary>Condition de paiement (condition_paiement) ; vide : celle du tiers, sinon la condition par défaut (figée à la validation).</summary>
    public string? EntCpaCode { get; set; }
    /// <summary>Mode de règlement ; vide : celui du tiers.</summary>
    public string? EntModeReglement { get; set; }
    /// <summary>Cycle de vie (019d) : approbation interne, envoi (validation de l'entreprise), validation du tiers.</summary>
    public DateTimeOffset? EntApprouveLe { get; set; }
    public DateTimeOffset? EntEnvoyeLe { get; set; }
    public DateTimeOffset? EntValideTiersLe { get; set; }
    /// <summary>État de paiement posé par l'application (module Règlements) : P partiel, T total.</summary>
    public string? EntEtatPaiement { get; set; }
    /// <summary>Rejet de la pièce (plateforme, tiers) : date et motif ; le document reste ENVOYE jusqu'à l'avoir.</summary>
    public DateTimeOffset? EntRejeteLe { get; set; }
    public string? EntRejetMotif { get; set; }
    /// <summary>Version d'enregistrement, verrouillage optimiste.</summary>
    public int EntVersion { get; set; } = 1;
    public DateTimeOffset EntCreeLe { get; set; }
    public string EntCreePar { get; set; } = "";
    public DateTimeOffset? EntModifieLe { get; set; }
    public string? EntModifiePar { get; set; }
    /// <summary>Modèle de saisie (COMPLET, VOLEE…) : vue de colonnes par défaut.</summary>
    public string? EntModele { get; set; }
    /// <summary>Étiquettes de lignes propres au document (ajoutées ou personnalisées) : [{ code, libelle, couleur }].</summary>
    public JsonDocument? EntEtiquettes { get; set; }
}

/// <summary>Ventilation de TVA du document (table document_tva).</summary>
public class DocumentTva
{
    public long TvaEntId { get; set; }
    public int? TvaTtvId { get; set; }
    public string TvaCode { get; set; } = "";
    public decimal TvaTaux { get; set; }
    public string TvaCategorie { get; set; } = "N";
    public decimal TvaBaseHt { get; set; }
    public decimal TvaMontant { get; set; }
    public decimal TvaMontantAnnulation { get; set; }
    public decimal TvaMontantNet { get; set; }
    public string? TvaMention { get; set; }
}

public class DocumentLien
{
    public long LieSourceEntId { get; set; }
    public long LieCibleEntId { get; set; }
    /// <summary>TRANSFORMATION ou COPIE.</summary>
    public string LieType { get; set; } = "TRANSFORMATION";
    /// <summary>Choix des options et variantes à la transformation : [{ lig_id, retenue }].</summary>
    public JsonDocument? LieChoix { get; set; }
}

/// <summary>Origine d'un document importé (table document_origine) : traçabilité et réutilisation du fichier source.</summary>
public class DocumentOrigine
{
    public long DorEntId { get; set; }
    public string DorType { get; set; } = "IMPORT";
    public string DorFormat { get; set; } = "";
    /// <summary>Fichier source conservé (identifiant fourni par l'application : document de la GED).</summary>
    public long? DorFichierId { get; set; }
    public string? DorNomFichier { get; set; }
    public string? DorReference { get; set; }
    public JsonDocument? DorRapport { get; set; }
    public DateTimeOffset DorDate { get; set; }
    public string DorUtilisateur { get; set; } = "";
}

public class DocumentHistorique
{
    public long HisId { get; set; }
    public long HisEntId { get; set; }
    /// <summary>Version du document avant modification.</summary>
    public int HisVersion { get; set; }
    /// <summary>CREATION, MODIFICATION, VALIDATION, ANNULATION.</summary>
    public string HisAction { get; set; } = "";
    public DateTimeOffset HisDate { get; set; }
    public string HisUtilisateur { get; set; } = "";
    public JsonDocument HisInstantane { get; set; } = JsonDocument.Parse("{}");
}

public class CalculCasTest
{
    public long CasId { get; set; }
    public long? CasEntId { get; set; }
    public DateTimeOffset CasDate { get; set; }
    public string CasUtilisateur { get; set; } = "";
    public string CasVersionClient { get; set; } = "";
    public string CasVersionServeur { get; set; } = "";
    public JsonDocument CasDocumentEntree { get; set; } = JsonDocument.Parse("{}");
    public JsonDocument CasResultatClient { get; set; } = JsonDocument.Parse("{}");
    public JsonDocument CasResultatServeur { get; set; } = JsonDocument.Parse("{}");
    public JsonDocument CasEcarts { get; set; } = JsonDocument.Parse("[]");
    /// <summary>S serveur validé, A anomalie.</summary>
    public string CasDecision { get; set; } = "S";
    public JsonDocument? CasResultatAttendu { get; set; }
    /// <summary>N nouveau, E en cours, C corrigé.</summary>
    public string CasStatut { get; set; } = "N";
    public string? CasCommentaire { get; set; }
}
