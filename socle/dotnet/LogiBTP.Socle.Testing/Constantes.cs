using System.Reflection;
using System.Text.RegularExpressions;

namespace LogiBTP.Socle.Testing;

/// <summary>
/// Parité des fichiers de codes JS / C# : un objet figé <c>export const NOM = Object.freeze({ CLE: 'valeur', … })</c> du
/// fichier <c>codes.js</c> d'un module correspond à une classe statique de constantes <c>public const string Cle = "valeur"</c>
/// (nom C# en PascalCase de la clé JS : <c>A_FAIRE</c> ↔ <c>AFaire</c>).
/// </summary>
public static class Constantes
{
    /// <summary>Paires clé → valeur d'un objet figé déclaré dans un fichier JS.</summary>
    public static Dictionary<string, string> Js(string fichier, string nom)
    {
        var source = File.ReadAllText(fichier);
        var bloc = Regex.Match(source, $@"export const {nom} = Object\.freeze\(\{{(.*?)\}}\);", RegexOptions.Singleline);
        if (!bloc.Success) throw new InvalidOperationException($"{nom} introuvable dans {fichier}");
        return Regex.Matches(bloc.Groups[1].Value, @"([A-Z][A-Z0-9_]*)\s*:\s*'([^']*)'")
            .ToDictionary(m => Cle(m.Groups[1].Value), m => m.Groups[2].Value);
    }

    /// <summary>Constantes chaînes d'une classe statique.</summary>
    public static Dictionary<string, string> Cs(Type type) =>
        type.GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(f => f.IsLiteral && f.FieldType == typeof(string))
            .ToDictionary(f => Cle(f.Name), f => (string)f.GetRawConstantValue()!);

    /// <summary>Différences entre l'objet JS et la classe C# (vide = parité).</summary>
    public static List<string> Ecarts(string fichier, string nom, Type type)
    {
        var js = Js(fichier, nom);
        var cs = Cs(type);
        var ecarts = new List<string>();
        foreach (var (k, v) in js)
            if (!cs.TryGetValue(k, out var c)) ecarts.Add($"{nom}.{k} = '{v}' absent de {type.Name}");
            else if (c != v) ecarts.Add($"{nom}.{k} : JS '{v}', C# \"{c}\"");
        ecarts.AddRange(cs.Keys.Except(js.Keys).Select(k => $"{type.Name}.{k} = \"{cs[k]}\" absent de {nom}"));
        return ecarts;
    }

    private static string Cle(string nom) => nom.Replace("_", "").ToUpperInvariant();
}
