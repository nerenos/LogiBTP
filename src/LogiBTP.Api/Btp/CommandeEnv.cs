using System.Security.Cryptography;
using LogiBTP.Socle.Web;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Commande serveur du fichier .env (D22, D25, D28) : <c>env initialiser [LOCAL|INTERNET]</c> crée une configuration
/// neuve (clé des données, réglages de déploiement) si aucun .env n'existe, sinon le conserve ; <c>env chiffrer</c>
/// chiffre en place les valeurs sensibles par la clé de construction des binaires ; <c>env verifier</c> relit le fichier.
/// Aucune valeur n'est jamais affichée.
/// </summary>
public static class CommandeEnv
{
    public static int Executer(string[] args, string dossier, TextWriter sortie)
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        var action = args.Length > 0 ? args[0] : "";
        var chemin = ExtensionsConfiguration.CheminEnv(dossier);
        switch (action)
        {
            case "initialiser":
                if (chemin is not null)
                {
                    sortie.WriteLine($".env existant conservé : {chemin}");
                    return 0;
                }
                var deploiement = args.Length > 1 && args[1].Equals("INTERNET", StringComparison.OrdinalIgnoreCase) ? "INTERNET" : "LOCAL";
                chemin = Path.Combine(dossier, ".env");
                File.WriteAllLines(chemin, ExtensionsConfiguration.ChiffrerLignes(
                [
                    "# Configuration de l'installation LogiBTP (créée par « env initialiser »). Valeurs sensibles chiffrées par la clé des binaires.",
                    "# Déploiement : LOCAL (réseau local, TSE) ou INTERNET (serveur public : HSTS, double facteur depuis l'extérieur).",
                    $"LOGIBTP_DEPLOIEMENT={deploiement}",
                    "# Clé des données chiffrées en base : la perdre rend ces données illisibles ; sauvegarder ce fichier avec la base.",
                    $"{ExtensionsConfiguration.CleChiffrement}={Convert.ToBase64String(RandomNumberGenerator.GetBytes(48))}",
                    "# Réseau local et serveur TSE (CIDR, séparés par des virgules) : ni exclusion d'adresse, ni double facteur.",
                    "LOGIBTP_ADRESSES_CONFIANCE=",
                    "# Proxys inverses déclarés (seuls crus pour X-Forwarded-*), origines CORS permises (vide : même origine).",
                    "LOGIBTP_PROXYS=",
                    "LOGIBTP_CORS_ORIGINES=",
                    "# Niveau du journal technique (Error par défaut ; Warning, Information, Debug) : lu au démarrage.",
                    "LOGIBTP_JOURNAL_NIVEAU=Error",
                ], CleConstruction.Valeur));
                sortie.WriteLine($".env créé : {chemin} (déploiement {deploiement}) ; compléter la chaîne de connexion puis « env chiffrer »");
                return 0;
            case "chiffrer":
                if (chemin is null) return Erreur(sortie, "Aucun .env trouvé");
                var lignes = File.ReadAllLines(chemin);
                var chiffrees = ExtensionsConfiguration.ChiffrerLignes(lignes, CleConstruction.Valeur);
                var n = lignes.Zip(chiffrees).Count(x => x.First != x.Second);
                File.WriteAllLines(chemin, chiffrees);
                sortie.WriteLine($"{n} valeur(s) chiffrée(s) dans {chemin}");
                return 0;
            case "verifier":
                if (chemin is null) return Erreur(sortie, "Aucun .env trouvé");
                try
                {
                    var valeurs = ExtensionsConfiguration.LireEnv(File.ReadAllLines(chemin));
                    var chiffres = valeurs.Count(v => v.Value?.StartsWith(ExtensionsConfiguration.PrefixeEnv, StringComparison.Ordinal) == true);
                    ExtensionsConfiguration.Dechiffrer(valeurs, CleConstruction.Valeur);
                    var enClair = valeurs.Count(v => ExtensionsConfiguration.Sensible(v.Key) && !string.IsNullOrEmpty(v.Value)) - chiffres;
                    sortie.WriteLine($"{chemin} : {valeurs.Count} variable(s), {chiffres} chiffrée(s) lisible(s)" + (enClair > 0 ? $", {enClair} sensible(s) en clair (« env chiffrer »)" : ""));
                    return 0;
                }
                catch (InvalidOperationException e)
                {
                    return Erreur(sortie, e.Message);
                }
            default:
                return Erreur(sortie, "Usage : env initialiser [LOCAL|INTERNET] | env chiffrer | env verifier");
        }
    }

    private static int Erreur(TextWriter sortie, string message)
    {
        sortie.WriteLine(message);
        return 1;
    }
}
