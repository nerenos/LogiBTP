namespace LogiBTP.Calendrier;

/// <summary>Règle de jour fermé : DATE, ANNUEL (mois, jour), NIEME (mois, jour de la semaine, rang), DERNIER (mois, jour de la semaine), PAQUES (décalage), PERIODE (du, au).</summary>
public sealed record RegleFerme(string Regle, string Libelle = "", DateOnly? Date = null, int? Mois = null, int? Jour = null, int? Rang = null,
    int? Decalage = null, DateOnly? Du = null, DateOnly? Au = null, bool Actif = true);

/// <summary>Jour fermé d'une période et ses libellés (dans l'ordre des règles).</summary>
public sealed record JourFerme(DateOnly Date, List<string> Libelles);

/// <summary>Plage travaillée : semaine du cycle (1 à N), jour ISO (1 lundi … 7 dimanche), minutes depuis minuit, période facultative.</summary>
public sealed record Plage(int Jour, int Debut, int Fin, int Semaine = 1, DateOnly? Du = null, DateOnly? Au = null);

/// <summary>Calendrier de travail : cycle de N semaines depuis la semaine de la date de référence, plages.</summary>
public sealed record CalendrierTravail(int CycleSemaines, DateOnly? Reference, IReadOnlyList<Plage> Plages);

public sealed record Intervalle(int Debut, int Fin);

/// <summary>Journée d'un calendrier : libellés du jour fermé (null : ouvert), plages, minutes travaillées.</summary>
public sealed record Journee(DateOnly Date, List<string>? Fermee, List<Intervalle> Plages, int Minutes);

/// <summary>Instant local (date et minutes depuis minuit ; 1440 = fin de journée), écrit « AAAA-MM-JJTHH:MM ».</summary>
public readonly record struct Instant(DateOnly Date, int Minute)
{
    public static Instant Lire(string i) => new(DateOnly.ParseExact(i[..10], "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
        int.Parse(i.Substring(11, 2), System.Globalization.CultureInfo.InvariantCulture) * 60 + int.Parse(i.Substring(14, 2), System.Globalization.CultureInfo.InvariantCulture));

    public override string ToString() => $"{Date:yyyy-MM-dd}T{Minute / 60:00}:{Minute % 60:00}";

    public static bool operator <(Instant a, Instant b) => a.Date < b.Date || (a.Date == b.Date && a.Minute < b.Minute);
    public static bool operator >(Instant a, Instant b) => b < a;
    public static bool operator <=(Instant a, Instant b) => !(b < a);
    public static bool operator >=(Instant a, Instant b) => !(a < b);
}

public sealed class ErreurCalendrier(string code) : Exception(ReglesCalendrier.Messages[code])
{
    public string Code { get; } = code;
}

/// <summary>
/// Calendriers de travail et jours fermés, répliqués dans calendrier.js (jeux modules/calendrier/tests/cas) : Pâques,
/// règles de jours fermés, semaine du cycle, plages d'un jour (plages datées prioritaires), temps de travail.
/// </summary>
public static class ReglesCalendrier
{
    public const int CycleMax = 8;
    public const int HorizonJours = 3660;

    public static int JourSemaine(DateOnly d) => ((int)d.DayOfWeek + 6) % 7 + 1;

    /// <summary>Dimanche de Pâques (grégorien, Meeus / Jones / Butcher).</summary>
    public static DateOnly Paques(int annee)
    {
        int a = annee % 19, b = annee / 100, c = annee % 100, d = b / 4, e = b % 4, f = (b + 8) / 25, g = (b - f + 1) / 3;
        int h = (19 * a + b - d - g + 15) % 30, i = c / 4, k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = (a + 11 * h + 22 * l) / 451;
        return new DateOnly(annee, (h + l - 7 * m + 114) / 31, (h + l - 7 * m + 114) % 31 + 1);
    }

    public static List<DateOnly> DatesRegle(RegleFerme r, int annee) => r.Regle switch
    {
        "DATE" => r.Date is { } d && d.Year == annee ? [d] : [],
        "ANNUEL" => r.Mois is int m && r.Jour is int j && j <= DateTime.DaysInMonth(annee, m) ? [new DateOnly(annee, m, j)] : [],
        "NIEME" => Nieme(r, annee),
        "DERNIER" => Dernier(r, annee),
        "PAQUES" => Paques(annee).AddDays(r.Decalage ?? 0) is var p && p.Year == annee ? [p] : [],
        "PERIODE" => Periode(r, annee),
        _ => [],
    };

    private static List<DateOnly> Nieme(RegleFerme r, int annee)
    {
        if (r.Mois is not int m || r.Jour is not int js || r.Rang is not int rang) return [];
        var j = 1 + ((js - JourSemaine(new DateOnly(annee, m, 1)) + 7) % 7) + (rang - 1) * 7;
        return j <= DateTime.DaysInMonth(annee, m) ? [new DateOnly(annee, m, j)] : [];
    }

    private static List<DateOnly> Dernier(RegleFerme r, int annee)
    {
        if (r.Mois is not int m || r.Jour is not int js) return [];
        var n = DateTime.DaysInMonth(annee, m);
        return [new DateOnly(annee, m, n - ((JourSemaine(new DateOnly(annee, m, n)) - js + 7) % 7))];
    }

    private static List<DateOnly> Periode(RegleFerme r, int annee)
    {
        if (r.Du is not { } du || r.Au is not { } au) return [];
        var de = Math.Max(du.DayNumber, new DateOnly(annee, 1, 1).DayNumber);
        var a = Math.Min(au.DayNumber, new DateOnly(annee, 12, 31).DayNumber);
        var res = new List<DateOnly>();
        for (var n = de; n <= a; n++) res.Add(DateOnly.FromDayNumber(n));
        return res;
    }

    /// <summary>Jours fermés de [du, au], triés, libellés dans l'ordre des règles et sans doublon ; règles inactives ignorées.</summary>
    public static List<JourFerme> JoursFermes(IEnumerable<RegleFerme> regles, DateOnly du, DateOnly au)
    {
        var res = new SortedDictionary<DateOnly, List<string>>();
        var actives = regles.Where(r => r.Actif).ToList();
        for (var annee = du.Year; annee <= au.Year; annee++)
        {
            foreach (var r in actives)
            {
                foreach (var d in DatesRegle(r, annee).Where(d => d >= du && d <= au))
                {
                    if (!res.TryGetValue(d, out var l)) res[d] = l = [];
                    if (!l.Contains(r.Libelle)) l.Add(r.Libelle);
                }
            }
        }
        return res.Select(x => new JourFerme(x.Key, x.Value)).ToList();
    }

    public static int SemaineDuCycle(CalendrierTravail c, DateOnly d)
    {
        if (c.CycleSemaines <= 1 || c.Reference is not { } reference) return 1;
        static int Lundi(DateOnly x) => x.DayNumber - (JourSemaine(x) - 1);
        var w = (int)Math.Floor((Lundi(d) - Lundi(reference)) / 7.0);
        return ((w % c.CycleSemaines) + c.CycleSemaines) % c.CycleSemaines + 1;
    }

    private static bool Couvre(Plage p, DateOnly d) => (p.Du is null || p.Du <= d) && (p.Au is null || d <= p.Au);

    /// <summary>Plages d'une date : semaine du cycle et jour ; des plages datées couvrant la date remplacent les permanentes.</summary>
    public static List<Intervalle> PlagesDuJour(CalendrierTravail c, DateOnly d)
    {
        var s = SemaineDuCycle(c, d);
        var j = JourSemaine(d);
        var candidates = c.Plages.Where(p => p.Semaine == s && p.Jour == j).ToList();
        var datees = candidates.Where(p => (p.Du is not null || p.Au is not null) && Couvre(p, d)).ToList();
        var retenues = datees.Count > 0 ? datees : candidates.Where(p => p.Du is null && p.Au is null).ToList();
        return retenues.Select(p => new Intervalle(p.Debut, p.Fin)).OrderBy(p => p.Debut).ToList();
    }

    public static Journee Journee(CalendrierTravail c, IReadOnlyList<JourFerme> fermes, DateOnly d)
    {
        var f = fermes.FirstOrDefault(x => x.Date == d);
        var plages = f is null ? PlagesDuJour(c, d) : [];
        return new Journee(d, f?.Libelles, plages, plages.Sum(p => p.Fin - p.Debut));
    }

    public static List<Journee> Journees(CalendrierTravail c, IReadOnlyList<JourFerme> fermes, DateOnly du, DateOnly au)
    {
        var res = new List<Journee>();
        for (var n = du.DayNumber; n <= au.DayNumber; n++) res.Add(Journee(c, fermes, DateOnly.FromDayNumber(n)));
        return res;
    }

    /// <summary>Fin d'un travail de <paramref name="minutes"/> commencé à <paramref name="debut"/> en suivant les plages.</summary>
    public static Instant AjouterMinutesTravail(CalendrierTravail c, IReadOnlyList<JourFerme> fermes, Instant debut, int minutes)
    {
        if (minutes <= 0) return debut;
        var reste = minutes;
        for (var k = 0; k <= HorizonJours; k++)
        {
            var d = debut.Date.AddDays(k);
            foreach (var p in Journee(c, fermes, d).Plages)
            {
                var de = k == 0 ? Math.Max(p.Debut, debut.Minute) : p.Debut;
                if (de >= p.Fin) continue;
                if (p.Fin - de >= reste) return new Instant(d, de + reste);
                reste -= p.Fin - de;
            }
        }
        throw new ErreurCalendrier("CALENDRIER_VIDE");
    }

    /// <summary>Minutes travaillées entre deux instants (0 si fin ≤ début).</summary>
    public static int MinutesTravail(CalendrierTravail c, IReadOnlyList<JourFerme> fermes, Instant debut, Instant fin)
    {
        if (fin <= debut) return 0;
        var total = 0;
        for (var n = debut.Date.DayNumber; n <= fin.Date.DayNumber; n++)
        {
            var d = DateOnly.FromDayNumber(n);
            var bas = d == debut.Date ? debut.Minute : 0;
            var haut = d == fin.Date ? fin.Minute : 1440;
            foreach (var p in Journee(c, fermes, d).Plages) total += Math.Max(0, Math.Min(p.Fin, haut) - Math.Max(p.Debut, bas));
        }
        return total;
    }

    /// <summary>Premier instant travaillé à partir de <paramref name="i"/>.</summary>
    public static Instant ProchainTravail(CalendrierTravail c, IReadOnlyList<JourFerme> fermes, Instant i)
    {
        for (var k = 0; k <= HorizonJours; k++)
        {
            var d = i.Date.AddDays(k);
            foreach (var p in Journee(c, fermes, d).Plages)
            {
                var de = k == 0 ? Math.Max(p.Debut, i.Minute) : p.Debut;
                if (de < p.Fin) return new Instant(d, de);
            }
        }
        throw new ErreurCalendrier("CALENDRIER_VIDE");
    }

    public static List<string> ControlerCalendrier(CalendrierTravail c)
    {
        var e = new SortedSet<string>(StringComparer.Ordinal);
        var n = c.CycleSemaines;
        if (n < 1 || n > CycleMax) e.Add("CAL_CYCLE");
        if (n > 1 && c.Reference is null) e.Add("CAL_REFERENCE");
        foreach (var p in c.Plages)
        {
            if (p.Jour is < 1 or > 7) e.Add("PLG_JOUR");
            if (p.Semaine < 1 || p.Semaine > n) e.Add("PLG_SEMAINE");
            if (!(p.Debut >= 0 && p.Fin <= 1440 && p.Debut < p.Fin)) e.Add("PLG_HEURES");
            if (p.Du is { } du && p.Au is { } au && au < du) e.Add("PLG_PERIODE");
        }
        for (var i = 0; i < c.Plages.Count; i++)
        {
            for (var k = i + 1; k < c.Plages.Count; k++)
            {
                var (a, b) = (c.Plages[i], c.Plages[k]);
                if (a.Semaine == b.Semaine && a.Jour == b.Jour && a.Du == b.Du && a.Au == b.Au && a.Debut < b.Fin && b.Debut < a.Fin) e.Add("PLG_CHEVAUCHEMENT");
            }
        }
        return [.. e];
    }

    public static List<string> ControlerRegle(RegleFerme r)
    {
        var e = new List<string>();
        void Mois() { if (r.Mois is not (>= 1 and <= 12)) e.Add("FER_MOIS"); }
        void Semaine() { if (r.Jour is not (>= 1 and <= 7)) e.Add("FER_JOUR"); }
        switch (r.Regle)
        {
            case "DATE": if (r.Date is null) e.Add("FER_DATE"); break;
            case "ANNUEL":
                Mois();
                if (r.Jour is not (>= 1 and <= 31) || (r.Mois is >= 1 and <= 12 && r.Jour > DateTime.DaysInMonth(2024, r.Mois.Value))) e.Add("FER_JOUR");
                break;
            case "NIEME": Mois(); Semaine(); if (r.Rang is not (>= 1 and <= 5)) e.Add("FER_RANG"); break;
            case "DERNIER": Mois(); Semaine(); break;
            case "PAQUES": break;
            case "PERIODE": if (r.Du is null || r.Au is null || r.Au < r.Du) e.Add("FER_PERIODE"); break;
            default: e.Add("FER_REGLE"); break;
        }
        e.Sort(StringComparer.Ordinal);
        return e;
    }

    public static readonly IReadOnlyDictionary<string, string> Messages = new Dictionary<string, string>
    {
        ["CAL_CYCLE"] = $"Cycle de 1 à {CycleMax} semaines",
        ["CAL_REFERENCE"] = "Date de référence obligatoire pour un cycle de plusieurs semaines",
        ["PLG_JOUR"] = "Jour de la semaine de 1 (lundi) à 7 (dimanche)",
        ["PLG_SEMAINE"] = "Semaine du cycle inexistante",
        ["PLG_HEURES"] = "Plage horaire : début avant la fin, entre 0 h et 24 h",
        ["PLG_PERIODE"] = "Période de la plage : fin avant le début",
        ["PLG_CHEVAUCHEMENT"] = "Plages horaires qui se chevauchent",
        ["FER_REGLE"] = "Règle de jour fermé inconnue",
        ["FER_DATE"] = "Date obligatoire",
        ["FER_MOIS"] = "Mois de 1 à 12",
        ["FER_JOUR"] = "Jour invalide",
        ["FER_RANG"] = "Rang de 1 à 5",
        ["FER_PERIODE"] = "Période : début et fin obligatoires, fin après le début",
        ["CALENDRIER_VIDE"] = "Aucun temps de travail dans le calendrier",
    };
}
