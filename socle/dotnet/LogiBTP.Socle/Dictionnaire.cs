using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace LogiBTP.Socle;

/// <summary>
/// Dictionnaire des textes (module Personnalisation, ANALYSE-MODULE-PERSONNALISATION.md § 4.2) : même résolution que
/// socle/js/src/dictionnaire/resolution.js (jeu socle/tests/dictionnaire.json). Clés à points, interpolation {{nom}},
/// références $t(cle) développées avant l'interpolation (cycles refusés), pluriel _zero (facultatif) / _un (|n| &lt; 2,
/// règle du français) / _autre, repli sur la valeur par défaut puis sur la clé ; fusion profonde des couches.
/// </summary>
public sealed partial class Dictionnaire(JsonObject libelles)
{
    private const int ProfondeurMax = 10;

    [GeneratedRegex(@"\{\{\s*([\p{L}\p{N}_.]+)\s*\}\}")]
    private static partial Regex Variable();

    [GeneratedRegex(@"\$t\(([^()\s]+)\)")]
    private static partial Regex Reference();

    public JsonObject Libelles { get; } = libelles;

    public static Dictionnaire Lire(string json) => new(JsonNode.Parse(json) as JsonObject ?? []);

    /// <summary>Langue des formats : _meta.langue, « fr-FR » par défaut.</summary>
    public string Langue => ValeurBrute("_meta.langue") ?? "fr-FR";

    /// <summary>Texte d'une clé, ou null (clé absente, ou branche du dictionnaire).</summary>
    public string? ValeurBrute(string cle)
    {
        JsonNode? n = Libelles;
        foreach (var partie in cle.Split('.'))
        {
            if (n is not JsonObject o || !o.TryGetPropertyValue(partie, out n)) return null;
        }
        return n is JsonValue v && v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : null;
    }

    public bool Existe(string cle) => ValeurBrute(cle) is not null;

    private static string EnTexte(object? v) => v switch
    {
        null => "",
        string s => s,
        JsonValue j when j.GetValueKind() == JsonValueKind.String => j.GetValue<string>(),
        JsonNode j => j.ToJsonString(),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => v.ToString() ?? "",
    };

    /// <summary>Remplace les {{variables}} ; une valeur absente donne un texte vide.</summary>
    public static string Interpoler(string texte, IReadOnlyDictionary<string, object?>? valeurs) =>
        Variable().Replace(texte, m => valeurs is not null && valeurs.TryGetValue(m.Groups[1].Value, out var v) ? EnTexte(v) : "");

    /// <summary>Développe les références $t(cle) ; inconnue : conservée ; cycle : exception.</summary>
    public string Developper(string texte, IReadOnlyList<string> chemin) => Reference().Replace(texte, m =>
    {
        var cle = m.Groups[1].Value;
        if (chemin.Contains(cle) || chemin.Count >= ProfondeurMax)
            throw new InvalidOperationException($"Référence circulaire : {string.Join(" → ", chemin.Append(cle))}");
        var v = ValeurBrute(cle);
        return v is null ? m.Value : Developper(v, [.. chemin, cle]);
    });

    /// <summary>Texte d'une clé ; absente : <paramref name="defaut"/> (interpolé), sinon la clé.</summary>
    public string Texte(string cle, IReadOnlyDictionary<string, object?>? valeurs = null, string? defaut = null)
    {
        var v = ValeurBrute(cle);
        if (v is null) return defaut is null ? cle : Interpoler(defaut, valeurs);
        return Interpoler(Developper(v, [cle]), valeurs);
    }

    /// <summary>Clé effective d'un pluriel : cle_zero (si elle existe et nombre = 0), cle_un, cle_autre, sinon la clé.</summary>
    public string ClePluriel(string cle, decimal nombre)
    {
        if (nombre == 0 && Existe($"{cle}_zero")) return $"{cle}_zero";
        var suffixe = Math.Abs(nombre) < 2 ? "_un" : "_autre";
        return Existe(cle + suffixe) ? cle + suffixe : cle;
    }

    /// <summary>Texte au pluriel : {{nombre}} vaut le nombre, sauf si les valeurs le donnent.</summary>
    public string Pluriel(string cle, decimal nombre, IReadOnlyDictionary<string, object?>? valeurs = null)
    {
        var tout = new Dictionary<string, object?> { ["nombre"] = nombre };
        if (valeurs is not null) foreach (var (k, v) in valeurs) tout[k] = v;
        return Texte(ClePluriel(cle, nombre), tout);
    }

    /// <summary>Fusion profonde des couches (programme, installation, société) : la dernière l'emporte, clé par clé.</summary>
    public static JsonObject Fusionner(params JsonNode?[] couches)
    {
        var res = new JsonObject();
        foreach (var c in couches)
        {
            if (c is not JsonObject o) continue;
            foreach (var (k, v) in o)
            {
                if (v is JsonObject sous) res[k] = Fusionner(res[k] as JsonObject, sous);
                else res[k] = v?.DeepClone();
            }
        }
        return res;
    }
}
