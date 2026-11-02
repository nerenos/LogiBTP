using System.Globalization;
using System.Text.RegularExpressions;

namespace LogiBTP.Rentabilite;

/// <summary>Mois d'une prévision de facturation tel qu'envoyé par l'interface (valeur en texte « 12.5 »).</summary>
public sealed record LigneFacturation(string? Mois, string? Mode, string? Valeur);

/// <summary>Erreur d'une prévision : rang de la ligne, mois, code (<see cref="ErreurFacturation"/>).</summary>
public sealed record ErreurLigneFacturation(int Index, string? Mois, string Code);

/// <summary>
/// Prévisionnel de facturation (ANALYSE-MODULE-ANALYSE.md § 10.2, lot 7), répliqué dans js/src/facturation.js (jeu
/// tests/cas/02_facturation.json) : montant prévu d'un mois (montant saisi ou % du budget PV, arrondi à 2 décimales,
/// demi vers l'infini) et contrôle d'une prévision (une erreur au plus par ligne).
/// </summary>
public static partial class Facturation
{
    [GeneratedRegex(@"^-?\d+(\.\d+)?$")]
    private static partial Regex Nombre();

    [GeneratedRegex(@"^(\d{4})-(\d{2})-01$")]
    private static partial Regex Mois();

    /// <summary>Valeur saisie lue (format invariant « 12.5 ») ; null si elle n'est pas un nombre.</summary>
    public static decimal? Lire(string? valeur) =>
        valeur is not null && Nombre().IsMatch(valeur) ? decimal.Parse(valeur, NumberStyles.Number, CultureInfo.InvariantCulture) : null;

    /// <summary>Montant prévu d'une valeur : montant, ou % du budget PV ; arrondi à 2 décimales.</summary>
    public static decimal Montant(string mode, decimal valeur, decimal budget) =>
        Math.Round(mode == ModeFacturation.Pourcent ? budget * valeur / 100m : valeur, 2, MidpointRounding.AwayFromZero);

    /// <summary>Contrôle d'une prévision : mois « AAAA-MM-01 », doublon, mode, valeur numérique, pourcentage sans budget.</summary>
    public static List<ErreurLigneFacturation> Controler(IReadOnlyList<LigneFacturation> lignes, decimal budget)
    {
        var erreurs = new List<ErreurLigneFacturation>();
        var vus = new HashSet<string>();
        for (var i = 0; i < lignes.Count; i++)
        {
            var l = lignes[i];
            var m = Mois().Match(l.Mois ?? "");
            string? code = null;
            if (!m.Success || int.Parse(m.Groups[2].Value) is < 1 or > 12) code = ErreurFacturation.Mois;
            else if (vus.Contains(l.Mois!)) code = ErreurFacturation.Doublon;
            else if (l.Mode is not (ModeFacturation.Montant or ModeFacturation.Pourcent)) code = ErreurFacturation.Mode;
            else if (Lire(l.Valeur) is null) code = ErreurFacturation.Valeur;
            else if (l.Mode == ModeFacturation.Pourcent && budget == 0) code = ErreurFacturation.Budget;
            if (m.Success) vus.Add(l.Mois!);
            if (code is not null) erreurs.Add(new(i, l.Mois, code));
        }
        return erreurs;
    }
}
