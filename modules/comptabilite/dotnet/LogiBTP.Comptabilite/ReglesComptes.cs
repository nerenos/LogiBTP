using System.Text.RegularExpressions;

namespace LogiBTP.Comptabilite;

public sealed record ResultatCompte(string? Code, string? Erreur);

/// <summary>
/// Règles des comptes comptables, répliquées dans comptes.js (jeu modules/comptabilite/tests/cas/01_comptes.json) :
/// compte général (chiffres, classe 1 à 9, longueur maximale ou complétion par des zéros à droite), compte de tiers
/// (lettres et chiffres, longueur maximale), compte de tiers proposé, classe d'un compte.
/// </summary>
public static partial class ReglesComptes
{
    /// <summary>Longueur maximale d'un compte de tiers quand aucune n'est paramétrée.</summary>
    public const int LongueurTiersMax = 17;

    public static readonly IReadOnlyDictionary<string, string> Messages = new Dictionary<string, string>
    {
        ["CPT_VIDE"] = "Compte vide",
        ["CPT_CARACTERES"] = "Un compte général ne contient que des chiffres",
        ["CPT_CLASSE"] = "Un compte général commence par un chiffre de 1 à 9 (classe)",
        ["CPT_LONGUEUR"] = "Compte trop long",
        ["CPT_TIERS_CARACTERES"] = "Un compte de tiers ne contient que des lettres et des chiffres",
    };

    [GeneratedRegex("^[0-9]+$")] private static partial Regex Chiffres();
    [GeneratedRegex("^[A-Z0-9]+$")] private static partial Regex Alphanumerique();
    [GeneratedRegex("[^A-Z0-9]")] private static partial Regex NonAlphanumerique();
    [GeneratedRegex("^[A-Z]+")] private static partial Regex LettresDeTete();

    private static ResultatCompte Ok(string code) => new(code, null);
    private static ResultatCompte Erreur(string erreur) => new(null, erreur);

    /// <summary>Compte général normalisé. longueur : maximale (null = libre) ; completerZeros : 704 → 70400000.</summary>
    public static ResultatCompte Normaliser(string? code, int? longueur, bool completerZeros)
    {
        var c = (code ?? "").Trim();
        if (c.Length == 0) return Erreur("CPT_VIDE");
        if (!Chiffres().IsMatch(c)) return Erreur("CPT_CARACTERES");
        if (c[0] == '0') return Erreur("CPT_CLASSE");
        if (longueur is int l && l > 0 && c.Length > l) return Erreur("CPT_LONGUEUR");
        return Ok(longueur is int n && n > 0 && completerZeros ? c.PadRight(n, '0') : c);
    }

    /// <summary>Compte de tiers (auxiliaire) normalisé : majuscules, lettres et chiffres, longueur maximale.</summary>
    public static ResultatCompte NormaliserTiers(string? code, int? longueur)
    {
        var c = (code ?? "").Trim().ToUpperInvariant();
        if (c.Length == 0) return Erreur("CPT_VIDE");
        if (!Alphanumerique().IsMatch(c)) return Erreur("CPT_TIERS_CARACTERES");
        if (c.Length > (longueur is int l && l > 0 ? l : LongueurTiersMax)) return Erreur("CPT_LONGUEUR");
        return Ok(c);
    }

    /// <summary>
    /// Compte de tiers proposé : préfixe + code du tiers sans ses lettres de tête ni ses séparateurs (T000123 → C000123) ;
    /// trop long : zéros de tête du code retirés autant qu'il le faut, sinon CPT_LONGUEUR.
    /// </summary>
    public static ResultatCompte Proposer(string? prefixe, string? codeTiers, int? longueur)
    {
        var p = NonAlphanumerique().Replace((prefixe ?? "").Trim().ToUpperInvariant(), "");
        var code = LettresDeTete().Replace(NonAlphanumerique().Replace((codeTiers ?? "").ToUpperInvariant(), ""), "");
        if (code.Length == 0) return Erreur("CPT_VIDE");
        var max = longueur is int l && l > 0 ? l : LongueurTiersMax;
        while ((p + code).Length > max && code.Length > 1 && code[0] == '0') code = code[1..];
        return NormaliserTiers(p + code, max);
    }

    /// <summary>Classe d'un compte (premier chiffre, 1 à 9) ou null.</summary>
    public static int? Classe(string? code)
    {
        var c = (code ?? "").Trim();
        return c.Length > 0 && c[0] is >= '1' and <= '9' ? c[0] - '0' : null;
    }
}
