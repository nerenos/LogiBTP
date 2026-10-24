namespace LogiBTP.Stock;

/// <summary>Événement prévu : ENTREE (reste à recevoir d'une commande) ou SORTIE (reste d'une réservation), quantité positive.</summary>
public sealed record EvenementPrevu(string Id, string Type, string Date, decimal Quantite);

public sealed record PointProjection(string Date, decimal Entrees, decimal Sorties, decimal Disponible);

public sealed record ReservationProjetee(string Id, string Date, decimal Demande, decimal Servi, decimal Manque, string? CouverteLe);

public sealed record MinimumProjete(string Date, decimal Disponible);

public sealed record Projection(List<PointProjection> Points, string? PremiereRupture, MinimumProjete Minimum, List<ReservationProjetee> Reservations, List<string> Retards);

public sealed record Proposition(decimal Quantite, decimal UnitesAchat);

/// <summary>
/// Projection du disponible d'un article dans un lieu et proposition de réapprovisionnement (ANALYSE-MODULE-STOCK.md
/// § 5.4, S13 à S15), répliquées dans projection.js (jeu modules/stock/tests/cas/04_projection.json) : retard compté
/// aujourd'hui, entrées avant sorties le même jour, réservation servie avec le disponible de son jour, manque couvert
/// le premier jour où le disponible redevient positif ; proposition = maxi (sinon mini) − disponible le plus bas, au
/// conditionnement supérieur.
/// </summary>
public static class ReglesProjection
{
    private static string Jour(string d) => d[..Math.Min(10, d.Length)];

    private sealed class Point(string date, decimal disponible)
    {
        public string Date = date;
        public decimal Entrees;
        public decimal Sorties;
        public decimal Disponible = disponible;
    }

    private sealed class Reservation(string id, string date, decimal demande, decimal servi)
    {
        public string Id = id, Date = date;
        public decimal Demande = demande, Servi = servi;
        public string? CouverteLe;
    }

    public static Projection Projeter(decimal stock, string aujourdhui, IReadOnlyList<EvenementPrevu> evenements)
    {
        var auj = Jour(aujourdhui);
        var retards = new List<string>();
        var evs = evenements.Select((e, i) =>
        {
            var d = Jour(e.Date);
            if (string.CompareOrdinal(d, auj) < 0) { retards.Add(e.Id); d = auj; }
            return (E: e, D: d, I: i);
        }).OrderBy(x => x.D, StringComparer.Ordinal).ThenBy(x => x.E.Type == "ENTREE" ? 0 : 1).ThenBy(x => x.I).ToList();
        var dispo = stock;
        var points = new List<Point>();
        var reservations = new List<Reservation>();
        var ouvertes = new List<Reservation>();
        string? premiere = dispo < 0 ? auj : null;
        var minimum = new MinimumProjete(auj, dispo);
        foreach (var (e, d, _) in evs)
        {
            var p = points.LastOrDefault();
            if (p is null || p.Date != d) { p = new Point(d, dispo); points.Add(p); }
            if (e.Type == "ENTREE")
            {
                dispo += e.Quantite;
                p.Entrees += e.Quantite;
            }
            else
            {
                var servi = dispo > 0 ? Math.Min(dispo, e.Quantite) : 0m;
                var r = new Reservation(e.Id, d, e.Quantite, servi);
                if (e.Quantite - servi == 0) r.CouverteLe = d; else ouvertes.Add(r);
                reservations.Add(r);
                dispo -= e.Quantite;
                p.Sorties += e.Quantite;
            }
            p.Disponible = dispo;
            if (dispo < 0 && premiere is null) premiere = d;
            if (dispo < minimum.Disponible) minimum = new MinimumProjete(d, dispo);
            if (dispo >= 0)
            {
                foreach (var r in ouvertes) r.CouverteLe = d;
                ouvertes.Clear();
            }
        }
        return new(points.Select(p => new PointProjection(p.Date, p.Entrees, p.Sorties, p.Disponible)).ToList(), premiere, minimum,
            reservations.Select(r => new ReservationProjetee(r.Id, r.Date, r.Demande, r.Servi, r.Demande - r.Servi, r.CouverteLe)).ToList(), retards);
    }

    /// <summary>Disponible le plus bas jusqu'à une date (incluse), stock présent compris.</summary>
    public static decimal MinimumJusqua(Projection p, decimal stock, string date)
    {
        var min = stock;
        foreach (var x in p.Points) if (string.CompareOrdinal(x.Date, Jour(date)) <= 0 && x.Disponible < min) min = x.Disponible;
        return min;
    }

    /// <summary>Proposition : sous le mini → maxi (sinon mini) − disponible, arrondi au conditionnement supérieur ; sinon null.</summary>
    public static Proposition? Proposer(decimal? mini, decimal? maxi, decimal disponible, decimal conditionnement = 1)
    {
        if (mini is not { } m || disponible >= m) return null;
        var besoin = (maxi ?? m) - disponible;
        if (besoin <= 0) return null;
        var unites = conditionnement > 0 ? Math.Ceiling(besoin / conditionnement) : Math.Ceiling(besoin);
        return new(conditionnement > 0 ? unites * conditionnement : unites, unites);
    }
}
