using System.Security.Cryptography;
using System.Text;

namespace LogiBTP.Socle;

/// <summary>
/// Chiffrement symétrique des valeurs secrètes stockées en base (mots de passe des fiches…) : AES-256-GCM, clé dérivée
/// de la chaîne unique de l'installation (PBKDF2-SHA256). Valeur chiffrée : « chiffre:v1:&lt;base64(nonce | tag | texte)&gt; ».
/// Sans chaîne configurée, tout chiffrement ou déchiffrement est refusé (une valeur non chiffrée est rendue telle quelle).
/// Chaîne de l'installation : LOGIBTP_CLE_CHIFFREMENT (.env). Rotation (module Installation, « installation cle-donnees
/// changer ») : les chaînes précédentes (LOGIBTP_CLE_CHIFFREMENT_PRECEDENTES) servent encore à déchiffrer tant que toutes
/// les valeurs ne sont pas rechiffrées ; on chiffre et on calcule les empreintes toujours par la chaîne courante.
/// </summary>
public sealed class Chiffrement
{
    public const string Prefixe = "chiffre:v1:";
    private static readonly byte[] Sel = Encoding.UTF8.GetBytes("LogiBTP.Chiffrement.v1");
    private static readonly byte[] SelEmpreinte = Encoding.UTF8.GetBytes("LogiBTP.Empreinte.v1");
    private readonly byte[]? cle;
    private readonly byte[]? cleEmpreinte;
    private readonly List<byte[]> precedentes = [];

    public Chiffrement(string? chaine, IEnumerable<string>? chainesPrecedentes = null)
    {
        if (string.IsNullOrWhiteSpace(chaine)) return;
        cle = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(chaine), Sel, 100_000, HashAlgorithmName.SHA256, 32);
        cleEmpreinte = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(chaine), SelEmpreinte, 100_000, HashAlgorithmName.SHA256, 32);
        foreach (var p in chainesPrecedentes ?? [])
            if (!string.IsNullOrWhiteSpace(p) && p != chaine) precedentes.Add(Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(p), Sel, 100_000, HashAlgorithmName.SHA256, 32));
    }

    /// <summary>Chaînes précédentes d'une variable « a,b » (LOGIBTP_CLE_CHIFFREMENT_PRECEDENTES).</summary>
    public static IEnumerable<string> Liste(string? v) => (v ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    /// <summary>
    /// Empreinte stable d'une valeur chiffrée par ailleurs (HMAC-SHA256 par une clé dérivée de la chaîne de l'installation,
    /// hexadécimal minuscule) : comparer ou retrouver une adresse sans la déchiffrer. La valeur est normalisée (espaces
    /// retirés, minuscules) ; null ou vide : null.
    /// </summary>
    public string? Empreinte(string? valeur)
    {
        if (string.IsNullOrWhiteSpace(valeur)) return null;
        var c = cleEmpreinte ?? throw new ErreurChiffrement("Chiffrement non configuré : définir la chaîne de l'installation (LOGIBTP_CLE_CHIFFREMENT dans .env)");
        return Convert.ToHexStringLower(HMACSHA256.HashData(c, Encoding.UTF8.GetBytes(valeur.Trim().ToLowerInvariant())));
    }

    public bool EstConfigure => cle is not null;

    public static bool EstChiffre(string? valeur) => valeur?.StartsWith(Prefixe, StringComparison.Ordinal) == true;

    private byte[] Cle => cle ?? throw new ErreurChiffrement("Chiffrement non configuré : définir la chaîne de l'installation (LOGIBTP_CLE_CHIFFREMENT dans .env)");

    /// <summary>Texte chiffré (nonce aléatoire : deux chiffrements d'un même texte diffèrent) ; null ou vide : inchangé.</summary>
    public string? Chiffrer(string? texte)
    {
        if (string.IsNullOrEmpty(texte) || EstChiffre(texte)) return texte;
        var clair = Encoding.UTF8.GetBytes(texte);
        var tampon = new byte[12 + 16 + clair.Length];
        var nonce = tampon.AsSpan(0, 12);
        RandomNumberGenerator.Fill(nonce);
        using var aes = new AesGcm(Cle, 16);
        aes.Encrypt(nonce, clair, tampon.AsSpan(28), tampon.AsSpan(12, 16));
        return Prefixe + Convert.ToBase64String(tampon);
    }

    /// <summary>Texte en clair ; une valeur non chiffrée (saisie antérieure) est rendue telle quelle.</summary>
    public string? Dechiffrer(string? valeur)
    {
        if (!EstChiffre(valeur)) return valeur;
        byte[] tampon;
        try
        {
            tampon = Convert.FromBase64String(valeur![Prefixe.Length..]);
        }
        catch (FormatException)
        {
            throw new ErreurChiffrement("Valeur chiffrée illisible");
        }
        if (tampon.Length < 28) throw new ErreurChiffrement("Valeur chiffrée illisible");
        var clair = new byte[tampon.Length - 28];
        foreach (var k in precedentes.Prepend(Cle))
        {
            try
            {
                using var aes = new AesGcm(k, 16);
                aes.Decrypt(tampon.AsSpan(0, 12), tampon.AsSpan(28), tampon.AsSpan(12, 16), clair);
                return Encoding.UTF8.GetString(clair);
            }
            catch (AuthenticationTagMismatchException) { }
        }
        throw new ErreurChiffrement("Déchiffrement impossible : la chaîne de l'installation a changé ou la valeur est altérée");
    }
}

public sealed class ErreurChiffrement(string message) : Exception(message);
