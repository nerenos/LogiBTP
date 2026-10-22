namespace LogiBTP.Execution;

/// <summary>Étape d'un parcours : code, service, étapes amont (plusieurs pour une jonction).</summary>
public sealed record EtapeParcours(string Code, int? SrvId, IReadOnlyList<string>? Amonts = null);

/// <summary>Ordre évalué : service, statut documentaire, état d'exécution propre.</summary>
public sealed record OrdreEvalue(int? SrvId, string Statut, string? Etat = null);

/// <summary>État imposé à la main pour un service.</summary>
public sealed record EtatManuel(int SrvId, string Etat);

/// <summary>État d'un service sur un élément : retenu, automatique, manuel, écart (manuel différent de l'automatique).</summary>
public sealed record EtatService(int SrvId, string Etat, string Automatique, string? Manuel, bool Ecart);

/// <summary>
/// États d'exécution, répliqués dans etats.js (jeu modules/execution/tests/cas/01_etats.json) : état d'un ordre, états des
/// services d'un élément d'après son parcours, ses ordres et les états manuels, contrôle d'un parcours.
/// </summary>
public static class ReglesEtats
{
    public static readonly string[] EtatsService = ["SANS_OBJET", "A_VENIR", "EN_ATTENTE", "EN_COURS", "BLOQUE", "TERMINE"];
    public static readonly string[] EtatsOrdre = ["A_FAIRE", "EN_ATTENTE", "EN_COURS", "BLOQUE", "TERMINE"];

    public static string? EtatOrdre(OrdreEvalue o) => o switch
    {
        { Statut: "ANNULE" or "REMPLACE" } => null,
        { Etat: "BLOQUE" } => "BLOQUE",
        { Statut: "SOLDE" } or { Etat: "TERMINE" } => "TERMINE",
        { Etat: "EN_COURS" } => "EN_COURS",
        { Statut: "BROUILLON" } => "A_FAIRE",
        { Etat: "EN_ATTENTE" } => "EN_ATTENTE",
        _ => "EN_COURS",
    };

    private static string? EtatDesOrdres(List<string> etats)
    {
        if (etats.Count == 0) return null;
        if (etats.Contains("BLOQUE")) return "BLOQUE";
        if (etats.All(e => e == "TERMINE")) return "TERMINE";
        if (etats.Any(e => e is "EN_COURS" or "TERMINE")) return "EN_COURS";
        return "EN_ATTENTE";
    }

    public static List<EtatService> EtatsServices(IReadOnlyList<EtapeParcours> etapes, IReadOnlyList<OrdreEvalue> ordres, IReadOnlyList<EtatManuel> manuels)
    {
        var services = etapes.Select(e => e.SrvId).Concat(ordres.Select(o => o.SrvId)).Concat(manuels.Select(m => (int?)m.SrvId))
            .OfType<int>().Distinct().Order().ToList();
        var parCode = etapes.GroupBy(e => e.Code).ToDictionary(g => g.Key, g => g.First());
        HashSet<int> Amont(int s) => etapes.Where(e => e.SrvId == s).SelectMany(e => e.Amonts ?? [])
            .Where(parCode.ContainsKey).Select(c => parCode[c].SrvId).OfType<int>().Where(x => x != s).ToHashSet();
        var resultats = new Dictionary<int, EtatService>();
        var enCours = new HashSet<int>();
        EtatService? Calculer(int s)
        {
            if (resultats.TryGetValue(s, out var r)) return r;
            if (!enCours.Add(s)) return null; // boucle
            var automatique = EtatDesOrdres(ordres.Where(o => o.SrvId == s).Select(EtatOrdre).OfType<string>().ToList());
            if (automatique is null)
            {
                if (!etapes.Any(e => e.SrvId == s)) automatique = "SANS_OBJET";
                else automatique = Amont(s).Select(Calculer).OfType<EtatService>().All(a => a.Etat == "TERMINE") ? "EN_ATTENTE" : "A_VENIR";
            }
            var manuel = manuels.FirstOrDefault(m => m.SrvId == s)?.Etat;
            r = new EtatService(s, manuel ?? automatique, automatique, manuel, manuel is not null && manuel != automatique);
            enCours.Remove(s);
            resultats[s] = r;
            return r;
        }
        return services.Select(Calculer).OfType<EtatService>().ToList();
    }

    public static List<string> ControlerParcours(IReadOnlyList<EtapeParcours> etapes)
    {
        var e = new SortedSet<string>(StringComparer.Ordinal);
        var codes = etapes.Select(x => x.Code).ToList();
        if (codes.Any(string.IsNullOrEmpty)) e.Add("PAR_CODE");
        if (codes.Distinct().Count() != codes.Count) e.Add("PAR_DOUBLON");
        if (etapes.Any(x => x.SrvId is null)) e.Add("PAR_SERVICE");
        if (etapes.Any(x => (x.Amonts ?? []).Any(a => !codes.Contains(a)))) e.Add("PAR_AMONT");
        var amonts = etapes.GroupBy(x => x.Code).ToDictionary(g => g.Key, g => g.First().Amonts ?? []);
        bool Boucle(string c, HashSet<string> chemin)
        {
            if (!chemin.Add(c)) return true;
            var r = amonts.TryGetValue(c, out var a) && a.Any(x => Boucle(x, chemin));
            chemin.Remove(c);
            return r;
        }
        if (etapes.Any(x => Boucle(x.Code, []))) e.Add("PAR_BOUCLE");
        return [.. e];
    }

    public static readonly IReadOnlyDictionary<string, string> Messages = new Dictionary<string, string>
    {
        ["PAR_CODE"] = "Code d'étape obligatoire",
        ["PAR_DOUBLON"] = "Codes d'étape en double",
        ["PAR_SERVICE"] = "Service obligatoire pour chaque étape",
        ["PAR_AMONT"] = "Étape amont inconnue",
        ["PAR_BOUCLE"] = "Parcours en boucle",
    };
}
