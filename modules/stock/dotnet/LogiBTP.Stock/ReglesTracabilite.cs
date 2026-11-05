using System.Text.RegularExpressions;

namespace LogiBTP.Stock;

/// <summary>Lot saisi sur une ligne : numéro et quantité en unité de stock (texte lu tel quel : null ou illisible = erreur).</summary>
public sealed record LotReparti(string? Numero, decimal? Quantite);

public sealed record PartLot(string Numero, decimal Quantite);

public sealed record ErreurTracabilite(string Code, int? Index);

public sealed record RepartitionLots(List<PartLot> Parts, decimal SansLot, List<ErreurTracabilite> Erreurs, List<string> Avertissements);

/// <summary>Mouvement ou ligne de comptage d'un article dans un lieu, avec son lot (null = sans lot).</summary>
public sealed record QuantiteLot(string Date, decimal Quantite, long? Lot);

public sealed record StockLot(long? Lot, decimal Quantite);

/// <summary>Lot en stock dans un lieu, candidat à une sortie : date limite et date d'entrée (« AAAA-MM-JJ »).</summary>
public sealed record LotEnStock(long Lot, string Numero, decimal Quantite, string? Limite, string? Entree);

public sealed record LotPropose(long Lot, string Numero, decimal Quantite);

public sealed record PropositionLots(List<LotPropose> Parts, decimal Reste);

/// <summary>Péremption d'un article (S24.7) : périssable, durée théorique et son unité (J ou M).</summary>
public sealed record PeremptionArticle(bool Perissable, int? Duree, string Unite);

/// <summary>
/// Lots et numéros de série (ANALYSE-MODULE-STOCK.md § 11, S24), répliqué dans tracabilite.js (jeu
/// modules/stock/tests/cas/05_tracabilite.json) : répartition facultative d'une ligne entre ses lots (S24.2, le reste est
/// « sans lot »), date limite proposée d'un lot d'article périssable (S24.7), stock par lot à une date-heure (dernier
/// comptage de l'article, toutes ses lignes de la même minute par lot, puis mouvements postérieurs par lot).
/// </summary>
public static partial class ReglesTracabilite
{
    public static readonly Dictionary<string, string> Messages = new()
    {
        ["TRA_NUMERO_VIDE"] = "Lot sans numéro",
        ["TRA_QUANTITE"] = "Quantité du lot nulle, négative ou illisible",
        ["TRA_DOUBLON"] = "Même numéro de lot deux fois sur la ligne",
        ["TRA_DEPASSE"] = "Les lots dépassent la quantité de la ligne",
        ["TRA_SERIE_UNITE"] = "Un numéro de série vaut une unité",
        ["TRA_INCOMPLET"] = "Une partie de la quantité reste sans lot",
    };

    [GeneratedRegex(@"\s+")] private static partial Regex Espaces();

    /// <summary>Numéro de lot normalisé (espaces de tête et de fin retirés, intérieurs réduits) ; null s'il est vide.</summary>
    public static string? Numero(string? numero) => string.IsNullOrWhiteSpace(numero) ? null : Espaces().Replace(numero.Trim(), " ");

    public static RepartitionLots Repartir(decimal quantite, IReadOnlyList<LotReparti> lots, string suivi)
    {
        var total = Math.Abs(quantite);
        var parts = new List<PartLot>();
        var erreurs = new List<ErreurTracabilite>();
        var vus = new HashSet<string>();
        var reparti = 0m;
        for (var i = 0; i < lots.Count; i++)
        {
            var numero = Numero(lots[i].Numero);
            var q = lots[i].Quantite;
            if (numero is null) { erreurs.Add(new("TRA_NUMERO_VIDE", i)); continue; }
            if (q is not { } qv || qv <= 0) { erreurs.Add(new("TRA_QUANTITE", i)); continue; }
            if (!vus.Add(numero.ToUpperInvariant())) { erreurs.Add(new("TRA_DOUBLON", i)); continue; }
            if (suivi == SuiviArticle.Serie && qv != 1) erreurs.Add(new("TRA_SERIE_UNITE", i));
            reparti += qv;
            parts.Add(new(numero, qv));
        }
        if (reparti > total) erreurs.Add(new("TRA_DEPASSE", null));
        var sansLot = reparti > total ? 0m : total - reparti;
        var avertissements = suivi != SuiviArticle.Aucun && sansLot > 0 ? new List<string> { "TRA_INCOMPLET" } : [];
        return new(parts, sansLot, erreurs, avertissements);
    }

    /// <summary>Date limite proposée : article périssable avec une durée, fabrication sinon réception + durée (jours ou mois) ; sinon null.</summary>
    public static DateOnly? DateLimite(PeremptionArticle a, DateOnly? fabrication, DateOnly? reception)
    {
        if (!a.Perissable || a.Duree is not int n || (fabrication ?? reception) is not DateOnly b) return null;
        return a.Unite == UniteDuree.Jours ? b.AddDays(n) : b.AddMonths(n);
    }

    /// <summary>Stock par lot à la date-heure t : lots non nuls, par identifiant croissant, puis le sans lot.</summary>
    public static List<StockLot> StockParLot(IReadOnlyList<QuantiteLot> mouvements, IReadOnlyList<QuantiteLot> comptages, string t)
    {
        var fin = ReglesStock.Minute(t)!;
        string? depuis = null;
        foreach (var c in comptages)
        {
            var d = ReglesStock.Minute(c.Date)!;
            if (string.CompareOrdinal(d, fin) <= 0 && (depuis is null || string.CompareOrdinal(d, depuis) > 0)) depuis = d;
        }
        var q = new Dictionary<long, decimal>();
        var sans = 0m;
        void Ajouter(long? lot, decimal v)
        {
            if (lot is long l) q[l] = q.GetValueOrDefault(l) + v;
            else sans += v;
        }
        if (depuis is not null) foreach (var c in comptages.Where(c => ReglesStock.Minute(c.Date) == depuis)) Ajouter(c.Lot, c.Quantite);
        foreach (var m in mouvements)
        {
            var d = ReglesStock.Minute(m.Date)!;
            if (string.CompareOrdinal(d, fin) <= 0 && (depuis is null || string.CompareOrdinal(d, depuis) > 0)) Ajouter(m.Lot, m.Quantite);
        }
        var res = q.Where(x => x.Value != 0).OrderBy(x => x.Key).Select(x => new StockLot(x.Key, x.Value)).ToList();
        if (sans != 0) res.Add(new(null, sans));
        return res;
    }

    /// <summary>
    /// Lots proposés pour une sortie (S24.2) : FEFO pour un article périssable (date limite croissante, sans date en dernier,
    /// périmés écartés), sinon FIFO (date d'entrée), puis par identifiant ; le reste non couvert est rendu.
    /// </summary>
    public static PropositionLots ProposerLots(decimal quantite, IReadOnlyList<LotEnStock> lots, bool perissable, string? aujourdhui)
    {
        var reste = Math.Abs(quantite);
        string Cle(LotEnStock x) => string.Join("|", perissable ? x.Limite ?? "9999-12-31" : "", x.Entree ?? "", x.Lot.ToString("D20"));
        var candidats = lots.Where(x => x.Quantite > 0 && !(perissable && x.Limite is not null && aujourdhui is not null && string.CompareOrdinal(x.Limite, aujourdhui) < 0))
            .OrderBy(Cle, StringComparer.Ordinal).ToList();
        var parts = new List<LotPropose>();
        foreach (var x in candidats)
        {
            if (reste <= 0) break;
            var q = Math.Min(x.Quantite, reste);
            parts.Add(new(x.Lot, x.Numero, q));
            reste -= q;
        }
        return new(parts, reste);
    }
}
