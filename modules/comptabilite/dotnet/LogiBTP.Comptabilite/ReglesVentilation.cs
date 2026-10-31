namespace LogiBTP.Comptabilite;

/// <summary>Type comptable vu par la règle : parent (ex. SOUS_TRAITANCE → ACHAT) et compte par défaut.</summary>
public sealed record TypeVentilation(string Code, string? Parent, string? CompteDefaut);

/// <summary>Clé de ventilation : type comptable, nature et / ou taux de TVA (codes), compte.</summary>
public sealed record CleVentilation(string Type, string? Nature, string? Taux, string? Compte);

/// <summary>
/// Ligne à ventiler : compte saisi, nature, taux de TVA, type comptable de la pièce, compte de produit ou de charge du
/// tiers de la pièce (distinct de son compte auxiliaire).
/// </summary>
public sealed record EntreeVentilation(string? Compte, string? Nature, string? Taux, string? Type, string? Tiers = null);

public sealed record ResultatVentilation(string? Compte, string? Origine, string? Type, string? Erreur);

/// <summary>
/// Règle de ventilation, répliquée dans ventilation.js (jeu modules/comptabilite/tests/cas/02_ventilation.json) :
/// compte de la ligne, compte du tiers, clé nature + taux, clé nature, clé taux, compte par défaut du type comptable ; aux étapes 3 à 6,
/// le type de la pièce avant son parent ; sinon COMPTE_INTROUVABLE.
/// </summary>
public static class ReglesVentilation
{
    public static readonly IReadOnlyDictionary<string, string> Origines = new Dictionary<string, string>
    {
        ["LIGNE"] = "compte de la ligne", ["TIERS"] = "compte du tiers", ["NATURE_TAUX"] = "nature et taux de TVA", ["NATURE"] = "nature",
        ["TAUX"] = "taux de TVA", ["TYPE"] = "type comptable",
    };

    public static readonly IReadOnlyDictionary<string, string> Messages = new Dictionary<string, string>
    {
        ["COMPTE_INTROUVABLE"] = "Aucun compte : ni sur la ligne, ni par la ventilation, ni par défaut pour le type comptable",
    };

    private static string? Texte(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();

    /// <summary>Types comptables de la chaîne : le type, puis ses parents (sans boucle, cinq niveaux au plus).</summary>
    public static List<string> ChaineTypes(string? type, IReadOnlyList<TypeVentilation> types)
    {
        var res = new List<string>();
        var t = Texte(type);
        while (t is not null && !res.Contains(t) && res.Count < 5)
        {
            res.Add(t);
            t = Texte(types.FirstOrDefault(x => x.Code == t)?.Parent);
        }
        return res;
    }

    public static ResultatVentilation Compte(EntreeVentilation e, IReadOnlyList<TypeVentilation> types, IReadOnlyList<CleVentilation> cles)
    {
        if (Texte(e.Compte) is string propre) return new(propre, "LIGNE", null, null);
        if (Texte(e.Tiers) is string tiers) return new(tiers, "TIERS", null, null);
        var nature = Texte(e.Nature);
        var taux = Texte(e.Taux);
        var chaine = ChaineTypes(e.Type, types);
        CleVentilation? Cle(string t, string? n, string? x) =>
            cles.FirstOrDefault(c => c.Type == t && Texte(c.Nature) == n && Texte(c.Taux) == x && Texte(c.Compte) is not null);
        var etapes = new List<(string Origine, Func<string, CleVentilation?>? Chercher)>
        {
            ("NATURE_TAUX", nature is not null && taux is not null ? t => Cle(t, nature, taux) : null),
            ("NATURE", nature is not null ? t => Cle(t, nature, null) : null),
            ("TAUX", taux is not null ? t => Cle(t, null, taux) : null),
        };
        foreach (var (origine, chercher) in etapes)
        {
            if (chercher is null) continue;
            foreach (var t in chaine)
                if (chercher(t) is { } c) return new(Texte(c.Compte), origine, t, null);
        }
        foreach (var t in chaine)
            if (Texte(types.FirstOrDefault(x => x.Code == t)?.CompteDefaut) is string d) return new(d, "TYPE", t, null);
        return new(null, null, null, "COMPTE_INTROUVABLE");
    }
}
