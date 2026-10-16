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
    public static IConfigurationBuilder AjouterFichierEnv(this IConfigurationBuilder config, string dossier, int niveaux = 4)
    {
        var d = new DirectoryInfo(dossier);
        for (var i = 0; d is not null && i <= niveaux; i++, d = d.Parent)
        {
            var chemin = Path.Combine(d.FullName, ".env");
            if (!File.Exists(chemin)) continue;
            config.AddInMemoryCollection(LireEnv(File.ReadAllLines(chemin)));
            config.AddEnvironmentVariables();
            break;
        }
        return config;
    }

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
