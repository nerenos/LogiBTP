namespace LogiBTP.Domaine;

public class Metre
{
    public long MtrId { get; set; }
    public long MtrLigId { get; set; }
    public string? MtrLibelle { get; set; }
    public string? MtrUntCode { get; set; }
    /// <summary>Affectation du résultat à une variable, par exemple @surface.</summary>
    public string? MtrVariable { get; set; }
    public decimal? MtrResultat { get; set; }
}

public class MetreLigne
{
    public long MliId { get; set; }
    public long MliMtrId { get; set; }
    /// <summary>Ligne de sous-détail parente.</summary>
    public long? MliParentId { get; set; }
    public int MliOrdre { get; set; }
    /// <summary>V valeur, D sous-détail, S sous-total.</summary>
    public string MliType { get; set; } = "V";
    /// <summary>+, -, *, /.</summary>
    public string? MliOperateur { get; set; }
    public string? MliFormule { get; set; }
    public decimal? MliValeur { get; set; }
    public long? MliStDepuisId { get; set; }
    public string? MliVariable { get; set; }
    public string? MliCommentaire { get; set; }
}

public class VariableDefinition
{
    public long VarId { get; set; }
    public long VarEntId { get; set; }
    /// <summary>Ligne porteuse ; null = variable du document.</summary>
    public long? VarLigId { get; set; }
    /// <summary>Métré porteur (onglet Définition du métré).</summary>
    public long? VarMtrId { get; set; }
    /// <summary>$$, $, @@ ou @.</summary>
    public string VarPortee { get; set; } = "@";
    public string VarNom { get; set; } = "";
    /// <summary>= affectation, += incrémentation.</summary>
    public string VarOperation { get; set; } = "=";
    public string VarFormule { get; set; } = "";
    public int VarOrdre { get; set; }
    public decimal? VarValeur { get; set; }
}
