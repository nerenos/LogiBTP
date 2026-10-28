namespace LogiBTP.Pointage;

/// <summary>Congé (dates « AAAA-MM-JJ » incluses ; demi-journée : commence l'après-midi, finit à midi).</summary>
public sealed record CongePeriode(long? Id, string? Du, string? Au, bool DebutMidi = false, bool FinMidi = false, string Etat = EtatConge.Demande);

/// <summary>Jour décompté d'un congé (1 ou 0,5).</summary>
public sealed record JourConge(string Date, decimal Part);

/// <summary>
/// Congés et absences, répliqués avec conges.js (jeu modules/pointage/tests/cas/04_conges.json) : contrôle d'une demande,
/// jours décomptés (jours travaillés seulement), traitements permis.
/// </summary>
public static class ReglesConges
{
    public static readonly IReadOnlyDictionary<string, string> Messages = new Dictionary<string, string>
    {
        ["CNG_DATES"] = "Dates du congé : début et fin obligatoires, la fin après le début",
        ["CNG_DEMI"] = "Un congé d'une seule journée ne peut pas commencer l'après-midi et finir à midi",
        ["CNG_CHEVAUCHEMENT"] = "Le salarié a déjà un congé demandé ou validé sur cette période",
        ["CNG_ETAT"] = "Ce congé n'est plus à traiter",
        ["CNG_NATURE"] = "La nature de l'absence est obligatoire pour valider",
    };

    private static int Jour(string d) => DateOnly.ParseExact(d, "yyyy-MM-dd").DayNumber;

    private static (int Debut, int Fin) DemiJournees(CongePeriode c) =>
        (Jour(c.Du!) * 2 + (c.DebutMidi ? 1 : 0), Jour(c.Au!) * 2 + (c.FinMidi ? 0 : 1));

    public static bool EnCours(CongePeriode c) => c.Etat is EtatConge.Demande or EtatConge.Valide;

    public static List<string> Controler(CongePeriode c, IEnumerable<CongePeriode> autres)
    {
        var r = new List<string>();
        if (string.IsNullOrEmpty(c.Du) || string.IsNullOrEmpty(c.Au) || string.CompareOrdinal(c.Au, c.Du) < 0) r.Add("CNG_DATES");
        else
        {
            if (c.Du == c.Au && c.DebutMidi && c.FinMidi) r.Add("CNG_DEMI");
            var (a, b) = DemiJournees(c);
            if (autres.Any(x => x.Id != c.Id && EnCours(x) && !string.IsNullOrEmpty(x.Du) && !string.IsNullOrEmpty(x.Au)
                && DemiJournees(x) is var (d, f) && d <= b && a <= f)) r.Add("CNG_CHEVAUCHEMENT");
        }
        r.Sort(StringComparer.Ordinal);
        return r;
    }

    public static List<JourConge> Jours(CongePeriode c, IEnumerable<string> joursTravailles)
    {
        var travailles = joursTravailles.ToHashSet(StringComparer.Ordinal);
        var r = new List<JourConge>();
        for (var n = Jour(c.Du!); n <= Jour(c.Au!); n++)
        {
            var date = DateOnly.FromDayNumber(n).ToString("yyyy-MM-dd");
            if (!travailles.Contains(date)) continue;
            var part = 1m - (date == c.Du && c.DebutMidi ? 0.5m : 0) - (date == c.Au && c.FinMidi ? 0.5m : 0);
            if (part > 0) r.Add(new JourConge(date, part));
        }
        return r;
    }

    public static decimal Total(IEnumerable<JourConge> jours) => jours.Sum(j => j.Part);

    public static List<string> ControlerTraitement(string action, CongePeriode c, string? nature)
    {
        var r = new List<string>();
        if (action is "VALIDER" or "REFUSER")
        {
            if (c.Etat != EtatConge.Demande) r.Add("CNG_ETAT");
            if (action == "VALIDER" && string.IsNullOrEmpty(nature)) r.Add("CNG_NATURE");
        }
        else if (action == "ANNULER" && !EnCours(c)) r.Add("CNG_ETAT");
        r.Sort(StringComparer.Ordinal);
        return r;
    }
}
