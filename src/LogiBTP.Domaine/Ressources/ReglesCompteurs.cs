namespace LogiBTP.Domaine.Ressources;

/// <summary>Relevé de compteur : unité (H, KM), date, valeur, remise à zéro (compteur remplacé).</summary>
public sealed record ReleveCompteur(string? Unite, DateOnly? Date, decimal? Valeur, bool Remise = false);

/// <summary>Erreur d'une liste de relevés : code, relevé en cause (indice dans la liste).</summary>
public sealed record ErreurReleve(string Code, int Releve);

/// <summary>Point de la série cumulée d'une unité : relevé, date, valeur lue, valeur cumulée.</summary>
public sealed record PointCompteur(int Releve, DateOnly Date, decimal Valeur, decimal Cumul);

/// <summary>Événement du matériel (contrôlé avant l'enregistrement).</summary>
public sealed record EvenementMateriel(string? Type, DateOnly? Date, DateOnly? Fin, string? Libelle, decimal? Litres, decimal? Cout);

/// <summary>
/// Compteurs et événements du matériel (lot 5c-2 des demandes du 25/10/2026), répliqués dans
/// client/src/app/ressources/compteurs.js (jeu tests/ressources/05_compteurs.json) : relevés datés en heures ou
/// kilomètres (deux unités au plus, M7), jamais sous le précédent de la même unité sauf remise à zéro ; compteur à une
/// date ; série cumulée ; contrôle d'un événement. Relevés ordonnés par date puis par ordre de saisie.
/// </summary>
public static class ReglesCompteurs
{
    public static readonly string[] Unites = ["H", "KM"];
    public static readonly string[] TypesEvenement = ["PANNE", "SINISTRE", "ACCIDENT", "IMMOBILISATION", "CONTROLE", "ENTRETIEN", "CARBURANT", "AUTRE"];

    /// <summary>Unités suivies d'un matériel selon son réglage (H, KM, H_KM, AUCUN).</summary>
    public static string[] UnitesCompteurs(string? reglage) => reglage switch
    {
        "H" => ["H"],
        "KM" => ["KM"],
        "H_KM" => ["H", "KM"],
        _ => [],
    };

    private static bool Valable(ReleveCompteur r) => r.Unite is { } u && Unites.Contains(u) && r.Date is not null && r.Valeur is >= 0;

    private static List<(ReleveCompteur R, int I)> Ordonnes(IReadOnlyList<ReleveCompteur> releves, string unite) =>
        [.. releves.Select((r, i) => (R: r, I: i)).Where(x => x.R.Unite == unite && Valable(x.R)).OrderBy(x => x.R.Date).ThenBy(x => x.I)];

    public static List<ErreurReleve> Controler(IReadOnlyCollection<string> unites, IReadOnlyList<ReleveCompteur> releves)
    {
        var r = new List<ErreurReleve>();
        for (var i = 0; i < releves.Count; i++)
        {
            var x = releves[i];
            if (x.Unite is null || !unites.Contains(x.Unite)) r.Add(new("REL_UNITE", i));
            if (x.Date is null) r.Add(new("REL_DATE", i));
            if (x.Valeur is not >= 0) r.Add(new("REL_VALEUR", i));
        }
        foreach (var unite in Unites)
        {
            var l = Ordonnes(releves, unite);
            for (var k = 1; k < l.Count; k++)
            {
                if (!l[k].R.Remise && l[k].R.Valeur < l[k - 1].R.Valeur) r.Add(new("REL_DECROISSANT", l[k].I));
            }
        }
        return [.. r.OrderBy(e => e.Releve).ThenBy(e => e.Code, StringComparer.Ordinal)];
    }

    /// <summary>Valeur du compteur à une date : dernier relevé valable de l'unité à cette date ou avant, null sinon.</summary>
    public static decimal? A(IReadOnlyList<ReleveCompteur> releves, string unite, DateOnly date) =>
        Ordonnes(releves, unite).Where(x => x.R.Date <= date).Select(x => x.R.Valeur).LastOrDefault();

    /// <summary>Série cumulée d'une unité : une remise à zéro ajoute la valeur atteinte avant elle.</summary>
    public static List<PointCompteur> Cumuls(IReadOnlyList<ReleveCompteur> releves, string unite)
    {
        var r = new List<PointCompteur>();
        decimal decalage = 0;
        decimal? precedent = null;
        foreach (var (x, i) in Ordonnes(releves, unite))
        {
            var valeur = x.Valeur!.Value;
            if (x.Remise && precedent is { } p) decalage += p;
            precedent = valeur;
            r.Add(new(i, x.Date!.Value, valeur, valeur + decalage));
        }
        return r;
    }

    /// <summary>Codes d'erreur d'un événement, triés.</summary>
    public static List<string> ControlerEvenement(EvenementMateriel e)
    {
        var r = new List<string>();
        if (e.Type is null || !TypesEvenement.Contains(e.Type)) r.Add("EVT_TYPE");
        if (e.Date is not { } d || (e.Fin is { } f && f < d)) r.Add("EVT_DATE");
        if (e.Type != "CARBURANT" && string.IsNullOrWhiteSpace(e.Libelle)) r.Add("EVT_LIBELLE");
        if (e.Type == "CARBURANT" && e.Litres is not > 0) r.Add("EVT_LITRES");
        if (e.Cout is < 0) r.Add("EVT_COUT");
        return [.. r.Order(StringComparer.Ordinal)];
    }
}
