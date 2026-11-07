namespace LogiBTP.Stock;

/// <summary>Mouvement valorisable : prix (entrée valorisée), provisoire (réception non facturée).</summary>
public sealed record MouvementValorise(long Id, long Lieu, string Date, decimal Quantite, decimal? Prix = null, bool Provisoire = false);

public sealed record ComptageLieu(long Lieu, string Date, decimal Quantite, decimal? Prix = null);

public sealed record Reevaluation(string Date, decimal Pmp);

public sealed record PmpMouvement(long Id, decimal? Pmp);

public sealed record Valorisation(decimal? Pmp, decimal? DernierPa, long? DernierPaId, string? DernierPaDate, bool Provisoire, decimal Quantite,
    List<PmpMouvement> Historique);

public sealed record ValeurUnitaire(decimal? Valeur, string? Source, bool Provisoire);

public sealed record ValeurLieu(long Lieu, decimal Quantite, decimal? Valeur, decimal? ValeurInventaire);

/// <summary>Stock valorisé d'un article à une date, tous lieux : valeur unitaire, valeur d'inventaire (prix du dernier comptage chiffré) à part.</summary>
public sealed record EtatValorise(decimal? ValeurUnitaire, string? Source, bool Provisoire, decimal? PrixInventaire, decimal Quantite, decimal? Valeur,
    decimal? ValeurInventaire, List<ValeurLieu> Lieux);

/// <summary>
/// Valorisation d'un article (ANALYSE-MODULE-STOCK.md S4, S29, S31), répliquée dans valorisation.js (jeu
/// modules/stock/tests/cas/02_prix.json) : événements de tous les lieux rejoués dans l'ordre des dates-heures à la minute
/// (mouvements, puis comptages, puis réévaluations à minute égale) ; entrée valorisée = PMP pondéré par le stock total
/// (le prix si ce stock était nul ou négatif, 6 décimales) et dernier prix d'achat ; comptage = quantité du lieu
/// remplacée ; réévaluation = PMP saisi.
/// </summary>
public static class ReglesValorisation
{
    public static readonly string[] Methodes = ["PMP", "DERNIER_PA"];

    private static decimal Arrondir(decimal v, int precision) => Math.Round(v, precision, MidpointRounding.AwayFromZero);

    public static Valorisation Valoriser(IReadOnlyList<MouvementValorise> mouvements, IReadOnlyList<ComptageLieu> comptages,
        IReadOnlyList<Reevaluation> reevaluations, string? date = null)
    {
        var fin = ReglesStock.Minute(date);
        var evenements = mouvements.Select((m, i) => (D: ReglesStock.Minute(m.Date)!, Rang: 0, I: i))
            .Concat(comptages.Select((c, i) => (D: ReglesStock.Minute(c.Date)!, Rang: 1, I: i)))
            .Concat(reevaluations.Select((r, i) => (D: ReglesStock.Minute(r.Date)!, Rang: 2, I: i)))
            .Where(e => fin is null || string.CompareOrdinal(e.D, fin) <= 0)
            .OrderBy(e => e.D, StringComparer.Ordinal).ThenBy(e => e.Rang).ThenBy(e => e.I).ToList();
        var quantites = new Dictionary<long, decimal>();
        decimal? pmp = null;
        MouvementValorise? dernier = null;
        var historique = new List<PmpMouvement>();
        foreach (var e in evenements)
        {
            switch (e.Rang)
            {
                case 0:
                    var m = mouvements[e.I];
                    if (m.Prix is { } prix && m.Quantite > 0)
                    {
                        var t = quantites.Values.Sum();
                        pmp = pmp is null || t <= 0 ? prix : Arrondir((t * pmp.Value + m.Quantite * prix) / (t + m.Quantite), 6);
                        dernier = m;
                    }
                    quantites[m.Lieu] = quantites.GetValueOrDefault(m.Lieu) + m.Quantite;
                    historique.Add(new(m.Id, pmp));
                    break;
                case 1:
                    quantites[comptages[e.I].Lieu] = comptages[e.I].Quantite;
                    break;
                default:
                    pmp = reevaluations[e.I].Pmp;
                    break;
            }
        }
        return new(pmp, dernier?.Prix, dernier?.Id, dernier is null ? null : ReglesStock.Minute(dernier.Date), dernier?.Provisoire ?? false,
            quantites.Values.Sum(), historique);
    }

    /// <summary>Valeur unitaire selon la méthode de la société ; sans valeur : repli (PA de la bibliothèque), signalé.</summary>
    public static ValeurUnitaire Valeur(Valorisation v, string methode, decimal? repli = null)
    {
        var dernierPa = methode == "DERNIER_PA";
        if ((dernierPa ? v.DernierPa : v.Pmp) is { } x) return new(x, dernierPa ? "DERNIER_PA" : "PMP", dernierPa && v.Provisoire);
        return new(repli, repli is null ? null : "REPLI", false);
    }

    private const string FinDesTemps = "9999-12-31T23:59";

    /// <summary>
    /// Stock valorisé d'un article à une date, tous lieux (répliqué dans valoriserEtat, jeu 06_valorisation_date.json) : quantité de chaque
    /// lieu ayant un événement jusqu'à la date (ReglesStock.StockA), valeur unitaire de la méthode à la date (repli signalé), valeur d'un
    /// lieu = quantité × valeur unitaire arrondie à 2 décimales, valeur d'inventaire (S30) = prix du dernier comptage chiffré à la date
    /// (le dernier de la liste à date égale) × quantité du lieu ; lieux par identifiant croissant, totaux = sommes des lieux.
    /// </summary>
    public static EtatValorise ValoriserEtat(IReadOnlyList<MouvementValorise> mouvements, IReadOnlyList<ComptageLieu> comptages,
        IReadOnlyList<Reevaluation> reevaluations, string? date, string methode, decimal? repli)
    {
        var fin = ReglesStock.Minute(date) ?? FinDesTemps;
        var u = Valeur(Valoriser(mouvements, comptages, reevaluations, date), methode, repli);
        ComptageLieu? chiffre = null;
        foreach (var c in comptages)
            if (c.Prix is not null && string.CompareOrdinal(ReglesStock.Minute(c.Date), fin) <= 0
                && (chiffre is null || string.CompareOrdinal(ReglesStock.Minute(c.Date), ReglesStock.Minute(chiffre.Date)) >= 0)) chiffre = c;
        var prixInventaire = chiffre?.Prix;
        var ids = mouvements.Where(m => string.CompareOrdinal(ReglesStock.Minute(m.Date), fin) <= 0).Select(m => m.Lieu)
            .Concat(comptages.Where(c => string.CompareOrdinal(ReglesStock.Minute(c.Date), fin) <= 0).Select(c => c.Lieu)).Distinct().OrderBy(l => l).ToList();
        decimal quantite = 0;
        decimal? valeur = null, valeurInventaire = null;
        var lieux = new List<ValeurLieu>();
        foreach (var id in ids)
        {
            var q = ReglesStock.StockA(mouvements.Where(m => m.Lieu == id).Select(m => new MouvementQuantite(m.Date, m.Quantite)).ToList(),
                comptages.Where(c => c.Lieu == id).Select(c => new ComptageQuantite(c.Date, c.Quantite)).ToList(), fin).Quantite;
            decimal? v = u.Valeur is { } pu ? Arrondir(q * pu, 2) : null;
            decimal? vi = prixInventaire is { } pi ? Arrondir(q * pi, 2) : null;
            quantite += q;
            if (v is { } x) valeur = (valeur ?? 0) + x;
            if (vi is { } y) valeurInventaire = (valeurInventaire ?? 0) + y;
            lieux.Add(new ValeurLieu(id, q, v, vi));
        }
        return new EtatValorise(u.Valeur, u.Source, u.Provisoire, prixInventaire, quantite, valeur, valeurInventaire, lieux);
    }
}
