using System.Globalization;

namespace LogiBTP.Socle;

/// <summary>
/// Arrondi commercial unique du moteur (arrondir() côté JS) : demi vers l'infini,
/// jamais l'arrondi bancaire par défaut de .NET.
/// </summary>
public static class ArrondiCalcul
{
    public static decimal Arrondir(decimal valeur, int precision) =>
        Math.Round(valeur, precision, MidpointRounding.AwayFromZero);

    /// <summary>Précision de stockage NUMERIC(18,6).</summary>
    public static decimal Arr6(decimal valeur) => Arrondir(valeur, 6);

    /// <summary>Racine carrée décimale (méthode de Newton), decimal n'en ayant pas.</summary>
    public static decimal Racine(decimal x)
    {
        if (x < 0) throw new ErreurCalcul("RACINE_NEGATIVE", "Racine d'un nombre négatif");
        if (x == 0) return 0;
        var g = (decimal)Math.Sqrt((double)x);
        for (var i = 0; i < 20; i++)
        {
            var n = (g + x / g) / 2;
            if (n == g) break;
            g = n;
        }
        return g;
    }

    /// <summary>Format des nombres dans les libellés : virgule décimale, zéros non significatifs retirés.</summary>
    public static string FormatNombre(decimal v)
    {
        var s = v.ToString(CultureInfo.InvariantCulture);
        if (s.Contains('.')) s = s.TrimEnd('0').TrimEnd('.');
        if (s == "-0") s = "0";
        return s.Replace('.', ',');
    }
}
