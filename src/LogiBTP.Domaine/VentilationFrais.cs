namespace LogiBTP.Domaine;

/// <summary>
/// Clé de ventilation des frais annexes d'un document (db/167_ventilation_frais.sql) : oriente une part d'une tranche
/// de frais (VfrSourceLigId ; nulle : clé de nature valable pour toutes les tranches) vers une ligne, un élément (code et
/// libellé, cleElementVentilation) ou une nature, en % du montant de la tranche (P) ou en montant (M : par unité de
/// quantité pour une ligne, total pour un élément ou une nature).
/// </summary>
public class VentilationFrais
{
    public long VfrId { get; set; }
    public long VfrEntId { get; set; }
    public long? VfrSourceLigId { get; set; }
    /// <summary>LIGNE, ELEMENT ou NATURE.</summary>
    public string VfrCible { get; set; } = "LIGNE";
    public long? VfrLigId { get; set; }
    public string? VfrElement { get; set; }
    public int? VfrNatId { get; set; }
    /// <summary>P pourcentage, M montant.</summary>
    public string VfrMode { get; set; } = "P";
    public decimal VfrValeur { get; set; }
}

/// <summary>Détail calculé de la ventilation : part d'une tranche de frais reçue par une ligne (clé appliquée, nulle : prorata).</summary>
public class VentilationFraisLigne
{
    public long VflId { get; set; }
    public long VflEntId { get; set; }
    public long VflSourceLigId { get; set; }
    public long VflLigId { get; set; }
    public decimal VflMontant { get; set; }
    public long? VflVfrId { get; set; }
}
