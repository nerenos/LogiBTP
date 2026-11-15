using System.Text.Json.Nodes;

namespace LogiBTP.Mcp.Web;

/// <summary>Résultat du filtre : réponse filtrée et clés retirées (distinctes, triées).</summary>
public sealed record ReponseFiltree(JsonNode? Reponse, IReadOnlyList<string> ClesRetirees);

/// <summary>
/// Défense en profondeur (§ 5.2 de l'analyse) : toute réponse d'outil passe par ce filtre, qui retire à toute profondeur
/// les clés déclarées sensibles pour les garde-fous actifs, et balise les contenus libres (texte d'un tiers, d'un PDF…)
/// dans un objet <c>{ "contenu_non_fiable": valeur }</c> (R4 : jamais pris pour une consigne). Un oubli d'une route ne
/// suffit donc pas à faire fuir un champ.
/// </summary>
public static class FiltreSensible
{
    /// <summary>Clé de balisage d'un contenu libre.</summary>
    public const string CleNonFiable = "contenu_non_fiable";

    /// <summary>Clés sensibles des garde-fous actifs (spécialisation et outil réunis).</summary>
    public static IReadOnlySet<string> Cles(IEnumerable<string> gardesFousActifs, params IReadOnlyDictionary<string, IReadOnlyList<string>>?[] declarations)
    {
        var actifs = gardesFousActifs.ToHashSet();
        var cles = new HashSet<string>(StringComparer.Ordinal);
        foreach (var d in declarations)
            foreach (var (g, liste) in d ?? new Dictionary<string, IReadOnlyList<string>>())
                if (actifs.Contains(g)) cles.UnionWith(liste);
        return cles;
    }

    /// <summary>Filtre une réponse (copie) : clés sensibles retirées, contenus libres balisés.</summary>
    public static ReponseFiltree Filtrer(JsonNode? reponse, IReadOnlySet<string> sensibles, IReadOnlySet<string> nonFiables)
    {
        if (reponse is null) return new(null, []);
        var copie = reponse.DeepClone();
        var retirees = new SortedSet<string>(StringComparer.Ordinal);
        Parcourir(copie, sensibles, nonFiables, retirees);
        return new(copie, [.. retirees]);
    }

    private static void Parcourir(JsonNode? n, IReadOnlySet<string> sensibles, IReadOnlySet<string> nonFiables, SortedSet<string> retirees)
    {
        switch (n)
        {
            case JsonObject o:
                foreach (var cle in o.Select(kv => kv.Key).ToList())
                {
                    if (sensibles.Contains(cle))
                    {
                        o.Remove(cle);
                        retirees.Add(cle);
                    }
                    else if (nonFiables.Contains(cle) && o[cle] is { } v && !(v is JsonObject b && b.ContainsKey(CleNonFiable)))
                    {
                        // Valeur libre : filtrée elle aussi (une clé sensible ne se cache pas dans un contenu balisé).
                        Parcourir(v, sensibles, nonFiables, retirees);
                        o[cle] = new JsonObject { [CleNonFiable] = v.DeepClone() };
                    }
                    else Parcourir(o[cle], sensibles, nonFiables, retirees);
                }
                break;
            case JsonArray a:
                foreach (var e in a) Parcourir(e, sensibles, nonFiables, retirees);
                break;
        }
    }
}
