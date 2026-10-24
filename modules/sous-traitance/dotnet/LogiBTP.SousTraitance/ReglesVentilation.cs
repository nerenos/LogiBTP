namespace LogiBTP.SousTraitance;

/// <summary>Ligne d'avancement de la commande : montant du marché et cumul précédent.</summary>
public sealed record LigneVentilee(long Id, decimal Marche, decimal Precedent);

public sealed record PartVentilee(long Id, decimal Periode, decimal Cumul);

public sealed record Ventilation(List<PartVentilee> Lignes, decimal Periode, List<string> Erreurs);

/// <summary>
/// Ventilation d'une facture reçue sur les lignes de la commande, répliquée dans ventilation.js (jeu
/// modules/sous-traitance/tests/cas/02_ventilation.json) : prorata du reste (ou du précédent pour une période négative),
/// arrondi demi vers l'infini, écart absorbé par la ligne de plus forte base.
/// </summary>
public static class ReglesVentilation
{
    private static decimal Arrondir(decimal v, int precision) => Math.Round(v, precision, MidpointRounding.AwayFromZero);

    public static Ventilation Ventiler(IReadOnlyList<LigneVentilee> lignes, decimal? periode, decimal? cumul, int precision = 2)
    {
        var erreurs = new List<string>();
        if (lignes.Count == 0) return new([], 0, ["VENT_SANS_LIGNE"]);
        var totalPrec = lignes.Sum(l => l.Precedent);
        var p = Arrondir(cumul is { } c ? c - totalPrec : periode ?? 0, precision);
        var bases = lignes.Select(l => Math.Abs(p < 0 ? l.Precedent : l.Marche - l.Precedent)).ToList();
        var total = bases.Sum();
        if (total == 0 && p != 0) return new([], p, [p < 0 ? "VENT_SANS_LIGNE" : "VENT_SANS_RESTE"]);
        if (p >= 0 && p > total) erreurs.Add("VENT_DEPASSEMENT");
        var max = 0;
        for (var i = 1; i < bases.Count; i++) if (bases[i] > bases[max]) max = i;
        var parts = bases.Select(b => total == 0 ? 0m : Arrondir(p * b / total, precision)).ToList();
        parts[max] = p - parts.Where((_, i) => i != max).Sum();
        return new(lignes.Select((l, i) => new PartVentilee(l.Id, parts[i], l.Precedent + parts[i])).ToList(), p, erreurs);
    }
}
