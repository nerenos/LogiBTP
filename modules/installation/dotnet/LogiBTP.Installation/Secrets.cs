using System.Security.Cryptography;

namespace LogiBTP.Installation;

/// <summary>Secrets générés à l'installation (mots de passe des rôles PostgreSQL, clé des données).</summary>
public static class Secrets
{
    private const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

    /// <summary>
    /// Mot de passe aléatoire sans caractère ambigu ni caractère spécial (aucun échappement dans une chaîne de
    /// connexion, une commande ou un fichier) : 32 caractères de 57 symboles, environ 187 bits.
    /// </summary>
    public static string MotDePasse(int longueur = 32) => RandomNumberGenerator.GetString(Alphabet, longueur);

    /// <summary>Clé des données (LOGIBTP_CLE_CHIFFREMENT) : 48 octets aléatoires en base64.</summary>
    public static string CleDonnees() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
}
