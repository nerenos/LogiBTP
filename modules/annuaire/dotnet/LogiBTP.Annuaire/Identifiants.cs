using System.Text.RegularExpressions;

namespace LogiBTP.Annuaire;

/// <summary>Erreur de saisie d'un identifiant (code stable : SIREN, SIRET, SIRET_SIREN, TVA, TVA_SIREN, IBAN, BIC, PAYS).</summary>
public sealed record ErreurIdentifiant(string Champ, string Code, string Message);

/// <summary>Identifiants soumis aux contrôles d'une personne (valeurs saisies).</summary>
public sealed record ValeursIdentifiants(string? Pays, string? Siren, string? Siret, string? TvaIntra, string? Iban, string? Bic);

/// <summary>
/// Identifiants des personnes (facturation électronique, règlement) : SIREN, SIRET, TVA intracommunautaire, IBAN, BIC.
/// Réplique de modules/annuaire/js/src/identifiants.js (jeu partagé 01_identifiants.json).
/// </summary>
public static partial class Identifiants
{
    [GeneratedRegex(@"[\s.\-/]")]
    private static partial Regex Separateurs();

    /// <summary>Texte sans espaces, points, tirets ni barres, en majuscules.</summary>
    public static string Compacter(string? v) => Separateurs().Replace(v ?? "", "").ToUpperInvariant();

    private static bool Vide(string? v) => string.IsNullOrWhiteSpace(v);

    private static bool Chiffres(string s, int n) => s.Length == n && s.All(char.IsAsciiDigit);

    /// <summary>Clé de Luhn valide.</summary>
    public static bool Luhn(string chiffres)
    {
        if (chiffres.Length == 0 || !chiffres.All(char.IsAsciiDigit)) return false;
        var somme = 0;
        for (var i = 0; i < chiffres.Length; i++)
        {
            var n = chiffres[chiffres.Length - 1 - i] - '0';
            if (i % 2 == 1) { n *= 2; if (n > 9) n -= 9; }
            somme += n;
        }
        return somme % 10 == 0;
    }

    /// <summary>SIREN : 9 chiffres, clé de Luhn (La Poste, 356000000, fait exception).</summary>
    public static bool SirenValide(string s) => Chiffres(s, 9) && (s == "356000000" || Luhn(s));

    /// <summary>SIRET : 14 chiffres, clé de Luhn (La Poste : somme des chiffres multiple de 5, sauf le siège).</summary>
    public static bool SiretValide(string s)
    {
        if (!Chiffres(s, 14)) return false;
        if (s.StartsWith("356000000", StringComparison.Ordinal)) return s == "35600000000048" || s.Sum(c => c - '0') % 5 == 0;
        return Luhn(s);
    }

    /// <summary>Clé de TVA française d'un SIREN : (12 + 3 × (SIREN mod 97)) mod 97, sur 2 chiffres.</summary>
    public static string CleTva(string siren) => ((12 + 3 * (long.Parse(siren) % 97)) % 97).ToString("00");

    public static string? TvaDepuisSiren(string siren) => SirenValide(siren) ? $"FR{CleTva(siren)}{siren}" : null;

    public static readonly IReadOnlySet<string> PaysTva = new HashSet<string>
    {
        "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "XI",
    };

    [GeneratedRegex("^FR([0-9A-Z]{2})([0-9]{9})$")]
    private static partial Regex TvaFr();

    [GeneratedRegex(@"^[0-9A-Z+*]{2,13}$")]
    private static partial Regex TvaAutre();

    public static bool TvaValide(string? tva)
    {
        var t = Compacter(tva);
        if (t.StartsWith("FR", StringComparison.Ordinal))
        {
            var m = TvaFr().Match(t);
            if (!m.Success) return false;
            return !Chiffres(m.Groups[1].Value, 2) || m.Groups[1].Value == CleTva(m.Groups[2].Value);
        }
        return t.Length >= 2 && PaysTva.Contains(t[..2]) && TvaAutre().IsMatch(t[2..]);
    }

    [GeneratedRegex("^[A-Z]{2}[0-9]{2}[0-9A-Z]{11,30}$")]
    private static partial Regex FormatIban();

    /// <summary>IBAN : 15 à 34 caractères, pays, clé modulo 97 (= 1).</summary>
    public static bool IbanValide(string? iban)
    {
        var t = Compacter(iban);
        if (!FormatIban().IsMatch(t)) return false;
        var reste = 0;
        foreach (var c in t[4..] + t[..4])
        {
            var n = char.IsAsciiDigit(c) ? c.ToString() : (c - 55).ToString();
            foreach (var d in n) reste = (reste * 10 + (d - '0')) % 97;
        }
        return reste == 1;
    }

    [GeneratedRegex("^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$")]
    private static partial Regex FormatBic();

    public static bool BicValide(string? bic) => FormatBic().IsMatch(Compacter(bic));

    [GeneratedRegex(@"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")]
    private static partial Regex FormatEmail();

    public static bool EmailValide(string? v) => FormatEmail().IsMatch((v ?? "").Trim());

    public static readonly IReadOnlyDictionary<string, string> Messages = new Dictionary<string, string>
    {
        ["SIREN"] = "SIREN invalide (9 chiffres, clé de contrôle)",
        ["SIRET"] = "SIRET invalide (14 chiffres, clé de contrôle)",
        ["SIRET_SIREN"] = "Le SIRET ne commence pas par le SIREN",
        ["TVA"] = "Numéro de TVA intracommunautaire invalide",
        ["TVA_SIREN"] = "Le numéro de TVA ne correspond pas au SIREN",
        ["IBAN"] = "IBAN invalide",
        ["BIC"] = "BIC invalide",
        ["PAYS"] = "Code pays sur 2 lettres (ISO)",
    };

    [GeneratedRegex("^[A-Z]{2}$")]
    private static partial Regex CodePays();

    /// <summary>Contrôles des identifiants d'une personne (même ordre que erreursIdentifiants).</summary>
    public static List<ErreurIdentifiant> Erreurs(ValeursIdentifiants v)
    {
        var erreurs = new List<ErreurIdentifiant>();
        void E(string champ, string code) => erreurs.Add(new(champ, code, Messages[code]));
        var pays = Vide(v.Pays) ? "FR" : v.Pays!.Trim().ToUpperInvariant();
        if (!CodePays().IsMatch(pays)) E("pays", "PAYS");
        string siren = Compacter(v.Siren), siret = Compacter(v.Siret);
        if (!Vide(v.Siren) && !SirenValide(siren)) E("siren", "SIREN");
        if (!Vide(v.Siret))
        {
            if (!SiretValide(siret)) E("siret", "SIRET");
            else if (!Vide(v.Siren) && SirenValide(siren) && !siret.StartsWith(siren, StringComparison.Ordinal)) E("siret", "SIRET_SIREN");
        }
        if (!Vide(v.TvaIntra))
        {
            var tva = Compacter(v.TvaIntra);
            var base_ = SirenValide(siren) ? siren : SiretValide(siret) ? siret[..9] : null;
            if (!TvaValide(tva)) E("tva_intra", "TVA");
            else if (tva.StartsWith("FR", StringComparison.Ordinal) && base_ is not null && tva[4..] != base_) E("tva_intra", "TVA_SIREN");
        }
        if (!Vide(v.Iban) && !IbanValide(v.Iban)) E("iban", "IBAN");
        if (!Vide(v.Bic) && !BicValide(v.Bic)) E("bic", "BIC");
        return erreurs;
    }
}
