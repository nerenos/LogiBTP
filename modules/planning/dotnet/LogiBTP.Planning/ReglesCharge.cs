using System.Globalization;

namespace LogiBTP.Planning;

public sealed record RessourceCharge(string Cle, int? SrvId, IReadOnlyList<(long Debut, long Fin)> Plages, bool Capacite = true, decimal? Quantite = null);
public sealed record AffectationCharge(string Ressource, decimal? Quantite = null);
public sealed record TacheCharge(string Cle, int? SrvId, long Debut, long Fin, int Heures, IReadOnlyList<AffectationCharge> Affectations,
    IReadOnlyList<(long Debut, long Fin)>? PlagesService = null);
public sealed record ChargeService(int? SrvId, string Date, int Capacite, int Planifie, int Disponible);
public sealed record Surcharge(string Ressource, string Date, int Capacite, int Planifie, List<string> Taches);
public sealed record UsageMateriel(string Ressource, string Date, decimal Utilise, decimal? Stock);
public sealed record Charge(List<ChargeService> Services, List<Surcharge> Surcharges, List<UsageMateriel> Materiels);

/// <summary>
/// Charge par service et par jour, sur-occupation des ressources, unités des matériels par nombre ; répliqué avec
/// charge.js (jeu modules/planning/tests/cas/02_charge.json).
/// </summary>
public static class ReglesCharge
{
    private static string Date(long m) => Temps.DateDe(m).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static Dictionary<string, int> ParJour(IEnumerable<(long Debut, long Fin)> plages, long debut = long.MinValue, long fin = long.MaxValue)
    {
        var r = new Dictionary<string, int>();
        foreach (var (d0, f0) in plages)
        {
            var d = Math.Max(d0, debut);
            var f = Math.Min(f0, fin);
            while (d < f)
            {
                var finJour = ((long)Math.Floor(d / 1440d) + 1) * 1440;
                var g = Math.Min(f, finJour);
                var j = Date(d);
                r[j] = r.GetValueOrDefault(j) + (int)(g - d);
                d = g;
            }
        }
        return r;
    }

    private static void Ajouter<T>(Dictionary<string, T> m, string cle, T v) where T : struct, System.Numerics.INumber<T> => m[cle] = m.GetValueOrDefault(cle) + v;

    public static Charge Calculer(IReadOnlyCollection<string> jours, IReadOnlyList<RessourceCharge> ressources, IReadOnlyList<AbsenceCalcul> absences, IReadOnlyList<TacheCharge> taches)
    {
        var dates = jours.ToHashSet();
        var parCle = ressources.ToDictionary(r => r.Cle);
        var effectives = ressources.ToDictionary(r => r.Cle, r => ReglesPlanning.RetirerAbsences(r.Plages, absences.Where(a => a.Ressource == r.Cle).Select(a => (a.Debut, a.Fin))));
        var capacite = new Dictionary<string, int>();
        var capaciteRes = new Dictionary<string, int>();
        foreach (var r in ressources.Where(r => r.Capacite))
        {
            foreach (var (d, m) in ParJour(effectives[r.Cle]))
            {
                if (!dates.Contains(d)) continue;
                Ajouter(capacite, $"{r.SrvId ?? 0}|{d}", m);
                capaciteRes[$"{r.Cle}|{d}"] = m;
            }
        }
        var planifie = new Dictionary<string, int>();
        var planifieRes = new Dictionary<string, int>();
        var tachesRes = new Dictionary<string, List<string>>();
        var unites = new Dictionary<string, decimal>();
        foreach (var t in taches)
        {
            var capables = t.Affectations.Where(a => parCle.TryGetValue(a.Ressource, out var r) && r.Capacite).ToList();
            foreach (var a in t.Affectations)
            {
                if (!parCle.TryGetValue(a.Ressource, out var r) || r.Capacite || r.Quantite is null) continue;
                for (var j = (long)Math.Floor(t.Debut / 1440d); j * 1440 < t.Fin; j++)
                {
                    var d = Date(j * 1440);
                    if (dates.Contains(d)) Ajouter(unites, $"{r.Cle}|{d}", a.Quantite ?? 1);
                }
            }
            if (capables.Count == 0)
            {
                var v = ReglesPlanning.Calculer(new TacheCalcul(3, t.Debut, t.Fin, t.Heures, [], null, t.PlagesService ?? []));
                foreach (var x in v.Ventilation ?? [])
                {
                    if (x.Minutes != 0 && dates.Contains(x.Date)) Ajouter(planifie, $"{t.SrvId ?? 0}|{x.Date}", x.Minutes);
                }
                continue;
            }
            foreach (var a in capables)
            {
                var r = parCle[a.Ressource];
                foreach (var (d, m) in ParJour(effectives[r.Cle], t.Debut, t.Fin))
                {
                    if (!dates.Contains(d)) continue;
                    Ajouter(planifie, $"{r.SrvId ?? 0}|{d}", m);
                    Ajouter(planifieRes, $"{r.Cle}|{d}", m);
                    if (!tachesRes.TryGetValue($"{r.Cle}|{d}", out var l)) tachesRes[$"{r.Cle}|{d}"] = l = [];
                    l.Add(t.Cle);
                }
            }
        }
        var services = capacite.Keys.Union(planifie.Keys).Select(k => k.Split('|'))
            .OrderBy(k => int.Parse(k[0], CultureInfo.InvariantCulture)).ThenBy(k => k[1], StringComparer.Ordinal)
            .Select(k =>
            {
                var c = capacite.GetValueOrDefault($"{k[0]}|{k[1]}");
                var p = planifie.GetValueOrDefault($"{k[0]}|{k[1]}");
                var s = int.Parse(k[0], CultureInfo.InvariantCulture);
                return new ChargeService(s == 0 ? null : s, k[1], c, p, c - p);
            }).ToList();
        var surcharges = planifieRes.Where(x => x.Value > capaciteRes.GetValueOrDefault(x.Key)).OrderBy(x => x.Key, StringComparer.Ordinal)
            .Select(x =>
            {
                var i = x.Key.LastIndexOf('|');
                return new Surcharge(x.Key[..i], x.Key[(i + 1)..], capaciteRes.GetValueOrDefault(x.Key), x.Value, tachesRes[x.Key]);
            }).ToList();
        var materiels = unites.OrderBy(x => x.Key, StringComparer.Ordinal).Select(x =>
        {
            var i = x.Key.LastIndexOf('|');
            return new UsageMateriel(x.Key[..i], x.Key[(i + 1)..], x.Value, parCle[x.Key[..i]].Quantite);
        }).ToList();
        return new Charge(services, surcharges, materiels);
    }
}
