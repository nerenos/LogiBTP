using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Socle.Web;

/// <summary>Fichier .env (secrets de l'installation hors du dépôt) et service de chiffrement.</summary>
public static class ExtensionsConfiguration
{
    public const string CleChiffrement = "LOGIBTP_CLE_CHIFFREMENT";

    /// <summary>
    /// Variables « NOM=valeur » du premier fichier .env trouvé en remontant depuis le dossier donné (dossier de
    /// l'application, puis ses parents jusqu'à la racine du dépôt). Lignes vides et commentaires (#) ignorés, guillemets
    /// retirés. Les variables d'environnement du système restent prioritaires.
    /// </summary>
    public static IConfigurationBuilder AjouterFichierEnv(this IConfigurationBuilder config, string dossier, int niveaux = 4, string? cleEnv = null)
    {
        if (CheminEnv(dossier, niveaux) is { } chemin)
        {
            config.AddInMemoryCollection(Dechiffrer(LireEnv(File.ReadAllLines(chemin)), cleEnv));
            config.AddEnvironmentVariables();
        }
        return config;
    }

    /// <summary>
    /// Connexions déduites du modèle de l'installation (<see cref="ModeleConnexion"/> : LOGIBTP_BASE_HOTE…, rôle
    /// LOGIBTP_BASE_UTILISATEUR, logibtp_app par défaut, mot de passe LOGIBTP_BASE_MOT_DE_PASSE_APP) : base principale
    /// si ConnectionStrings:LogiBTP est vide, base de chaque société de Societes:Liste sans Connexion. À appeler après
    /// le .env et la déclaration des sociétés ; sans LOGIBTP_BASE_HOTE, rien ne change.
    /// </summary>
    public static void AjouterConnexionsModele(this ConfigurationManager config)
    {
        if (ModeleConnexion.Lire(k => config[k]) is not { } m) return;
        var utilisateur = string.IsNullOrWhiteSpace(config["LOGIBTP_BASE_UTILISATEUR"]) ? "logibtp_app" : config["LOGIBTP_BASE_UTILISATEUR"]!;
        var mdp = config["LOGIBTP_BASE_MOT_DE_PASSE_APP"];
        var ajouts = new Dictionary<string, string?>();
        if (string.IsNullOrWhiteSpace(config.GetConnectionString("LogiBTP"))) ajouts["ConnectionStrings:LogiBTP"] = m.Chaine(m.NomBase(null), utilisateur, mdp);
        foreach (var s in config.GetSection("Societes:Liste").GetChildren())
        {
            if (string.IsNullOrWhiteSpace(s["Connexion"])) ajouts[$"Societes:Liste:{s.Key}:Connexion"] = m.Chaine(m.NomBase(s.Key), utilisateur, mdp);
        }
        if (ajouts.Count > 0) config.AddInMemoryCollection(ajouts);
    }

    /// <summary>Premier fichier .env en remontant depuis le dossier (null : aucun).</summary>
    public static string? CheminEnv(string dossier, int niveaux = 4)
    {
        var d = new DirectoryInfo(dossier);
        for (var i = 0; d is not null && i <= niveaux; i++, d = d.Parent)
        {
            var chemin = Path.Combine(d.FullName, ".env");
            if (File.Exists(chemin)) return chemin;
        }
        return null;
    }

    // ---------------------------------------------------------------- chiffrement du .env (D22, D25)

    public const string PrefixeEnv = "env:v1:";

    /// <summary>
    /// Variables sensibles chiffrées dans le .env : mots de passe, clés, secrets, jetons, chaînes de connexion. Les
    /// réglages (déploiement, proxys, origines, niveau de journal) restent lisibles.
    /// </summary>
    public static bool Sensible(string nom) =>
        nom.StartsWith("ConnectionStrings", StringComparison.OrdinalIgnoreCase)
        || new[] { "CLE", "MOT_DE_PASSE", "SECRET", "PASSWORD", "JETON", "TOKEN" }.Any(m => nom.Contains(m, StringComparison.OrdinalIgnoreCase));

    private static byte[] Cle(string cleEnv) => SHA256.HashData(Encoding.UTF8.GetBytes(cleEnv));

    /// <summary>Valeur chiffrée par la clé du .env (AES-256-GCM) : « env:v1: » + base64(nonce | texte chiffré | étiquette).</summary>
    public static string ChiffrerValeur(string valeur, string cleEnv)
    {
        var nonce = RandomNumberGenerator.GetBytes(12);
        var clair = Encoding.UTF8.GetBytes(valeur);
        var chiffre = new byte[clair.Length];
        var etiquette = new byte[16];
        using (var aes = new AesGcm(Cle(cleEnv), 16)) aes.Encrypt(nonce, clair, chiffre, etiquette);
        return PrefixeEnv + Convert.ToBase64String([.. nonce, .. chiffre, .. etiquette]);
    }

    public static string DechiffrerValeur(string valeur, string cleEnv)
    {
        var o = Convert.FromBase64String(valeur[PrefixeEnv.Length..]);
        if (o.Length < 28) throw new InvalidOperationException(".env : valeur chiffrée illisible");
        var clair = new byte[o.Length - 28];
        try
        {
            using var aes = new AesGcm(Cle(cleEnv), 16);
            aes.Decrypt(o[..12], o[12..^16], o[^16..], clair);
        }
        catch (CryptographicException)
        {
            throw new InvalidOperationException(".env : valeur chiffrée par une autre clé de construction (binaires d'une autre origine) : recopier le .env en clair puis le rechiffrer");
        }
        return Encoding.UTF8.GetString(clair);
    }

    /// <summary>Valeurs « env:v1: » déchiffrées par la clé des binaires ; sans clé, une valeur chiffrée est une erreur.</summary>
    public static Dictionary<string, string?> Dechiffrer(Dictionary<string, string?> valeurs, string? cleEnv)
    {
        foreach (var (nom, v) in valeurs.ToList())
        {
            if (v is null || !v.StartsWith(PrefixeEnv, StringComparison.Ordinal)) continue;
            if (string.IsNullOrEmpty(cleEnv)) throw new InvalidOperationException($".env : {nom} est chiffrée mais ces binaires n'ont pas de clé de construction");
            valeurs[nom] = DechiffrerValeur(v, cleEnv);
        }
        return valeurs;
    }

    /// <summary>
    /// Lignes du .env avec les variables sensibles chiffrées (commentaires, ordre et valeurs déjà chiffrées gardés) :
    /// commande « env chiffrer » du serveur.
    /// </summary>
    public static List<string> ChiffrerLignes(IEnumerable<string> lignes, string cleEnv) =>
        lignes.Select(brute =>
        {
            var l = brute.Trim();
            var i = l.IndexOf('=');
            if (l.Length == 0 || l.StartsWith('#') || i <= 0) return brute;
            var nom = l[..i].Trim();
            var v = l[(i + 1)..].Trim();
            if (v.Length >= 2 && (v[0] == '"' || v[0] == '\'') && v[^1] == v[0]) v = v[1..^1];
            return Sensible(nom) && v.Length > 0 && !v.StartsWith(PrefixeEnv, StringComparison.Ordinal) ? $"{nom}={ChiffrerValeur(v, cleEnv)}" : brute;
        }).ToList();

    public static Dictionary<string, string?> LireEnv(IEnumerable<string> lignes)
    {
        var res = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (var brute in lignes)
        {
            var l = brute.Trim();
            if (l.Length == 0 || l.StartsWith('#')) continue;
            var i = l.IndexOf('=');
            if (i <= 0) continue;
            var v = l[(i + 1)..].Trim();
            if (v.Length >= 2 && (v[0] == '"' || v[0] == '\'') && v[^1] == v[0]) v = v[1..^1];
            res[l[..i].Trim()] = v;
        }
        return res;
    }

    /// <summary>Chiffrement des valeurs secrètes par la chaîne unique de l'installation (LOGIBTP_CLE_CHIFFREMENT).</summary>
    public static IServiceCollection AddChiffrement(this IServiceCollection services, IConfiguration configuration) =>
        services.AddSingleton(new Chiffrement(configuration[CleChiffrement]));
}
