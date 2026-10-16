namespace LogiBTP.Metres;

public class Metre
{
    public long MtrId { get; set; }
    public long MtrLigId { get; set; }
    public string? MtrLibelle { get; set; }
    public string? MtrUntCode { get; set; }
    /// <summary>Affectation du résultat à une variable, par exemple @surface.</summary>
    public string? MtrVariable { get; set; }
    public decimal? MtrResultat { get; set; }
    /// <summary>Script du métré (déclarations, instructions, « Renvoyer » = quantité) ; null = lignes de métré.</summary>
    public string? MtrScript { get; set; }
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
    /// <summary>N numérique, C chaîne, B booléen (variables d'un script).</summary>
    public string VarType { get; set; } = "N";
    /// <summary>Dernière valeur calculée d'une variable chaîne ou booléenne (Vrai / Faux).</summary>
    public string? VarValeurTexte { get; set; }
}
