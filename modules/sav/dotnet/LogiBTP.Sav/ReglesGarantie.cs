using System.Text.RegularExpressions;

namespace LogiBTP.Sav;

/// <summary>Garantie d'un équipement à une date : état, fin de garantie, jours restants (null hors garantie en cours).</summary>
public sealed record GarantieEquipement(string Etat, DateOnly? Fin, int? JoursRestants);

/// <summary>
/// Équipements installés (ANALYSE-MODULE-STOCK.md § 11, S24.8 ; plans/stock.md, lot 2), répliqué dans garantie.js (jeu
/// modules/sav/tests/cas/01_garantie.json) : numéro de série normalisé, fin de garantie (saisie, sinon pose + durée en
/// mois, veille de l'anniversaire, fin de mois ramenée), état de la garantie à une date, contrôle d'un équipement.
/// </summary>
public static partial class ReglesGarantie
{
    /// <summary>Durée de garantie la plus longue acceptée, en mois.</summary>
    public const int DureeMax = 600;

    public static readonly Dictionary<string, string> Messages = new()
    {
        ["SAV_NUMERO"] = "Numéro de série obligatoire",
        ["SAV_ARTICLE"] = "Article obligatoire",
        ["SAV_POSE_FUTURE"] = "Date de pose dans le futur",
        ["SAV_DUREE"] = "Durée de garantie de 0 à 600 mois",
        ["SAV_FIN_AVANT_POSE"] = "Fin de garantie avant la date de pose",
    };

    [GeneratedRegex(@"\s+")] private static partial Regex Espaces();

    /// <summary>Numéro de série normalisé (espaces de tête et de fin retirés, intérieurs réduits) ; null s'il est vide.</summary>
    public static string? Numero(string? numero) => string.IsNullOrWhiteSpace(numero) ? null : Espaces().Replace(numero.Trim(), " ");

    /// <summary>
    /// Fin de garantie (dernier jour couvert) : la fin saisie ; sinon, avec une pose et une durée en mois positive, la
    /// veille de l'anniversaire (pose + durée, fin de mois ramenée) ; sinon null.
    /// </summary>
    public static DateOnly? Fin(DateOnly? pose, int? dureeMois, DateOnly? finSaisie)
    {
        if (finSaisie is DateOnly f) return f;
        if (pose is not DateOnly p || dureeMois is not int n || n <= 0 || n > DureeMax) return null;
        return p.AddMonths(n).AddDays(-1);
    }

    /// <summary>État de la garantie à la date : SANS sans fin, EN_COURS jusqu'à la fin comprise, ECHUE après.</summary>
    public static GarantieEquipement Etat(DateOnly? pose, int? dureeMois, DateOnly? finSaisie, DateOnly date)
    {
        var fin = Fin(pose, dureeMois, finSaisie);
        if (fin is not DateOnly f) return new(EtatGarantie.Sans, null, null);
        if (date > f) return new(EtatGarantie.Echue, f, null);
        return new(EtatGarantie.EnCours, f, f.DayNumber - date.DayNumber);
    }

    /// <summary>
    /// Contrôle d'un équipement saisi : numéro vide (SAV_NUMERO), article absent (SAV_ARTICLE), pose après aujourd'hui
    /// (SAV_POSE_FUTURE), durée non entière ou hors de 0 à <see cref="DureeMax"/> mois (SAV_DUREE), fin saisie avant la
    /// pose (SAV_FIN_AVANT_POSE).
    /// </summary>
    public static List<string> Controler(string? numero, long? article, DateOnly? pose, decimal? dureeMois, DateOnly? finSaisie, DateOnly aujourdhui)
    {
        var erreurs = new List<string>();
        if (Numero(numero) is null) erreurs.Add("SAV_NUMERO");
        if (article is null) erreurs.Add("SAV_ARTICLE");
        if (pose is DateOnly p && p > aujourdhui) erreurs.Add("SAV_POSE_FUTURE");
        if (dureeMois is decimal d && (d != decimal.Truncate(d) || d < 0 || d > DureeMax)) erreurs.Add("SAV_DUREE");
        if (pose is DateOnly q && finSaisie is DateOnly f && f < q) erreurs.Add("SAV_FIN_AVANT_POSE");
        return erreurs;
    }
}
