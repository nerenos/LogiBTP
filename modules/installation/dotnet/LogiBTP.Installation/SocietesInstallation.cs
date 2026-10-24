using System.Text.Json;
using System.Text.Json.Nodes;

namespace LogiBTP.Installation;

/// <summary>
/// Déclaration des sociétés de l'installation (societes.json du dossier de configuration, ANALYSE-MODULE-INSTALLATION.md
/// § 6.4) : section « Societes » lue par l'API (domaines de base, libellé de la base principale, codes et libellés des
/// sociétés). Aucune chaîne de connexion : la base d'une société se déduit de son code (ModeleConnexion).
/// </summary>
public static class SocietesInstallation
{
    private static readonly JsonSerializerOptions Ecriture = new() { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    /// <summary>Code de société : minuscules, chiffres et tiret (sous-domaine), 2 à 30 caractères, jamais « www ».</summary>
    public static string VerifierCode(string code)
    {
        var c = (code ?? "").Trim().ToLowerInvariant();
        if (c.Length is < 2 or > 30 || c == "www" || !char.IsAsciiLetterLower(c[0]) || !c.All(x => char.IsAsciiLetterLower(x) || char.IsAsciiDigit(x) || x == '-') || c.EndsWith('-'))
            throw new ArgumentException($"Code de société invalide : « {code} » (2 à 30 minuscules, chiffres ou tirets, commence par une lettre)");
        return c;
    }

    /// <summary>Nom de la base d'une société : le tiret du sous-domaine devient « _ ».</summary>
    public static string CodeBase(string code) => VerifierCode(code).Replace('-', '_');

    public static JsonObject Lire(string chemin) =>
        File.Exists(chemin) ? JsonNode.Parse(File.ReadAllText(chemin)) as JsonObject ?? new JsonObject() : new JsonObject();

    private static JsonObject Section(JsonObject racine) => racine["Societes"] as JsonObject ?? (JsonObject)(racine["Societes"] = new JsonObject());

    /// <summary>Ajoute le domaine de l'installation (et localhost) aux domaines de base ; libellé de la base principale.</summary>
    public static JsonObject Preparer(JsonObject racine, string domaine, string? libellePrincipale)
    {
        var s = Section(racine);
        var domaines = (s["Domaines"] as JsonArray)?.Select(d => d!.GetValue<string>()).ToList() ?? [];
        foreach (var d in new[] { "localhost", domaine.Trim().ToLowerInvariant() })
            if (!domaines.Contains(d, StringComparer.OrdinalIgnoreCase)) domaines.Add(d);
        s["Domaines"] = new JsonArray(domaines.Select(d => (JsonNode)JsonValue.Create(d)!).ToArray());
        if (!string.IsNullOrWhiteSpace(libellePrincipale)) s["LibellePrincipale"] = libellePrincipale.Trim();
        s["Liste"] ??= new JsonObject();
        return racine;
    }

    /// <summary>Déclare une société (code du sous-domaine, libellé) ; une société existante garde ses réglages, son libellé est mis à jour.</summary>
    public static JsonObject Ajouter(JsonObject racine, string code, string? libelle)
    {
        var c = VerifierCode(code);
        var liste = Section(racine)["Liste"] as JsonObject ?? (JsonObject)(Section(racine)["Liste"] = new JsonObject());
        var societe = liste[c] as JsonObject ?? (JsonObject)(liste[c] = new JsonObject());
        societe["Libelle"] = string.IsNullOrWhiteSpace(libelle) ? societe["Libelle"]?.GetValue<string>() ?? c.ToUpperInvariant() : libelle.Trim();
        return racine;
    }

    public static IReadOnlyList<(string Code, string Libelle)> Societes(JsonObject racine) =>
        (Section(racine)["Liste"] as JsonObject)?.Select(p => (p.Key, (p.Value as JsonObject)?["Libelle"]?.GetValue<string>() ?? p.Key)).ToList() ?? [];

    public static void Ecrire(string chemin, JsonObject racine) => File.WriteAllText(chemin, racine.ToJsonString(Ecriture) + Environment.NewLine);
}
