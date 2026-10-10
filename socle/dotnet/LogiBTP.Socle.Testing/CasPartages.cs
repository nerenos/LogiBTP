using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace LogiBTP.Socle.Testing;

/// <summary>Lecture et comparaison des jeux de test partagés (fichiers JSON rejoués par Vitest et xUnit).</summary>
public static class CasPartages
{
    /// <summary>Racine du dépôt (dossier contenant LogiBTP.slnx).</summary>
    public static string RacineDepot()
    {
        var d = new DirectoryInfo(AppContext.BaseDirectory);
        while (d is not null && !File.Exists(Path.Combine(d.FullName, "LogiBTP.slnx"))) d = d.Parent;
        return d?.FullName ?? throw new DirectoryNotFoundException("LogiBTP.slnx introuvable");
    }

    /// <summary>Chemin relatif à la racine du dépôt.</summary>
    public static string Chemin(params string[] parties) => Path.Combine([RacineDepot(), .. parties]);

    /// <summary>Noms des fichiers JSON d'un dossier, triés (pour MemberData).</summary>
    public static IEnumerable<string> Fichiers(string dossier) =>
        Directory.GetFiles(dossier, "*.json").Select(Path.GetFileName).Order(StringComparer.Ordinal)!;

    public static JsonObject Lire(string fichier) => JsonNode.Parse(File.ReadAllText(fichier))!.AsObject();

    /// <summary>Égalité attendu / obtenu : nombres en décimal exact, null = absent.</summary>
    public static bool Egal(JsonNode? attendu, JsonNode? obtenu)
    {
        if (attendu is null) return obtenu is null;
        if (obtenu is null) return false;
        var a = attendu.AsValue();
        var o = obtenu.AsValue();
        return a.GetValueKind() switch
        {
            JsonValueKind.Number => o.GetValueKind() == JsonValueKind.Number && a.GetValue<decimal>() == o.GetValue<decimal>()
                || o.GetValueKind() == JsonValueKind.String && decimal.TryParse(o.GetValue<string>(), System.Globalization.NumberStyles.Number,
                    System.Globalization.CultureInfo.InvariantCulture, out var d) && d == a.GetValue<decimal>(),
            JsonValueKind.True or JsonValueKind.False => o.GetValueKind() == a.GetValueKind(),
            _ => o.GetValueKind() == JsonValueKind.String && a.GetValue<string>() == o.GetValue<string>(),
        };
    }

    /// <summary>Vérifie chaque champ attendu d'un objet ; ajoute les différences à <paramref name="fautes"/>.</summary>
    public static void Verifier(JsonObject attendu, JsonObject? obtenu, string chemin, List<string> fautes)
    {
        if (obtenu is null) { fautes.Add($"{chemin} : introuvable"); return; }
        foreach (var (champ, v) in attendu)
        {
            obtenu.TryGetPropertyValue(champ, out var o);
            if (!Egal(v, o)) fautes.Add($"{chemin}.{champ} : attendu {v?.ToJsonString() ?? "null"}, obtenu {o?.ToJsonString() ?? "null"}");
        }
    }

    /// <summary>Premier objet d'un tableau dont le champ vaut la valeur indiquée.</summary>
    public static JsonObject? Trouver(JsonArray liste, string champ, string valeur) =>
        liste.Select(n => n!.AsObject()).FirstOrDefault(o => o[champ]?.ToJsonString().Trim('"') == valeur);

    /// <summary>Compare les codes d'erreur produits à ceux attendus (absents = aucune erreur).</summary>
    public static void VerifierErreurs(JsonNode? attendus, IEnumerable<string> codes, List<string> fautes)
    {
        var obtenus = codes.Order(StringComparer.Ordinal).ToList();
        var att = (attendus?.AsArray().Select(n => n!.GetValue<string>()) ?? []).Order(StringComparer.Ordinal).ToList();
        if (!obtenus.SequenceEqual(att)) fautes.Add($"erreurs : attendu [{string.Join(", ", att)}], obtenu [{string.Join(", ", obtenus)}]");
    }

    /// <summary>Lit un ensemble de colonnes déclaré dans un fichier JS (<c>NOM = new Set([...])</c>).</summary>
    public static HashSet<string> ColonnesJs(string fichier, string nom)
    {
        var source = File.ReadAllText(fichier);
        var bloc = Regex.Match(source, $@"{nom} = new Set\(\[(.*?)\]\)", RegexOptions.Singleline).Groups[1].Value;
        return Regex.Matches(bloc, "'([a-z_]+)'").Select(m => m.Groups[1].Value).ToHashSet();
    }
}
