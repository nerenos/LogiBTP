using System.Globalization;
using LogiBTP.Socle;

namespace LogiBTP.Metres.Script;

/// <summary>Valeur typée du langage de script : N numérique, C chaîne, B booléen.</summary>
public readonly record struct Valeur(char Type, decimal Nombre, string Texte, bool Booleen)
{
    public static Valeur N(decimal v) => new('N', v, "", false);
    public static Valeur C(string v) => new('C', 0, v, false);
    public static Valeur B(bool v) => new('B', 0, "", v);

    public static string NomType(char type) => type switch { 'N' => "numérique", 'C' => "chaîne", _ => "booléen" };

    /// <summary>Valeur d'une donnée ou d'une variable de l'hôte (décimal, chaîne ou booléen ; null = 0).</summary>
    public static Valeur Typer(object? v) => v switch
    {
        null => N(0),
        string s => C(s),
        bool b => B(b),
        decimal d => N(d),
        int or long or short or byte or double or float => N(Convert.ToDecimal(v, CultureInfo.InvariantCulture)),
        // Dates transportées en chaîne ISO, comme côté JS.
        DateOnly d => C(d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
        _ => throw new ErreurCalcul("NON_NUMERIQUE", "Donnée non utilisable dans un script (ni nombre, ni chaîne, ni booléen)"),
    };

    /// <summary>Valeur exposée : décimal arrondi à 6 décimales, chaîne ou booléen.</summary>
    public object Exposer() => Type switch { 'N' => ArrondiCalcul.Arr6(Nombre), 'C' => Texte, _ => Booleen };

    /// <summary>Texte dans une concaténation : nombre en virgule décimale, Vrai / Faux.</summary>
    public string EnTexte() => Type switch { 'C' => Texte, 'B' => Booleen ? "Vrai" : "Faux", _ => ArrondiCalcul.FormatNombre(Nombre) };
}
