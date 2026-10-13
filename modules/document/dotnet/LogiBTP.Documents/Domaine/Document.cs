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
    public int EntStdId { get; set; }
    public long EntTiersId { get; set; }
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
