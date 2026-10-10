namespace LogiBTP.Domaine;

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

/// <summary>Solde d'un reliquat sans création de document.</summary>
public class DocumentLigneSolde
{
    public long LsoId { get; set; }
    public long LsoLigId { get; set; }
    public string LsoEtape { get; set; } = "";
    public decimal LsoQte { get; set; }
    public DateTimeOffset LsoDate { get; set; }
    public string LsoUtilisateur { get; set; } = "";
    public string? LsoMotif { get; set; }
}
