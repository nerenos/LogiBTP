namespace LogiBTP.Stock;

/// <summary>Mouvement d'un article dans un lieu : date-heure (« AAAA-MM-JJTHH:MM… ») et quantité signée en unité de stock.</summary>
public sealed record MouvementQuantite(string Date, decimal Quantite);

/// <summary>Quantité comptée à une date-heure (inventaire).</summary>
public sealed record ComptageQuantite(string Date, decimal Quantite);

public sealed record StockCalcule(decimal Quantite, string? Comptage);

public sealed record EcartComptage(decimal Avant, decimal Compte, decimal Ecart);

/// <summary>
/// Stock d'un article dans un lieu à une date-heure (ANALYSE-MODULE-STOCK.md § 3.1, S5), répliqué dans stock.js (jeu
/// modules/stock/tests/cas/01_stock.json) : dernier comptage de date-heure ≤ T, plus les mouvements datés après lui et
/// jusqu'à T ; dates-heures à la minute, un mouvement de la même minute qu'un comptage est réputé déjà compté.
/// </summary>
public static class ReglesStock
{
    /// <summary>Date-heure ramenée à la minute ; une date seule vaut minuit.</summary>
    public static string? Minute(string? date)
    {
        if (string.IsNullOrEmpty(date)) return null;
        var s = date.Replace(' ', 'T');
        return s.Length == 10 ? s + "T00:00" : s[..Math.Min(16, s.Length)];
    }

    /// <summary>Date-heure d'un horodatage, à la minute (heure UTC : celle de la base).</summary>
    public static string Minute(DateTimeOffset d) => d.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm");

    public static StockCalcule StockA(IReadOnlyList<MouvementQuantite> mouvements, IReadOnlyList<ComptageQuantite> comptages, string t,
        ComptageQuantite? exclure = null)
    {
        var fin = Minute(t)!;
        ComptageQuantite? base_ = null;
        foreach (var c in comptages)
        {
            if (ReferenceEquals(c, exclure)) continue;
            var d = Minute(c.Date)!;
            if (string.CompareOrdinal(d, fin) <= 0 && (base_ is null || string.CompareOrdinal(d, Minute(base_.Date)) >= 0)) base_ = c;
        }
        var depuis = base_ is null ? null : Minute(base_.Date);
        var q = base_?.Quantite ?? 0m;
        foreach (var m in mouvements)
        {
            var d = Minute(m.Date)!;
            if (string.CompareOrdinal(d, fin) <= 0 && (depuis is null || string.CompareOrdinal(d, depuis) > 0)) q += m.Quantite;
        }
        return new(q, depuis);
    }

    /// <summary>Écart d'un comptage : quantité comptée − stock juste avant (ce comptage et ceux de la même minute écartés).</summary>
    public static EcartComptage Ecart(IReadOnlyList<MouvementQuantite> mouvements, IReadOnlyList<ComptageQuantite> comptages, ComptageQuantite comptage)
    {
        var d = Minute(comptage.Date)!;
        var autres = comptages.Where(c => !ReferenceEquals(c, comptage) && Minute(c.Date) != d).ToList();
        var avant = StockA(mouvements, autres, d).Quantite;
        return new(avant, comptage.Quantite, comptage.Quantite - avant);
    }
}
