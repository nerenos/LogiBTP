namespace LogiBTP.Ged;

public sealed record VersionResume(int Numero, string Genre);

/// <summary>
/// Conservation des versions : même règle que versions.js (jeu partagé modules/ged/tests/cas/02_versions.json).
///   etape   (validation, envoi, signature…) : toutes conservées ;
///   edition (dépôts, modifications)         : les N dernières conservées.
/// La version courante n'est jamais purgée ; un document du coffre-fort ne perd aucune version.
/// </summary>
public static class RegleVersions
{
    public const string Edition = "edition";
    public const string Etape = "etape";

    public static IReadOnlyList<int> EditionsAPurger(IEnumerable<VersionResume> versions, int conservees, bool coffre = false)
    {
        if (coffre) return [];
        var liste = versions.ToList();
        if (liste.Count == 0) return [];
        var courante = liste.Max(v => v.Numero);
        return liste.Where(v => v.Genre == Edition).OrderByDescending(v => v.Numero)
            .Skip(Math.Max(conservees, 0)).Select(v => v.Numero).Where(n => n != courante).Order().ToList();
    }
}
