using System.Globalization;

namespace LogiBTP.Planning;

/// <summary>Instants du planning en minutes depuis 1970 (heure locale lue comme UTC), comme temps.js.</summary>
public static class Temps
{
    private const int Jour1970 = 719162;

    public static long VersMinutes(string s)
    {
        var d = DateOnly.ParseExact(s[..10], "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var m = s.Length >= 16 ? int.Parse(s.Substring(11, 2), CultureInfo.InvariantCulture) * 60 + int.Parse(s.Substring(14, 2), CultureInfo.InvariantCulture) : 0;
        return VersMinutes(d) + m;
    }

    public static long VersMinutes(DateOnly d) => (long)(d.DayNumber - Jour1970) * 1440;
    public static long VersMinutes(DateTime d) => VersMinutes(DateOnly.FromDateTime(d)) + d.Hour * 60 + d.Minute;
    public static DateOnly DateDe(long m) => DateOnly.FromDayNumber((int)Math.Floor(m / 1440d) + Jour1970);
    public static DateTime DateHeureDe(long m) => DateDe(m).ToDateTime(TimeOnly.MinValue).AddMinutes(m - VersMinutes(DateDe(m)));
    public static string Ecrire(long m) => DateHeureDe(m).ToString("yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture);
}

public sealed record RessourceCalcul(string Cle, IReadOnlyList<(long Debut, long Fin)> Plages, bool Capacite = true);
public sealed record AbsenceCalcul(string Ressource, long Debut, long Fin);
public sealed record TacheCalcul(int Mode, long Debut, long? Fin, int? Heures, IReadOnlyList<RessourceCalcul> Ressources,
    IReadOnlyList<AbsenceCalcul>? Absences = null, IReadOnlyList<(long Debut, long Fin)>? PlagesDefaut = null, int NbRessources = 1);
public sealed record VentilationJour(string Date, int Minutes);
public sealed record ResultatCalcul(long Debut, long? Fin, int? Heures, Dictionary<string, int> ParRessource, List<VentilationJour>? Ventilation, List<string> Erreurs);

/// <summary>
/// Calcul d'une tâche, répliqué avec calcul.js (jeu modules/planning/tests/cas/01_calcul.json) : mode 1 (fin), 2
/// (heures), 3 (ventilation par jour) ; heures de travail cumulées des ressources à capacité, absences retirées.
/// </summary>
public static class ReglesPlanning
{
    public static readonly IReadOnlyDictionary<string, string> Messages = new Dictionary<string, string>
    {
        ["PLA_CALENDRIER"] = "Aucune plage travaillée suffisante : vérifier les calendriers et les absences",
        ["PLA_FIN"] = "La fin précède le début",
        ["PLA_HEURES"] = "Nombre d'heures invalide",
    };

    public static List<(long Debut, long Fin)> RetirerAbsences(IEnumerable<(long Debut, long Fin)> plages, IEnumerable<(long Debut, long Fin)> absences)
    {
        var r = plages.ToList();
        foreach (var a in absences)
        {
            var s = new List<(long, long)>();
            foreach (var (d, f) in r)
            {
                if (a.Fin <= d || a.Debut >= f)
                {
                    s.Add((d, f));
                    continue;
                }
                if (a.Debut > d) s.Add((d, a.Debut));
                if (a.Fin < f) s.Add((a.Fin, f));
            }
            r = s;
        }
        return r;
    }

    private sealed record Contributeur(string? Cle, int Poids, List<(long Debut, long Fin)> Plages);
    private sealed record Segment(long D, long F, List<int> Actifs);

    private static List<Contributeur> Contributeurs(TacheCalcul t)
    {
        var c = t.Ressources.Where(r => r.Capacite)
            .Select(r => new Contributeur(r.Cle, 1, RetirerAbsences(r.Plages, (t.Absences ?? []).Where(a => a.Ressource == r.Cle).Select(a => (a.Debut, a.Fin))))).ToList();
        return c.Count > 0 ? c : [new Contributeur(null, Math.Max(1, t.NbRessources), (t.PlagesDefaut ?? []).ToList())];
    }

    private static List<Segment> Segments(List<Contributeur> contrib, long debut, long fin = long.MaxValue)
    {
        var bornes = new HashSet<long> { debut };
        foreach (var c in contrib)
        {
            foreach (var (d, f) in c.Plages)
            {
                if (f > debut && d < fin)
                {
                    bornes.Add(Math.Max(d, debut));
                    bornes.Add(Math.Min(f, fin));
                }
            }
        }
        var t = bornes.Where(x => x <= fin).Order().ToList();
        var r = new List<Segment>();
        for (var i = 0; i + 1 < t.Count; i++)
        {
            var (d, f) = (t[i], t[i + 1]);
            var actifs = Enumerable.Range(0, contrib.Count).Where(k => contrib[k].Plages.Any(p => p.Debut <= d && p.Fin >= f)).ToList();
            if (actifs.Count > 0) r.Add(new Segment(d, f, actifs));
        }
        return r;
    }

    private static void Ajouter(Dictionary<string, int> o, string? cle, long v)
    {
        if (cle is not null && v != 0) o[cle] = o.GetValueOrDefault(cle) + (int)v;
    }

    public static ResultatCalcul Calculer(TacheCalcul t)
    {
        var contrib = Contributeurs(t);
        var par = new Dictionary<string, int>();
        int Poids(List<int> actifs) => actifs.Sum(k => contrib[k].Poids);
        if (t.Mode == 1)
        {
            if (t.Heures is not int heures || heures < 0) return new(t.Debut, null, t.Heures, [], null, ["PLA_HEURES"]);
            if (heures == 0) return new(t.Debut, t.Debut, 0, [], null, []);
            long reste = heures;
            foreach (var s in Segments(contrib, t.Debut))
            {
                var r = Poids(s.Actifs);
                var travail = (s.F - s.D) * r;
                if (travail >= reste)
                {
                    var duree = (reste + r - 1) / r;
                    foreach (var k in s.Actifs) Ajouter(par, contrib[k].Cle, duree * contrib[k].Poids);
                    return new(t.Debut, s.D + duree, heures, par, null, []);
                }
                reste -= travail;
                foreach (var k in s.Actifs) Ajouter(par, contrib[k].Cle, (s.F - s.D) * contrib[k].Poids);
            }
            return new(t.Debut, null, heures, [], null, ["PLA_CALENDRIER"]);
        }
        if (t.Fin is not long fin || fin < t.Debut) return new(t.Debut, t.Fin, t.Heures, [], null, ["PLA_FIN"]);
        var segs = Segments(contrib, t.Debut, fin);
        if (t.Mode == 2)
        {
            long h = 0;
            foreach (var s in segs)
            {
                h += (s.F - s.D) * Poids(s.Actifs);
                foreach (var k in s.Actifs) Ajouter(par, contrib[k].Cle, (s.F - s.D) * contrib[k].Poids);
            }
            return new(t.Debut, fin, (int)h, par, null, []);
        }
        if (t.Heures is not int h3 || h3 < 0) return new(t.Debut, fin, t.Heures, [], [], ["PLA_HEURES"]);
        var jours = new List<(string Date, long W)>();
        var parCle = new SortedDictionary<int, long>();
        long total = 0;
        foreach (var s in segs)
        {
            for (var d = s.D; d < s.F;)
            {
                var finJour = ((long)Math.Floor(d / 1440d) + 1) * 1440;
                var f = Math.Min(s.F, finJour);
                var w = (f - d) * Poids(s.Actifs);
                var date = Temps.DateDe(d).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                var i = jours.FindIndex(x => x.Date == date);
                if (i < 0) jours.Add((date, w));
                else jours[i] = (date, jours[i].W + w);
                foreach (var k in s.Actifs) parCle[k] = parCle.GetValueOrDefault(k) + (f - d) * contrib[k].Poids;
                total += w;
                d = f;
            }
        }
        if (total == 0) return new(t.Debut, fin, h3, [], [], h3 != 0 ? ["PLA_CALENDRIER"] : []);
        List<(T Cle, int V)> Repartir<T>(List<(T Cle, long W)> entrees)
        {
            var r = entrees.Select(e => (e.Cle, (int)(h3 * e.W / total))).ToList();
            var reste = h3 - r.Sum(x => x.Item2);
            if (reste != 0) r[^1] = (r[^1].Cle, r[^1].Item2 + reste);
            return r;
        }
        var ventilation = Repartir(jours.Select(j => (j.Date, j.W)).ToList()).Select(x => new VentilationJour(x.Cle, x.V)).ToList();
        foreach (var (k, v) in Repartir(parCle.Select(x => (x.Key, x.Value)).ToList())) Ajouter(par, contrib[k].Cle, v);
        return new(t.Debut, fin, h3, par, ventilation, []);
    }
}
