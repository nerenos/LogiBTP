using System.Text;
using System.Text.RegularExpressions;

namespace LogiBTP.Documents;

/// <summary>Numéro lu : année du numéro (null si le format n'en porte pas) et rang.</summary>
public sealed record NumeroLu(int? Annee, int Rang);

/// <summary>
/// Format du numéro légal d'un type de document (tyd_format_numero) : jetons {P} (préfixe du type), {AAAA} ou {AA}
/// (année de l'exercice), {N} ou {N:k} (rang, sur k chiffres au moins) ; le reste est littéral. Sans format :
/// {P}{AAAA}-{N:5} (DV2026-00012). Le rang est remis à zéro chaque exercice (tyd_raz_numero A) ou jamais (J) ;
/// une remise annuelle exige l'année dans le numéro.
/// </summary>
public static partial class NumeroDocument
{
    public const string FormatDefaut = "{P}{AAAA}-{N:5}";

    [GeneratedRegex(@"\{(P|AAAA|AA|N(?::([1-9]))?)\}")]
    private static partial Regex Jetons();

    /// <summary>Exercice du compteur : l'année, ou 0 pour un rang jamais remis à zéro (J).</summary>
    public static int Exercice(string? raz, int annee) => raz == "J" ? 0 : annee;

    private static string Effectif(string? format) => string.IsNullOrWhiteSpace(format) ? FormatDefaut : format.Trim();

    /// <summary>Message d'erreur du format, null s'il est valable.</summary>
    public static string? Controler(string? format, string raz)
    {
        var f = Effectif(format);
        if (f.Length > 40) return "Format de 40 caractères au plus";
        var jetons = Jetons().Matches(f).Select(m => m.Groups[1].Value).ToList();
        if (Jetons().Replace(f, "").Contains('{') || Jetons().Replace(f, "").Contains('}')) return "Jeton inconnu : {P}, {AAAA}, {AA}, {N} ou {N:k} seulement";
        if (jetons.Count(j => j.StartsWith('N')) != 1) return "Le format porte un rang {N} (ou {N:k}), une seule fois";
        if (jetons.Count(j => j is "AAAA" or "AA") > 1) return "Une seule année dans le format";
        if (raz == "A" && !jetons.Any(j => j is "AAAA" or "AA")) return "Rang remis à zéro chaque exercice : l'année ({AAAA} ou {AA}) doit figurer dans le numéro";
        return null;
    }

    /// <summary>Numéro d'un rang pour l'année donnée.</summary>
    public static string Formater(string? format, string? prefixe, int annee, int rang) =>
        Jetons().Replace(Effectif(format), m => m.Groups[1].Value switch
        {
            "P" => prefixe ?? "",
            "AAAA" => annee.ToString("0000", System.Globalization.CultureInfo.InvariantCulture),
            "AA" => (annee % 100).ToString("00", System.Globalization.CultureInfo.InvariantCulture),
            _ => rang.ToString(new string('0', m.Groups[2].Success ? int.Parse(m.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture) : 1), System.Globalization.CultureInfo.InvariantCulture),
        });

    /// <summary>Année et rang d'un numéro au format, null s'il ne le suit pas (rang nul refusé).</summary>
    public static NumeroLu? Lire(string? format, string? prefixe, string? numero)
    {
        if (string.IsNullOrWhiteSpace(numero)) return null;
        var motif = new StringBuilder("^");
        var f = Effectif(format);
        var i = 0;
        foreach (Match m in Jetons().Matches(f))
        {
            motif.Append(Regex.Escape(f[i..m.Index]));
            motif.Append(m.Groups[1].Value switch
            {
                "P" => Regex.Escape(prefixe ?? ""),
                "AAAA" => @"(?<a>\d{4})",
                "AA" => @"(?<aa>\d{2})",
                _ => @"(?<n>\d{1,9})",
            });
            i = m.Index + m.Length;
        }
        motif.Append(Regex.Escape(f[i..])).Append('$');
        var r = Regex.Match(numero.Trim(), motif.ToString());
        if (!r.Success) return null;
        var rang = int.Parse(r.Groups["n"].Value, System.Globalization.CultureInfo.InvariantCulture);
        if (rang <= 0) return null;
        int? annee = r.Groups["a"].Success ? int.Parse(r.Groups["a"].Value, System.Globalization.CultureInfo.InvariantCulture)
            : r.Groups["aa"].Success ? 2000 + int.Parse(r.Groups["aa"].Value, System.Globalization.CultureInfo.InvariantCulture) : null;
        return new NumeroLu(annee, rang);
    }

    /// <summary>
    /// Début commun des numéros (filtre des numéros pris) : jusqu'au rang, l'année remplacée (numéros d'un exercice) ;
    /// sans l'année (<paramref name="annee"/> null : compteur jamais remis à zéro), jusqu'au premier jeton variable.
    /// </summary>
    public static string Debut(string? format, string? prefixe, int? annee)
    {
        var f = Effectif(format);
        var m = Jetons().Matches(f).FirstOrDefault(x => x.Groups[1].Value.StartsWith('N') || (annee is null && x.Groups[1].Value is "AAAA" or "AA"));
        return Formater(m is null ? f : f[..m.Index], prefixe, annee ?? 0, 0);
    }
}
