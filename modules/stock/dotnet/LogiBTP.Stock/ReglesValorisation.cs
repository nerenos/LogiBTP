namespace LogiBTP.Stock;

/// <summary>Mouvement valorisable : prix (entrée valorisée), provisoire (réception non facturée).</summary>
public sealed record MouvementValorise(long Id, long Lieu, string Date, decimal Quantite, decimal? Prix = null, bool Provisoire = false);

public sealed record ComptageLieu(long Lieu, string Date, decimal Quantite);

public sealed record Reevaluation(string Date, decimal Pmp);

public sealed record PmpMouvement(long Id, decimal? Pmp);

public sealed record Valorisation(decimal? Pmp, decimal? DernierPa, long? DernierPaId, string? DernierPaDate, bool Provisoire, decimal Quantite,
    List<PmpMouvement> Historique);

public sealed record ValeurUnitaire(decimal? Valeur, string? Source, bool Provisoire);

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
}
