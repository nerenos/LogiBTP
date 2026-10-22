namespace LogiBTP.Pointage;

/// <summary>Paramètres de contrôle de la société (pas de saisie, amplitudes en minutes ; 0 = sans contrôle).</summary>
public sealed record ParametresControle(int PasMinutes = 15, int AmplitudeJour = 600, int AmplitudeSemaine = 2880);

/// <summary>Pointage à contrôler (durées et heures en minutes, date « AAAA-MM-JJ »).</summary>
public sealed record PointageControle(string? Cle, string Date, long? ChaId, string? TypeMo, int Minutes, int? Debut = null, int? Fin = null,
    bool NonConformite = false, string? Motif = null, bool ChantierClos = false);

/// <summary>Résultat d'un contrôle : code, ERREUR ou AVERTISSEMENT, pointage ou date concernés.</summary>
public sealed record Controle(string Code, string Niveau, string? Cle = null, string? Date = null);

/// <summary>
/// Contrôles d'une semaine de pointages d'un salarié, répliqués avec controles.js (jeu
/// modules/pointage/tests/cas/01_controles.json) : même ordre de résultat.
/// </summary>
public static class ReglesPointage
{
    public const string Erreur = "ERREUR";
    public const string Avertissement = "AVERTISSEMENT";

    public static readonly IReadOnlyDictionary<string, string> Messages = new Dictionary<string, string>
    {
        ["POI_CHANTIER"] = "Chantier obligatoire (chantier interne pour le temps hors chantier)",
        ["POI_TYPE"] = "Type de main-d'œuvre obligatoire",
        ["POI_MINUTES"] = "Durée invalide (de 1 minute à 24 heures)",
        ["POI_PAS"] = "Durée hors du pas de saisie",
        ["POI_PLAGE"] = "Début et fin incohérents avec la durée",
        ["POI_CHEVAUCHEMENT"] = "Plages horaires qui se chevauchent",
        ["POI_MOTIF"] = "Motif obligatoire pour une non-conformité",
        ["POI_JOUR"] = "Amplitude journalière dépassée",
        ["POI_SEMAINE"] = "Amplitude hebdomadaire dépassée",
        ["POI_CHANTIER_CLOS"] = "Chantier clos",
    };

    private static bool Valide(PointageControle x) => x.Minutes > 0 && x.Minutes <= 1440;

    public static List<Controle> ControlerSemaine(ParametresControle p, IReadOnlyList<PointageControle> pointages)
    {
        var r = new List<Controle>();
        foreach (var x in pointages)
        {
            if (x.ChaId is null) r.Add(new("POI_CHANTIER", Erreur, x.Cle));
            if (string.IsNullOrEmpty(x.TypeMo)) r.Add(new("POI_TYPE", Erreur, x.Cle));
            if (!Valide(x)) r.Add(new("POI_MINUTES", Erreur, x.Cle));
            else if (p.PasMinutes > 0 && x.Minutes % p.PasMinutes != 0) r.Add(new("POI_PAS", Erreur, x.Cle));
            if ((x.Debut is not null || x.Fin is not null) && (x.Debut is not int d || x.Fin is not int f || f <= d || f - d != x.Minutes))
                r.Add(new("POI_PLAGE", Erreur, x.Cle));
            if (x.NonConformite && string.IsNullOrWhiteSpace(x.Motif)) r.Add(new("POI_MOTIF", Erreur, x.Cle));
            if (x.ChantierClos) r.Add(new("POI_CHANTIER_CLOS", Avertissement, x.Cle));
        }
        var dates = pointages.Select(x => x.Date).Distinct().OrderBy(d => d, StringComparer.Ordinal).ToList();
        foreach (var d in dates)
        {
            var plages = pointages.Where(x => x.Date == d && x.Debut is not null && x.Fin is not null && x.Fin > x.Debut).ToList();
            for (var i = 0; i < plages.Count; i++)
            {
                for (var j = i + 1; j < plages.Count; j++)
                {
                    if (plages[i].Debut < plages[j].Fin && plages[j].Debut < plages[i].Fin) r.Add(new("POI_CHEVAUCHEMENT", Erreur, plages[j].Cle));
                }
            }
        }
        foreach (var d in dates)
        {
            var total = pointages.Where(x => x.Date == d && Valide(x)).Sum(x => x.Minutes);
            if (p.AmplitudeJour > 0 && total > p.AmplitudeJour) r.Add(new("POI_JOUR", Avertissement, Date: d));
        }
        var semaine = pointages.Where(Valide).Sum(x => x.Minutes);
        if (p.AmplitudeSemaine > 0 && semaine > p.AmplitudeSemaine) r.Add(new("POI_SEMAINE", Avertissement));
        return r;
    }

    public static bool Bloquant(IEnumerable<Controle> controles) => controles.Any(c => c.Niveau == Erreur);

    /// <summary>Lundi de la semaine d'une date.</summary>
    public static DateOnly LundiDe(DateOnly d) => d.AddDays(-(((int)d.DayOfWeek + 6) % 7));
}
