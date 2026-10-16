namespace LogiBTP.Documents;

/// <summary>Lien entre une ligne source et une ligne cible, avec les quantités transformées.</summary>
public class DocumentLigneLien
{
    public long LilId { get; set; }
    public long LilSourceLigId { get; set; }
    public long LilCibleLigId { get; set; }
    public string LilEtape { get; set; } = "";
    /// <summary>Négative pour un retour ou un avoir.</summary>
    public decimal LilQte { get; set; }
    public decimal? LilMontantHt { get; set; }
    public decimal? LilAvancementPct { get; set; }
    public decimal? LilAvancementQte { get; set; }
}

/// <summary>Solde d'un reliquat : sans document, ou demandé par une ligne d'un document validé (LsoCibleLigId).</summary>
public class DocumentLigneSolde
{
    public long LsoId { get; set; }
    public long LsoLigId { get; set; }
    public string LsoEtape { get; set; } = "";
    public decimal LsoQte { get; set; }
    public DateTimeOffset LsoDate { get; set; }
    public string LsoUtilisateur { get; set; } = "";
    public string? LsoMotif { get; set; }
    /// <summary>Ligne du document qui a soldé (case Soldé ou seuil) ; le solde disparaît avec elle.</summary>
    public long? LsoCibleLigId { get; set; }
}

/// <summary>Paramètre global du module (clé → valeur JSON) : parametre_document.</summary>
public class ParametreDocument
{
    public string PdoCle { get; set; } = "";
    public System.Text.Json.JsonDocument PdoValeur { get; set; } = System.Text.Json.JsonDocument.Parse("null");
}
