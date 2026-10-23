using System.Net;
using System.Text.RegularExpressions;

namespace LogiBTP.Mail;

/// <summary>Adresse de courriel saisie : adresse et nom affiché.</summary>
public sealed record AdresseSaisie(string Adresse, string? Nom = null);

/// <summary>Adresses de courriel (contrôle simple, domaine, liste saisie) et gabarits des modèles ({{variable}}).</summary>
public static partial class Adresses
{
    [GeneratedRegex(@"^[^@\s<>,;""]+@[^@\s<>,;""]+\.[^@\s<>,;""]{2,}$")]
    private static partial Regex Forme();

    [GeneratedRegex(@"^\s*""?([^""<]*?)""?\s*<([^>]+)>\s*$")]
    private static partial Regex AvecNom();

    [GeneratedRegex(@"\{\{\s*([A-Za-z0-9_.]+)\s*\}\}")]
    private static partial Regex Variable();

    public static string Normaliser(string? adresse) => (adresse ?? "").Trim().ToLowerInvariant();

    public static bool Valide(string? adresse) => !string.IsNullOrWhiteSpace(adresse) && adresse.Length <= 254 && Forme().IsMatch(adresse.Trim());

    public static string Domaine(string adresse)
    {
        var i = adresse.LastIndexOf('@');
        return i < 0 ? "" : Normaliser(adresse[(i + 1)..]);
    }

    /// <summary>
    /// Liste saisie « Nom &lt;a@b.fr&gt;, c@d.fr ; … » : adresses valides dédoublonnées (sans casse) et textes refusés.
    /// </summary>
    public static (List<AdresseSaisie> Valides, List<string> Refusees) Analyser(string? texte)
    {
        var valides = new List<AdresseSaisie>();
        var refusees = new List<string>();
        foreach (var brut in (texte ?? "").Split([',', ';', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var m = AvecNom().Match(brut);
            var (nom, adresse) = m.Success ? (m.Groups[1].Value.Trim(), m.Groups[2].Value.Trim()) : (null, brut);
            if (!Valide(adresse)) refusees.Add(brut);
            else if (valides.All(v => Normaliser(v.Adresse) != Normaliser(adresse))) valides.Add(new AdresseSaisie(adresse, string.IsNullOrEmpty(nom) ? null : nom));
        }
        return (valides, refusees);
    }

    /// <summary>Remplit un gabarit : {{nom}} remplacé par sa valeur (échappée en HTML si demandé) ; variable inconnue : vide.</summary>
    public static string Remplir(string gabarit, IReadOnlyDictionary<string, string?> variables, bool html) =>
        Variable().Replace(gabarit ?? "", m =>
        {
            var v = variables.TryGetValue(m.Groups[1].Value, out var x) ? x ?? "" : "";
            return html ? WebUtility.HtmlEncode(v) : v;
        });

    /// <summary>Variables citées par un gabarit.</summary>
    public static List<string> Variables(string gabarit) => Variable().Matches(gabarit ?? "").Select(m => m.Groups[1].Value).Distinct().ToList();
}
