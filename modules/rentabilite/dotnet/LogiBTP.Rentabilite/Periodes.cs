using System.Globalization;
using System.Text.RegularExpressions;

namespace LogiBTP.Rentabilite;

/// <summary>Résultat de la lecture d'une borne : date (null : vide) ou code d'erreur.</summary>
public sealed record BorneLue(DateOnly? Date, string? Erreur);

/// <summary>
/// Lecture des périodes (ANALYSE-MODULE-ANALYSE.md § 5.3), répliquée de js/src/periodes.js (jeu tests/cas/01_periodes.json) :
/// « AAAA » = année, « MM/AAAA » = mois, sinon une date à saisie abrégée (règles de completerDate du socle) ; une année
/// ou un mois donnent leur premier jour en début de période, leur dernier jour en fin.
/// </summary>
public static partial class Periodes
{
    [GeneratedRegex(@"^(\d{4})$")] private static partial Regex Annee();
    [GeneratedRegex(@"^(\d{1,2})[/.\-\s](\d{4})$")] private static partial Regex Mois();
    [GeneratedRegex(@"^([+-])\s*(\d{1,4})$")] private static partial Regex Decalage();
    [GeneratedRegex(@"^(\d{4})-(\d{1,2})-(\d{1,2})$")] private static partial Regex Iso();
    [GeneratedRegex(@"^\d+$")] private static partial Regex Chiffres();
    [GeneratedRegex(@"[/.\-\s]+")] private static partial Regex Separateurs();
    [GeneratedRegex(@"^\d{1,4}$")] private static partial Regex Partie();

    private static DateOnly Premier(int a, int m) => new(a, m, 1);
    private static DateOnly Dernier(int a, int m) => new(a, m, DateTime.DaysInMonth(a, m));

    public static BorneLue Lire(string? texte, string borne, DateOnly reference)
    {
        var s = (texte ?? "").Trim();
        if (s.Length == 0) return new(null, null);
        var fin = borne == BornePeriode.Fin;
        if (Annee().Match(s) is { Success: true } an)
        {
            var a = int.Parse(an.Groups[1].Value, CultureInfo.InvariantCulture);
            if (a < 1) return new(null, ErreurPeriode.Date);
            return new(fin ? Dernier(a, 12) : Premier(a, 1), null);
        }
        if (Mois().Match(s) is { Success: true } mo)
        {
            var m = int.Parse(mo.Groups[1].Value, CultureInfo.InvariantCulture);
            var a = int.Parse(mo.Groups[2].Value, CultureInfo.InvariantCulture);
            if (m is < 1 or > 12 || a < 1) return new(null, ErreurPeriode.Date);
            return new(fin ? Dernier(a, m) : Premier(a, m), null);
        }
        return CompleterDate(s, reference) is { } d ? new(d, null) : new(null, ErreurPeriode.Date);
    }

    /// <summary>Début après la fin : code d'erreur, sinon null.</summary>
    public static string? Controler(DateOnly? du, DateOnly? au) => du is { } d && au is { } f && d > f ? ErreurPeriode.Ordre : null;

    /// <summary>Bornes d'un raccourci (null : depuis l'origine, ou jusqu'à aujourd'hui inclus) ; code inconnu : null.</summary>
    public static (DateOnly? Du, DateOnly? Au)? Raccourci(string code, DateOnly reference)
    {
        var (a, m) = (reference.Year, reference.Month);
        switch (code)
        {
            case RaccourciPeriode.Mois: return (Premier(a, m), Dernier(a, m));
            case RaccourciPeriode.MoisPrecedent:
                var p = Premier(a, m).AddMonths(-1);
                return (Premier(p.Year, p.Month), Dernier(p.Year, p.Month));
            case RaccourciPeriode.Exercice: return (Premier(a, 1), Dernier(a, 12));
            case RaccourciPeriode.Origine: return (null, null);
            default: return null;
        }
    }

    /// <summary>Saisie abrégée d'une date, mêmes règles que completerDate du socle (JS) : null si elle ne désigne aucune date.</summary>
    public static DateOnly? CompleterDate(string saisie, DateOnly reference)
    {
        var s = saisie.Trim().ToLowerInvariant();
        if (s.Length == 0) return null;
        if (s is "t" or "a") return reference;
        if (Decalage().Match(s) is { Success: true } dec)
            return reference.AddDays((dec.Groups[1].Value == "-" ? -1 : 1) * int.Parse(dec.Groups[2].Value, CultureInfo.InvariantCulture));
        string[] parts;
        if (Iso().Match(s) is { Success: true } iso) parts = [iso.Groups[3].Value, iso.Groups[2].Value, iso.Groups[1].Value];
        else if (Chiffres().IsMatch(s))
        {
            parts = s.Length switch
            {
                <= 2 => [s],
                4 => [s[..2], s[2..]],
                6 or 8 => [s[..2], s[2..4], s[4..]],
                _ => [],
            };
            if (parts.Length == 0) return null;
        }
        else
        {
            parts = Separateurs().Split(s);
            if (parts.Length > 3 || parts.Any(p => !Partie().IsMatch(p))) return null;
        }
        var j = int.Parse(parts[0], CultureInfo.InvariantCulture);
        var mois = parts.Length > 1 ? int.Parse(parts[1], CultureInfo.InvariantCulture) : reference.Month;
        var annee = reference.Year;
        if (parts.Length > 2)
        {
            if (parts[2].Length > 4) return null;
            annee = int.Parse(parts[2], CultureInfo.InvariantCulture);
            if (annee < 100) annee += annee > reference.Year % 100 + 10 ? 1900 : 2000;
        }
        if (parts.Length > 1 && parts[1].Length > 2) return null;
        if (parts[0].Length > 2) return null;
        if (mois is < 1 or > 12 || annee < 1 || j < 1 || j > DateTime.DaysInMonth(annee, mois)) return null;
        return new DateOnly(annee, mois, j);
    }
}
