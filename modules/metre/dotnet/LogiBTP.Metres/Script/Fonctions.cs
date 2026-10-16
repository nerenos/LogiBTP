using LogiBTP.Socle;

namespace LogiBTP.Metres.Script;

/// <summary>Fonction du langage : nombre d'arguments (Max null = illimité), signature et description (aide), calcul.</summary>
public sealed record FonctionScript(int Min, int? Max, string Signature, string Description, Func<IReadOnlyList<Valeur>, Valeur> Appliquer);

/// <summary>
/// Fonctions du langage de script (réplique de script/fonctions.js). Clé : nom normalisé (minuscules sans accents).
/// Un hôte ajoute les siennes par <see cref="ContexteScript.Fonctions"/>.
/// </summary>
public static class Fonctions
{
    /// <summary>Valeur numérique d'un argument, sinon erreur TYPE.</summary>
    public static decimal Nombre(Valeur v, string quoi) =>
        v.Type == 'N' ? v.Nombre : throw new ErreurCalcul("TYPE", $"{quoi} : numérique attendu");

    /// <summary>Nombre entier d'un argument (nombre de décimales, exposant), sinon erreur ARGUMENTS.</summary>
    private static int Entier(Valeur v, string quoi, int min, int max)
    {
        var d = Nombre(v, quoi);
        if (d != decimal.Truncate(d) || d < min || d > max) throw new ErreurCalcul("ARGUMENTS", $"{quoi} : entier de {min} à {max} attendu");
        return (int)d;
    }

    private static Func<IReadOnlyList<Valeur>, Valeur> UnNombre(string nom, Func<decimal, decimal> f) =>
        args => Valeur.N(f(Nombre(args[0], nom)));

    public static readonly IReadOnlyDictionary<string, FonctionScript> Catalogue = new Dictionary<string, FonctionScript>
    {
        ["entiersuperieur"] = new(1, 1, "EntierSupérieur(x)", "Plus petit entier supérieur ou égal à x",
            UnNombre("EntierSupérieur", Math.Ceiling)),
        ["entierinferieur"] = new(1, 1, "EntierInférieur(x)", "Plus grand entier inférieur ou égal à x",
            UnNombre("EntierInférieur", Math.Floor)),
        ["arrondi"] = new(1, 2, "Arrondi(x; décimales)", "Arrondi demi vers l'infini (0 décimale par défaut)",
            args => Valeur.N(ArrondiCalcul.Arrondir(Nombre(args[0], "Arrondi"), args.Count > 1 ? Entier(args[1], "Arrondi, décimales", 0, 10) : 0))),
        ["tronque"] = new(1, 2, "Tronque(x; décimales)", "Troncature vers zéro (0 décimale par défaut)",
            args => Valeur.N(Math.Round(Nombre(args[0], "Tronque"), args.Count > 1 ? Entier(args[1], "Tronque, décimales", 0, 10) : 0, MidpointRounding.ToZero))),
        ["min"] = new(1, null, "Min(a; b; …)", "Plus petite des valeurs",
            args => Valeur.N(args.Select(a => Nombre(a, "Min")).Aggregate((m, x) => x < m ? x : m))),
        ["max"] = new(1, null, "Max(a; b; …)", "Plus grande des valeurs",
            args => Valeur.N(args.Select(a => Nombre(a, "Max")).Aggregate((m, x) => x > m ? x : m))),
        ["abs"] = new(1, 1, "Abs(x)", "Valeur absolue", UnNombre("Abs", Math.Abs)),
        ["racine"] = new(1, 1, "Racine(x)", "Racine carrée", UnNombre("Racine", ArrondiCalcul.Racine)),
        ["puissance"] = new(2, 2, "Puissance(x; n)", "x à la puissance n (n entier de -100 à 100)", args =>
        {
            var x = Nombre(args[0], "Puissance");
            var n = Entier(args[1], "Puissance, exposant", -100, 100);
            if (x == 0 && n < 0) throw new ErreurCalcul("DIVISION_ZERO", "Division par zéro");
            var r = 1m;
            try
            {
                for (var k = 0; k < Math.Abs(n); k++) r *= x;
            }
            catch (OverflowException)
            {
                throw new ErreurCalcul("DEPASSEMENT", "Valeur trop grande");
            }
            // Inverse d'une puissance devenue nulle (moins de 28 décimales) : dépassement, comme côté JS.
            if (n < 0 && Math.Abs(r) < 1e-28m) throw new ErreurCalcul("DEPASSEMENT", "Valeur trop grande");
            return Valeur.N(n < 0 ? 1m / r : r);
        }),
        ["taille"] = new(1, 1, "Taille(chaîne)", "Nombre de caractères", args =>
            args[0].Type == 'C' ? Valeur.N(args[0].Texte.Length) : throw new ErreurCalcul("TYPE", "Taille : chaîne attendue")),
    };
}
