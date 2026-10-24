using System.Text.RegularExpressions;

namespace LogiBTP.Socle;

/// <summary>
/// Masquage d'un texte destiné aux journaux (§ 3.7) : jamais de mot de passe, de jeton, de secret, de cookie de session,
/// de valeur citée par une erreur PostgreSQL (« Key (col)=(valeur) »), d'adresse de courriel ni de numéro de téléphone
/// ou de sécurité sociale. Appliqué par le journal technique avant toute écriture.
/// </summary>
public static partial class Masquage
{
    public const string Cache = "***";

    [GeneratedRegex(@"(Key \([^)]*\)=\()([^)]*)(\))", RegexOptions.IgnoreCase)]
    private static partial Regex ValeurPostgres();

    [GeneratedRegex(@"(?i)(""?(?:mot_de_passe|motdepasse|password|passwd|pwd|secret|jeton|token|rafraichissement|code|actuel|nouveau|cle|apikey|api_key)""?\s*[:=]\s*""?)([^""&;,\s}]+)")]
    private static partial Regex ChampSensible();

    [GeneratedRegex(@"(?i)\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/=]+")]
    private static partial Regex Autorisation();

    [GeneratedRegex(@"(?i)\b(logibtp_[a-z]+)=([^;\s]+)")]
    private static partial Regex Cookie();

    [GeneratedRegex(@"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")]
    private static partial Regex Jwt();

    [GeneratedRegex(@"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")]
    private static partial Regex Courriel();

    [GeneratedRegex(@"\b[12]\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{3}\s?\d{3}(\s?\d{2})?\b")]
    private static partial Regex Nir();

    [GeneratedRegex(@"(?<![\d.])(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}(?![\d.])")]
    private static partial Regex Telephone();

    [GeneratedRegex(@"chiffre:v1:[A-Za-z0-9+/=_-]+|env:v1:[A-Za-z0-9+/=_-]+")]
    private static partial Regex Chiffre();

    public static string? Texte(string? texte)
    {
        if (string.IsNullOrEmpty(texte)) return texte;
        var t = ValeurPostgres().Replace(texte, m => m.Groups[1].Value + Cache + m.Groups[3].Value);
        t = Autorisation().Replace(t, m => m.Groups[1].Value + " " + Cache);
        t = Cookie().Replace(t, m => m.Groups[1].Value + "=" + Cache);
        t = Jwt().Replace(t, Cache);
        t = Chiffre().Replace(t, Cache);
        t = ChampSensible().Replace(t, m => m.Groups[1].Value + Cache);
        t = Courriel().Replace(t, Cache);
        t = Nir().Replace(t, Cache);
        t = Telephone().Replace(t, Cache);
        return t;
    }
}
