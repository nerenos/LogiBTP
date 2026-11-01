using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle;

namespace LogiBTP.Personnalisation.Web;

/// <summary>Fichier de personnalisation prêt à servir : contenu, type et empreinte (ETag).</summary>
public sealed record FichierPersonnalisation(byte[] Contenu, string Type, string Empreinte);

/// <summary>
/// Fichiers de personnalisation du client (ANALYSE-MODULE-PERSONNALISATION.md § 6.3) : ceux du programme
/// (wwwroot/personnalisation, produits par la construction du client) surchargés par ceux de l'installation
/// (dossier LOGIBTP_PERSONNALISATION, par défaut {LOGIBTP_CONFIG}/personnalisation) :
/// <list type="bullet">
/// <item>fr.json et images/icones.json : fusion profonde (l'installation ne donne que les clés changées) ;
///   _meta.version de fr.json = empreinte du résultat (adresses des images relues quand la personnalisation change) ;</item>
/// <item>theme.css : celui du programme puis celui de l'installation (ses variables l'emportent) ;</item>
/// <item>autres fichiers de images/ : celui de l'installation s'il existe, sinon celui du programme.</item>
/// </list>
/// Hors des bases : une installation, une personnalisation (par société : phase 2, en base). Résultats gardés tant que
/// les fichiers sources ne changent pas (date et taille).
/// </summary>
public sealed class FichiersPersonnalisation(string dossierProgramme, string? dossierInstallation)
{
    public const string Dictionnaire = "fr.json";
    public const string Icones = "images/icones.json";
    public const string Theme = "theme.css";

    private readonly ConcurrentDictionary<string, (string Signature, FichierPersonnalisation Fichier)> _cache = new();

    public string DossierProgramme { get; } = dossierProgramme;
    public string? DossierInstallation { get; } = dossierInstallation;

    /// <summary>Chemin sûr d'un fichier relatif sous un dossier, ou null (remontée « .. », chemin absolu, absent).</summary>
    public static string? Chemin(string? dossier, string relatif)
    {
        if (string.IsNullOrEmpty(dossier) || string.IsNullOrWhiteSpace(relatif) || Path.IsPathRooted(relatif)) return null;
        var racine = Path.GetFullPath(dossier);
        var complet = Path.GetFullPath(Path.Combine(racine, relatif));
        if (!complet.StartsWith(racine.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.Ordinal)) return null;
        return File.Exists(complet) ? complet : null;
    }

    private static string Signature(params string?[] fichiers) => string.Join("|", fichiers.Select(f =>
    {
        if (f is null) return "-";
        var i = new FileInfo(f);
        return $"{i.FullName}:{i.Length}:{i.LastWriteTimeUtc.Ticks}";
    }));

    private static string Empreinte(byte[] contenu) => Convert.ToHexStringLower(SHA256.HashData(contenu))[..16];

    private static string TypeDe(string relatif) => Path.GetExtension(relatif).ToLowerInvariant() switch
    {
        ".json" => "application/json; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".webp" => "image/webp",
        ".gif" => "image/gif",
        ".ico" => "image/x-icon",
        _ => "application/octet-stream",
    };

    private static JsonObject? LireJson(string? fichier) => fichier is null ? null : JsonNode.Parse(File.ReadAllText(fichier)) as JsonObject;

    /// <summary>Fichier composé (chemin relatif à /personnalisation/), ou null s'il n'existe ni dans le programme ni dans l'installation.</summary>
    public FichierPersonnalisation? Lire(string relatif)
    {
        relatif = relatif.Replace('\\', '/').TrimStart('/');
        var programme = Chemin(DossierProgramme, relatif);
        var installation = Chemin(DossierInstallation, relatif);
        if (programme is null && installation is null) return null;
        var signature = Signature(programme, installation);
        if (_cache.TryGetValue(relatif, out var c) && c.Signature == signature) return c.Fichier;
        var fichier = Composer(relatif, programme, installation);
        _cache[relatif] = (signature, fichier);
        return fichier;
    }

    private static FichierPersonnalisation Composer(string relatif, string? programme, string? installation)
    {
        byte[] contenu;
        if (relatif is Dictionnaire or Icones && installation is not null)
        {
            var fusion = Socle.Dictionnaire.Fusionner(LireJson(programme), LireJson(installation));
            if (relatif == Dictionnaire)
            {
                // Version = empreinte du dictionnaire composé sans sa version (stable d'une lecture à l'autre).
                if (fusion["_meta"] is not JsonObject meta) fusion["_meta"] = meta = [];
                meta.Remove("version");
                meta["version"] = Empreinte(Encoding.UTF8.GetBytes(fusion.ToJsonString()));
            }
            contenu = JsonSerializer.SerializeToUtf8Bytes(fusion, new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
        }
        else if (relatif == Theme && installation is not null)
        {
            var texte = (programme is null ? "" : File.ReadAllText(programme) + "\n")
                + "/* Personnalisation de l'installation */\n" + File.ReadAllText(installation);
            contenu = Encoding.UTF8.GetBytes(texte);
        }
        else contenu = File.ReadAllBytes(installation ?? programme!);
        return new FichierPersonnalisation(contenu, TypeDe(relatif), $"\"{Empreinte(contenu)}\"");
    }
}
