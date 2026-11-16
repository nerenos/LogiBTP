using System.Globalization;
using LogiBTP.Socle;

namespace LogiBTP.Import.Reprise;

/// <summary>
/// Lecture seule d'une base source (SQL Server pour MDE, MariaDB pour OPTIM : implémentations du lot 2). Les requêtes
/// sont des textes constants, les valeurs passent en paramètres ; un lecteur refuse toute requête qui n'est pas une
/// lecture.
/// </summary>
public interface ILecteurSource : IAsyncDisposable
{
    /// <summary>Logiciel de la base lue (<see cref="SourceReprise"/>).</summary>
    string Source { get; }

    /// <summary>Tables présentes dans la base source.</summary>
    Task<IReadOnlyList<string>> TablesAsync(CancellationToken ct);

    /// <summary>Nombre de lignes d'une table (le nom doit figurer dans <see cref="TablesAsync"/>).</summary>
    Task<long> CompterAsync(string table, CancellationToken ct);

    /// <summary>Lignes d'une requête de lecture, en flux.</summary>
    IAsyncEnumerable<LigneSource> LireAsync(string requete, IReadOnlyDictionary<string, object?>? parametres, CancellationToken ct);
}

/// <summary>
/// Ligne lue d'une base source, colonnes sans distinction de casse. Les sources stockent l'absence par une chaîne vide
/// ou 0 dans des colonnes NOT NULL : <see cref="Texte"/> rend null pour une chaîne vide ou blanche, <see cref="Id"/> pour
/// 0. Un nombre à virgule flottante est converti une seule fois en décimal, par l'arrondi unique à 6 décimales.
/// </summary>
public sealed class LigneSource(IReadOnlyDictionary<string, object?> valeurs)
{
    /// <summary>Précision des décimaux tirés d'une source (montants, quantités, coefficients).</summary>
    public const int Precision = 6;

    private readonly Dictionary<string, object?> valeurs = new(valeurs, StringComparer.OrdinalIgnoreCase);

    public IEnumerable<string> Colonnes => valeurs.Keys;

    /// <summary>Valeur brute (DBNull rendu null) ; colonne absente : exception (faute de la requête).</summary>
    public object? Brut(string colonne) =>
        valeurs.TryGetValue(colonne, out var v)
            ? v is DBNull ? null : v
            : throw new KeyNotFoundException($"Colonne absente de la ligne source : {colonne}");

    public bool Contient(string colonne) => valeurs.ContainsKey(colonne);

    /// <summary>Texte sans les espaces de fin (colonnes char), null si vide ou blanc.</summary>
    public string? Texte(string colonne) => Brut(colonne) switch
    {
        null => null,
        string s => string.IsNullOrWhiteSpace(s) ? null : s.TrimEnd(),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        var v => v.ToString(),
    };

    /// <summary>Décimal (null si absent) ; double et float arrondis à <see cref="Precision"/> décimales.</summary>
    public decimal? Decimal(string colonne) => Brut(colonne) switch
    {
        null => null,
        decimal d => d,
        double d => ArrondiCalcul.Arrondir((decimal)d, Precision),
        float f => ArrondiCalcul.Arrondir((decimal)f, Precision),
        string s when string.IsNullOrWhiteSpace(s) => null,
        string s => decimal.Parse(s, NumberStyles.Number, CultureInfo.InvariantCulture),
        var v => Convert.ToDecimal(v, CultureInfo.InvariantCulture),
    };

    /// <summary>Entier (null si absent).</summary>
    public long? Entier(string colonne) => Brut(colonne) switch
    {
        null => null,
        string s when string.IsNullOrWhiteSpace(s) => null,
        var v => Convert.ToInt64(v, CultureInfo.InvariantCulture),
    };

    /// <summary>Identifiant de rattachement : null si absent ou nul (0 = aucun lien dans les sources).</summary>
    public long? Id(string colonne) => Entier(colonne) is { } v && v != 0 ? v : null;

    /// <summary>Booléen : bit, tinyint, smallint ou int non nul = vrai ; null si absent.</summary>
    public bool? Booleen(string colonne) => Brut(colonne) switch
    {
        null => null,
        bool b => b,
        var v => Convert.ToInt64(v, CultureInfo.InvariantCulture) != 0,
    };

    /// <summary>Date et heure (null si absente ou au 01/01/1900, valeur « vide » des sources).</summary>
    public DateTime? Date(string colonne) => Brut(colonne) switch
    {
        null => null,
        DateTime d when d.Year <= 1900 => null,
        DateTime d => d,
        DateOnly d => d.Year <= 1900 ? null : d.ToDateTime(TimeOnly.MinValue),
        DateTimeOffset d => d.DateTime,
        var v => throw new InvalidCastException($"{colonne} : date attendue ({v.GetType().Name})"),
    };
}
