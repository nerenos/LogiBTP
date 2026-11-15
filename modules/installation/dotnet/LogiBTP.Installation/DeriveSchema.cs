namespace LogiBTP.Installation;

/// <summary>
/// Écart de schéma : <c>ajoute</c> (objet réel absent de l'attendu, sans conflit), <c>modifie</c> / <c>supprime</c> (en
/// conflit : nos scripts peuvent supposer l'objet attendu), <c>dependance</c> (objet préfixé d'un intégrateur qui dépend
/// d'un de nos objets : en conflit).
/// </summary>
public sealed record EcartSchema(string Objet, string Type, string? Attendu, string? Reel)
{
    public const string Ajoute = "ajoute", Modifie = "modifie", Supprime = "supprime", Dependance = "dependance";

    public bool EnConflit => Type != Ajoute;
}

/// <summary>Dérive : comparaison de deux instantanés (attendu = stocké ou référence, réel = catalogue de la base).</summary>
public static class DeriveSchema
{
    private static readonly string[] Enfants = ["colonne", "contrainte", "index", "declencheur"];

    public static IReadOnlyList<EcartSchema> Comparer(InstantaneSchema attendu, InstantaneSchema reel, IReadOnlyCollection<string> prefixes)
    {
        var a = attendu.Objets;
        var r = reel.Objets;
        // Table ajoutée ou supprimée en entier : seule la table est rapportée, pas ses colonnes, index, etc.
        var tablesEntieres = new HashSet<string>(StringComparer.Ordinal);
        foreach (var k in a.Keys.Union(r.Keys, StringComparer.Ordinal).Where(k => k.StartsWith("table:", StringComparison.Ordinal)))
            if (a.ContainsKey(k) != r.ContainsKey(k)) tablesEntieres.Add(k["table:".Length..]);
        var ecarts = new List<EcartSchema>();
        foreach (var k in a.Keys.Union(r.Keys, StringComparer.Ordinal).Order(StringComparer.Ordinal))
        {
            if (Ignore(k, prefixes)) continue;
            var (type, nom) = Decouper(k);
            if (Enfants.Contains(type) && tablesEntieres.Contains(nom.Split('.')[0])) continue;
            var dansA = a.TryGetValue(k, out var va);
            var dansR = r.TryGetValue(k, out var vr);
            if (dansA && dansR) { if (va != vr) ecarts.Add(new(k, EcartSchema.Modifie, va, vr)); }
            else if (dansA) ecarts.Add(new(k, EcartSchema.Supprime, va, null));
            else ecarts.Add(new(k, EcartSchema.Ajoute, null, vr));
        }
        return ecarts;
    }

    /// <summary>Objet ignoré : un de ses noms (table, colonne, objet) commence par x_ (champs supplémentaires) ou par un préfixe déclaré.</summary>
    public static bool Ignore(string cle, IReadOnlyCollection<string> prefixes) =>
        Noms(cle).Any(n => n.StartsWith("x_", StringComparison.Ordinal) || prefixes.Any(p => n.StartsWith(p, StringComparison.Ordinal)));

    public static (string Type, string Nom) Decouper(string cle)
    {
        var i = cle.IndexOf(':');
        return i < 0 ? ("", cle) : (cle[..i], cle[(i + 1)..]);
    }

    /// <summary>Noms composant une clé (« colonne:t.c » → t, c ; « fonction:f(a) » → f).</summary>
    public static IEnumerable<string> Noms(string cle)
    {
        var nom = Decouper(cle).Nom;
        var p = nom.IndexOf('(');
        if (p >= 0) nom = nom[..p];
        return nom.Split('.');
    }

    /// <summary>
    /// Effet d'une mise à jour sur l'objet en écart : « script à appliquer » si un script en attente ou rejouable cite
    /// son nom, sinon « inchangé ».
    /// </summary>
    public static string Effet(EcartSchema e, IEnumerable<string> contenusScripts)
    {
        var nom = Noms(e.Objet).Last();
        return contenusScripts.Any(c => c.Contains(nom, StringComparison.Ordinal)) ? "script à appliquer" : "inchangé";
    }
}
