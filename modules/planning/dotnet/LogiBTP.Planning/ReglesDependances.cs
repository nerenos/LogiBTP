using System.Globalization;

namespace LogiBTP.Planning;

public sealed record Dependance(string De, string Vers, string Type, int Decalage = 0, string Unite = "CAL", string Mode = "FIXE");
public sealed record TacheDatee(string Cle, long Debut, long Fin, string? Parent = null);
public sealed record AlerteDependance(string Code, string? De = null, string? Vers = null, string? Tache = null, long? Minimum = null);
public sealed record Propagation(List<TacheDatee> Taches, List<AlerteDependance> Alertes);

/// <summary>
/// Dépendances et tâches liées, répliquées avec dependances.js (jeu modules/planning/tests/cas/03_dependances.json) :
/// début au plus tôt, contrôle (soi, type, doublon, cycle), ordre topologique, propagation FIXE en cascade, alertes.
/// </summary>
public static class ReglesDependances
{
    public static readonly IReadOnlyDictionary<string, string> Messages = new Dictionary<string, string>
    {
        ["DEP_SOI"] = "Une tâche ne peut pas dépendre d'elle-même",
        ["DEP_DOUBLON"] = "Dépendance en double entre les mêmes tâches",
        ["DEP_CYCLE"] = "Dépendances circulaires",
        ["DEP_TYPE"] = "Type ou unité de dépendance inconnus",
        ["DEP_VIOLEE"] = "La tâche démarre avant la fin de la dépendance",
        ["LIEE_HORS"] = "Tâche liée hors de la période de sa tâche principale",
    };

    public static long? DebutMinimum(Dependance dep, long deDebut, long deFin, IEnumerable<string> joursOuvres)
    {
        var b = dep.Type == "DD" ? deDebut : deFin;
        if (dep.Unite != "OUV" || dep.Decalage == 0) return b + dep.Decalage * 1440L;
        var jour = Temps.DateDe(b).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var suivants = joursOuvres.Where(d => string.CompareOrdinal(d, jour) > 0).Order(StringComparer.Ordinal).ToList();
        return suivants.Count >= dep.Decalage ? Temps.VersMinutes(suivants[dep.Decalage - 1]) : null;
    }

    public static List<string> Controler(IReadOnlyList<Dependance> deps)
    {
        var r = new List<string>();
        if (deps.Any(d => d.De == d.Vers)) r.Add("DEP_SOI");
        if (deps.Any(d => d.Type is not ("FD" or "DD") || d.Unite is not ("CAL" or "OUV") || d.Mode is not ("FIXE" or "ALERTE"))) r.Add("DEP_TYPE");
        if (deps.Select(d => $"{d.De}>{d.Vers}").Distinct().Count() != deps.Count) r.Add("DEP_DOUBLON");
        if (OrdreTopologique(deps) is null) r.Add("DEP_CYCLE");
        return r;
    }

    public static List<string>? OrdreTopologique(IReadOnlyList<Dependance> deps)
    {
        var noeuds = deps.SelectMany(d => new[] { d.De, d.Vers }).Distinct().Order(StringComparer.Ordinal).ToList();
        var entrees = noeuds.ToDictionary(n => n, _ => 0);
        foreach (var d in deps.Where(d => d.De != d.Vers)) entrees[d.Vers]++;
        var prets = noeuds.Where(n => entrees[n] == 0).ToList();
        var r = new List<string>();
        while (prets.Count > 0)
        {
            prets.Sort(StringComparer.Ordinal);
            var n = prets[0];
            prets.RemoveAt(0);
            r.Add(n);
            foreach (var d in deps.Where(x => x.De == n && x.De != x.Vers))
            {
                if (--entrees[d.Vers] == 0) prets.Add(d.Vers);
            }
        }
        return r.Count == noeuds.Count ? r : null;
    }

    public static Propagation Propager(IReadOnlyList<TacheDatee> taches, IReadOnlyList<Dependance> deps, IReadOnlyCollection<string> joursOuvres)
    {
        var parCle = taches.ToDictionary(t => t.Cle);
        var deplacees = new List<TacheDatee>();
        foreach (var n in OrdreTopologique(deps) ?? [])
        {
            if (!parCle.TryGetValue(n, out var t)) continue;
            long? min = null;
            foreach (var d in deps.Where(x => x.Vers == n && x.Mode == "FIXE"))
            {
                if (!parCle.TryGetValue(d.De, out var de)) continue;
                var m = DebutMinimum(d, de.Debut, de.Fin, joursOuvres);
                if (m is long v && (min is null || v > min)) min = v;
            }
            if (min is long debut && debut != t.Debut)
            {
                t = t with { Debut = debut, Fin = debut + (t.Fin - t.Debut) };
                parCle[n] = t;
                deplacees.Add(t);
            }
        }
        var alertes = new List<AlerteDependance>();
        foreach (var d in deps.Where(x => x.Mode == "ALERTE"))
        {
            if (!parCle.TryGetValue(d.De, out var de) || !parCle.TryGetValue(d.Vers, out var vers)) continue;
            if (DebutMinimum(d, de.Debut, de.Fin, joursOuvres) is long m && vers.Debut < m) alertes.Add(new AlerteDependance("DEP_VIOLEE", d.De, d.Vers, null, m));
        }
        foreach (var t in taches.Select(x => parCle[x.Cle]))
        {
            if (t.Parent is not null && parCle.TryGetValue(t.Parent, out var p) && (t.Debut < p.Debut || t.Fin > p.Fin)) alertes.Add(new AlerteDependance("LIEE_HORS", Tache: t.Cle));
        }
        return new Propagation(deplacees, alertes);
    }
}
