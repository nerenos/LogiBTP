using System.Globalization;
using System.Numerics;
using System.Text;
using System.Text.RegularExpressions;

namespace LogiBTP.Fiches;

/// <summary>Code lu : année du code (null si le format n'en porte pas) et rang.</summary>
public sealed record CodeLu(int? Annee, int Rang);

/// <summary>
/// Chrono du code d'une fiche, même règle que chrono.js (jeu partagé modules/fiche/tests/cas/02_chrono.json). Format :
/// jetons {P} (préfixe), {AAAA} ou {AA} (année de l'exercice), {N} ou {N:k} (rang sur k chiffres au moins), {PARENT}
/// (code de la fiche parente : rang = plus grand rang des codes du parent + 1, sans compteur) ; le reste est littéral.
/// Remise à zéro chaque exercice (A, l'année doit figurer dans le code) ou jamais (J).
/// </summary>
public static partial class ChronoFiche
{
    public const string FormatDefaut = "{P}{N:6}";

    [GeneratedRegex(@"\{(P|AAAA|AA|PARENT|N(?::([1-9]))?)\}")]
    private static partial Regex Jetons();

    [GeneratedRegex(@"(\d+)$")]
    private static partial Regex NombreFinal();

    private static string Effectif(string? format) => string.IsNullOrWhiteSpace(format) ? FormatDefaut : format.Trim();

    /// <summary>Exercice du compteur : l'année, ou 0 pour un rang jamais remis à zéro (J).</summary>
    public static int Exercice(string? raz, int annee) => raz == "J" ? 0 : annee;

    /// <summary>Message d'erreur du format, null s'il est valable.</summary>
    public static string? Controler(string? format, string? raz)
    {
        var f = Effectif(format);
        if (f.Length > 40) return "Format de 40 caractères au plus";
        var jetons = Jetons().Matches(f).Select(m => m.Groups[1].Value).ToList();
        var reste = Jetons().Replace(f, "");
        if (reste.Contains('{') || reste.Contains('}')) return "Jeton inconnu : {P}, {AAAA}, {AA}, {N}, {N:k} ou {PARENT} seulement";
        if (jetons.Count(j => j.StartsWith('N')) != 1) return "Le format porte un rang {N} (ou {N:k}), une seule fois";
        if (jetons.Count(j => j is "AAAA" or "AA") > 1) return "Une seule année dans le format";
        if (jetons.Count(j => j == "PARENT") > 1) return "Un seul {PARENT} dans le format";
        if (raz == "A" && !jetons.Any(j => j is "AAAA" or "AA")) return "Rang remis à zéro chaque exercice : l'année ({AAAA} ou {AA}) doit figurer dans le code";
        return null;
    }

    /// <summary>Le format porte-t-il {PARENT} (rang calculé sur les codes du parent, sans compteur) ?</summary>
    public static bool AParent(string? format) => Jetons().Matches(Effectif(format)).Any(m => m.Groups[1].Value == "PARENT");

    /// <summary>Code d'un rang pour l'année (et le parent) donnés.</summary>
    public static string Formater(string? format, string? prefixe, int annee, int rang, string? parent = null) =>
        Jetons().Replace(Effectif(format), m => m.Groups[1].Value switch
        {
            "P" => prefixe ?? "",
            "AAAA" => annee.ToString("0000", CultureInfo.InvariantCulture),
            "AA" => (annee % 100).ToString("00", CultureInfo.InvariantCulture),
            "PARENT" => parent ?? "",
            _ => rang.ToString(new string('0', m.Groups[2].Success ? int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture) : 1), CultureInfo.InvariantCulture),
        });

    /// <summary>Année et rang d'un code au format, null s'il ne le suit pas (rang nul refusé).</summary>
    public static CodeLu? Lire(string? format, string? prefixe, string? code, string? parent = null)
    {
        if (string.IsNullOrWhiteSpace(code)) return null;
        var motif = new StringBuilder("^");
        var f = Effectif(format);
        var i = 0;
        foreach (Match m in Jetons().Matches(f))
        {
            motif.Append(Regex.Escape(f[i..m.Index]));
            motif.Append(m.Groups[1].Value switch
            {
                "P" => Regex.Escape(prefixe ?? ""),
                "PARENT" => Regex.Escape(parent ?? ""),
                "AAAA" => @"(?<a>\d{4})",
                "AA" => @"(?<aa>\d{2})",
                _ => @"(?<n>\d{1,9})",
            });
            i = m.Index + m.Length;
        }
        motif.Append(Regex.Escape(f[i..])).Append('$');
        var r = Regex.Match(code.Trim(), motif.ToString());
        if (!r.Success) return null;
        var rang = int.Parse(r.Groups["n"].Value, CultureInfo.InvariantCulture);
        if (rang <= 0) return null;
        int? annee = r.Groups["a"].Success ? int.Parse(r.Groups["a"].Value, CultureInfo.InvariantCulture)
            : r.Groups["aa"].Success ? 2000 + int.Parse(r.Groups["aa"].Value, CultureInfo.InvariantCulture) : null;
        return new CodeLu(annee, rang);
    }

    /// <summary>
    /// Début commun des codes (filtre des codes pris) : jusqu'au rang, l'année remplacée (codes d'un exercice) ; sans
    /// année (<paramref name="annee"/> null : compteur jamais remis à zéro), jusqu'au premier jeton variable.
    /// </summary>
    public static string Debut(string? format, string? prefixe, int? annee, string? parent = null)
    {
        var f = Effectif(format);
        var m = Jetons().Matches(f).FirstOrDefault(x => x.Groups[1].Value.StartsWith('N') || (annee is null && x.Groups[1].Value is "AAAA" or "AA"));
        return Formater(m is null ? f : f[..m.Index], prefixe, annee ?? 0, 0, parent);
    }

    /// <summary>
    /// Code suivant une saisie déjà prise : nombre final augmenté de 1 sur la même longueur (CH-2026-010 → CH-2026-011,
    /// 099 → 100), sinon « 1 » ajouté (DUPONT → DUPONT1, puis DUPONT2…).
    /// </summary>
    public static string? Suivant(string? code)
    {
        var s = (code ?? "").Trim();
        if (s.Length == 0) return null;
        var m = NombreFinal().Match(s);
        if (!m.Success) return s + "1";
        var n = (BigInteger.Parse(m.Value, CultureInfo.InvariantCulture) + 1).ToString(CultureInfo.InvariantCulture);
        return s[..m.Index] + n.PadLeft(m.Value.Length, '0');
    }
}
