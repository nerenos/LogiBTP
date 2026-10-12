namespace LogiBTP.Bibliotheque;

/// <summary>Période de coefficients : globale (NatId null) ou propre à une nature ; un coefficient null est repris de la portée supérieure.</summary>
public sealed class PeriodeCoefficients
{
    public int? NatId { get; set; }
    public string Debut { get; set; } = "";
    public decimal? CoefFg { get; set; }
    public decimal? CoefBenef { get; set; }
}

/// <summary>Coefficients d'un élément pour la résolution : nature et coefficients éventuellement imposés.</summary>
public sealed class CoefficientsSaisis
{
    public int? NatId { get; set; }
    public decimal? CoefFg { get; set; }
    public bool CoefFgImpose { get; set; }
    public decimal? CoefBenef { get; set; }
    public bool CoefBenefImpose { get; set; }
}

public sealed record SourceCoefficient(string Portee, string? Debut);

public sealed record CoefficientsResolus(decimal CoefFg, decimal CoefBenef, SourceCoefficient SourceFg, SourceCoefficient SourceBenef);

/// <summary>
/// Coefficients effectifs : même règle que coefficientsEffectifs (calcul.js, jeu partagé 02_coefficients.json). Imposé
/// par l'élément, sinon période de la nature en vigueur (dernier début ≤ date, coefficient renseigné), sinon période
/// globale, sinon valeur par défaut.
/// </summary>
public static class CoefficientsElement
{
    public static readonly string[] TypesNature = ["MO", "ENGIN", "MATERIAUX", "SOUS_TRAITANCE", "FRAIS", "FACTURATION_INTERNE", "AMORTISSEMENT", "DIVERS"];

    private static PeriodeCoefficients? EnVigueur(IEnumerable<PeriodeCoefficients> periodes, int? natId, Func<PeriodeCoefficients, decimal?> champ, string date) =>
        periodes.Where(p => p.NatId == natId && string.CompareOrdinal(p.Debut[..10], date) <= 0 && champ(p) is not null)
            .OrderByDescending(p => p.Debut, StringComparer.Ordinal).FirstOrDefault();

    private static (decimal, SourceCoefficient) Coefficient(int? natId, decimal? saisi, bool impose, IReadOnlyList<PeriodeCoefficients> periodes,
        Func<PeriodeCoefficients, decimal?> champ, string date, decimal defaut)
    {
        if (impose) return (saisi ?? defaut, new SourceCoefficient("impose", null));
        var p = (natId is not null ? EnVigueur(periodes, natId, champ, date) : null) ?? EnVigueur(periodes, null, champ, date);
        return p is null ? (defaut, new SourceCoefficient("defaut", null))
            : (champ(p)!.Value, new SourceCoefficient(p.NatId is null ? "global" : "nature", p.Debut[..10]));
    }

    public static CoefficientsResolus Resoudre(CoefficientsSaisis e, IReadOnlyList<PeriodeCoefficients> periodes, string date, decimal coefFgDefaut = 1, decimal coefBenefDefaut = 1)
    {
        var (fg, sfg) = Coefficient(e.NatId, e.CoefFg, e.CoefFgImpose, periodes, p => p.CoefFg, date, coefFgDefaut);
        var (benef, sbenef) = Coefficient(e.NatId, e.CoefBenef, e.CoefBenefImpose, periodes, p => p.CoefBenef, date, coefBenefDefaut);
        return new CoefficientsResolus(fg, benef, sfg, sbenef);
    }
}
