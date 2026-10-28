namespace LogiBTP.Domaine.Ressources;

/// <summary>Type d'habilitation utile aux règles : durée de validité (mois, nulle : sans fin), élément concerné, actif.</summary>
public sealed record TypeHabilitation(int? DureeMois, string Concerne = "SALARIE", bool Actif = true);

/// <summary>Habilitation évaluée : code du type, obtention, fin de validité saisie.</summary>
public sealed record HabilitationEvaluee(string Code, DateOnly? ObtenueLe, DateOnly? ValideJusquAu);

/// <summary>État d'une habilitation à une date (jours restants nuls sans fin de validité).</summary>
public sealed record EtatHabilitation(string Etat, DateOnly? Fin, int? JoursRestants);

/// <summary>Mission d'intérim évaluée.</summary>
public sealed record MissionEvaluee(int? Id, DateOnly? Debut, DateOnly? Fin, long? AgenceId, decimal? TauxHoraire);

/// <summary>Erreurs d'une mission de la liste contrôlée.</summary>
public sealed record ErreursMission(int Index, List<string> Codes);

/// <summary>
/// Règles du référentiel des ressources, répliquées dans client/src/app/ressources/regles.js (jeux tests/ressources) :
/// validité des habilitations, habilitations exigées manquantes, contrôles des habilitations et des missions d'intérim,
/// mission en cours.
/// </summary>
public static class ReglesRessources
{
    public const int SeuilRenouvellement = 60;

    /// <summary>Date + n mois, jour ramené au dernier du mois s'il n'existe pas (DateOnly.AddMonths fait de même).</summary>
    public static DateOnly AjouterMois(DateOnly date, int n) => date.AddMonths(n);

    /// <summary>Fin de validité : saisie, sinon obtention + durée du type, sinon sans fin.</summary>
    public static DateOnly? FinValidite(HabilitationEvaluee h, int? dureeMois) =>
        h.ValideJusquAu ?? (h.ObtenueLe is { } o && dureeMois is > 0 ? AjouterMois(o, dureeMois.Value) : null);

    public static EtatHabilitation Etat(HabilitationEvaluee h, int? dureeMois, DateOnly date, int seuil = SeuilRenouvellement)
    {
        var fin = FinValidite(h, dureeMois);
        int? jours = fin is { } f ? f.DayNumber - date.DayNumber : null;
        var etat = h.ObtenueLe is { } o && o > date ? "NON_ACQUISE"
            : fin is { } f2 && f2 < date ? "EXPIREE"
            : jours is { } j && j <= seuil ? "A_RENOUVELER"
            : "VALIDE";
        return new EtatHabilitation(etat, fin, jours);
    }

    /// <summary>Codes exigés sans habilitation valable à la date (valide ou à renouveler), triés.</summary>
    public static List<string> Manquantes(IEnumerable<string> exigees, IEnumerable<HabilitationEvaluee> habilitations,
        IReadOnlyDictionary<string, TypeHabilitation> types, DateOnly date)
    {
        var valables = habilitations
            .Where(h => Etat(h, types.TryGetValue(h.Code, out var t) ? t.DureeMois : null, date).Etat is "VALIDE" or "A_RENOUVELER")
            .Select(h => h.Code).ToHashSet();
        return exigees.Distinct().Where(c => !valables.Contains(c)).Order(StringComparer.Ordinal).ToList();
    }

    /// <summary>Contrôle d'une habilitation saisie pour un élément (salarie ou materiel) : codes triés.</summary>
    public static List<string> Controler(HabilitationEvaluee h, IReadOnlyDictionary<string, TypeHabilitation> types, string element)
    {
        var erreurs = new List<string>();
        if (!types.TryGetValue(h.Code, out var t) || !t.Actif) erreurs.Add("HAB_TYPE");
        else if (t.Concerne != "LES_DEUX" && t.Concerne != (element == TypesFiche.Materiel ? "MATERIEL" : "SALARIE")) erreurs.Add("HAB_CONCERNE");
        if (h.ObtenueLe is { } o && h.ValideJusquAu is { } f && f < o) erreurs.Add("HAB_DATES");
        erreurs.Sort(StringComparer.Ordinal);
        return erreurs;
    }

    /// <summary>Missions en erreur : dates, période, agence, taux, chevauchement (signalé sur les deux missions).</summary>
    public static List<ErreursMission> ControlerMissions(IReadOnlyList<MissionEvaluee> missions)
    {
        var res = missions.Select(_ => new SortedSet<string>(StringComparer.Ordinal)).ToList();
        for (var i = 0; i < missions.Count; i++)
        {
            var m = missions[i];
            if (m.Debut is null || m.Fin is null) res[i].Add("MIS_DATES");
            else if (m.Fin < m.Debut) res[i].Add("MIS_PERIODE");
            if (m.AgenceId is null or 0) res[i].Add("MIS_AGENCE");
            if (m.TauxHoraire is < 0) res[i].Add("MIS_TAUX");
        }
        for (var i = 0; i < missions.Count; i++)
        {
            for (var j = i + 1; j < missions.Count; j++)
            {
                var (a, b) = (missions[i], missions[j]);
                if (a.Debut is { } ad && a.Fin is { } af && b.Debut is { } bd && b.Fin is { } bf && ad <= bf && bd <= af)
                {
                    res[i].Add("MIS_CHEVAUCHEMENT");
                    res[j].Add("MIS_CHEVAUCHEMENT");
                }
            }
        }
        return res.Select((s, i) => new ErreursMission(i, [.. s])).Where(x => x.Codes.Count > 0).ToList();
    }

    /// <summary>Mission qui couvre la date (la dernière commencée si plusieurs), ou null.</summary>
    public static MissionEvaluee? EnCours(IEnumerable<MissionEvaluee> missions, DateOnly date) =>
        missions.Where(m => m.Debut <= date && date <= m.Fin).OrderByDescending(m => m.Debut).FirstOrDefault();

    public static readonly IReadOnlyDictionary<string, string> Messages = new Dictionary<string, string>
    {
        ["HAB_TYPE"] = "Type d'habilitation inconnu ou inactif",
        ["HAB_CONCERNE"] = "Ce type d'habilitation ne s'applique pas à cet élément",
        ["HAB_DATES"] = "Fin de validité antérieure à l'obtention",
        ["MIS_PERIODE"] = "Fin de mission antérieure au début",
        ["MIS_DATES"] = "Début et fin de mission obligatoires",
        ["MIS_AGENCE"] = "Agence d'intérim obligatoire",
        ["MIS_TAUX"] = "Taux horaire négatif",
        ["MIS_CHEVAUCHEMENT"] = "Missions qui se chevauchent",
    };
}
