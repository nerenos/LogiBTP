using System.Security.Cryptography;
using System.Text;

namespace LogiBTP.Authentification;

/// <summary>
/// Empreinte des mots de passe : PBKDF2-SHA256, sel aléatoire de 16 octets, nombre d'itérations porté par l'empreinte
/// (format <c>pbkdf2-sha256$itérations$sel$empreinte</c>, base64) : le réglage peut évoluer, une empreinte ancienne
/// reste vérifiable et <see cref="AReprendre"/> dit qu'il faut la recalculer à la prochaine connexion.
/// </summary>
public static class HachageMotDePasse
{
    public const int IterationsParDefaut = 210_000;
    private const string Prefixe = "pbkdf2-sha256";

    public static string Hacher(string mdp, int iterations = IterationsParDefaut)
    {
        var sel = RandomNumberGenerator.GetBytes(16);
        var empreinte = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(mdp), sel, iterations, HashAlgorithmName.SHA256, 32);
        return $"{Prefixe}${iterations}${Convert.ToBase64String(sel)}${Convert.ToBase64String(empreinte)}";
    }

    /// <summary>Vérification en temps constant ; une empreinte mal formée ne correspond à rien.</summary>
    public static bool Verifier(string mdp, string? hash)
    {
        var p = (hash ?? "").Split('$');
        if (p.Length != 4 || p[0] != Prefixe || !int.TryParse(p[1], out var iterations) || iterations < 1) return false;
        try
        {
            var sel = Convert.FromBase64String(p[2]);
            var attendu = Convert.FromBase64String(p[3]);
            var obtenu = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(mdp), sel, iterations, HashAlgorithmName.SHA256, attendu.Length);
            return CryptographicOperations.FixedTimeEquals(obtenu, attendu);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    /// <summary>Empreinte calculée avec moins d'itérations que le réglage courant : à refaire après une connexion réussie.</summary>
    public static bool AReprendre(string? hash, int iterations = IterationsParDefaut)
    {
        var p = (hash ?? "").Split('$');
        return p.Length != 4 || !int.TryParse(p[1], out var n) || n < iterations;
    }

    /// <summary>Mot de passe provisoire lisible (sans caractères ambigus), à recopier une fois.</summary>
    public static string Provisoire(int longueur = 16)
    {
        const string alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
        var s = new StringBuilder();
        for (var i = 0; i < longueur; i++)
        {
            if (i > 0 && i % 4 == 0) s.Append('-');
            s.Append(alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)]);
        }
        return s.ToString();
    }

    /// <summary>Jeton de session (32 octets aléatoires, base64 URL) et son empreinte SHA-256 (seule conservée en base).</summary>
    public static (string Jeton, string Empreinte) NouveauJeton()
    {
        var jeton = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return (jeton, Empreinte(jeton));
    }

    public static string Empreinte(string jeton) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(jeton)));
}
