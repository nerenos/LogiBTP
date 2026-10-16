using System.Security.Cryptography;
using System.Text;

namespace LogiBTP.Socle;

/// <summary>
/// Chiffrement symétrique des valeurs secrètes stockées en base (mots de passe des fiches…) : AES-256-GCM, clé dérivée
/// de la chaîne unique de l'installation (PBKDF2-SHA256). Valeur chiffrée : « chiffre:v1:&lt;base64(nonce | tag | texte)&gt; ».
/// Sans chaîne configurée, tout chiffrement ou déchiffrement est refusé (une valeur non chiffrée est rendue telle quelle).
/// La chaîne de l'installation sera gérée par un module à venir ; en attendant : variable LOGIBTP_CLE_CHIFFREMENT (.env).
/// </summary>
public sealed class Chiffrement
{
    public const string Prefixe = "chiffre:v1:";
    private static readonly byte[] Sel = Encoding.UTF8.GetBytes("LogiBTP.Chiffrement.v1");
    private readonly byte[]? cle;

    public Chiffrement(string? chaine)
    {
        if (!string.IsNullOrWhiteSpace(chaine))
            cle = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(chaine), Sel, 100_000, HashAlgorithmName.SHA256, 32);
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
        try
        {
            using var aes = new AesGcm(Cle, 16);
            aes.Decrypt(tampon.AsSpan(0, 12), tampon.AsSpan(28), tampon.AsSpan(12, 16), clair);
        }
        catch (AuthenticationTagMismatchException)
        {
            throw new ErreurChiffrement("Déchiffrement impossible : la chaîne de l'installation a changé ou la valeur est altérée");
        }
        return Encoding.UTF8.GetString(clair);
    }
}

public sealed class ErreurChiffrement(string message) : Exception(message);
