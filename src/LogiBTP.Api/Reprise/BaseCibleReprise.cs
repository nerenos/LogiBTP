using Npgsql;

namespace LogiBTP.Api.Reprise;

/// <summary>
/// Base cible d'une reprise : une base neuve, sans données métier. Une base sans démonstration garde ses référentiels,
/// ses chantiers internes (INT-*) et ses affaires de gestion : seuls comptent les tiers, individus, salariés, matériels,
/// éléments de bibliothèque et pièces.
/// </summary>
public static class BaseCibleReprise
{
    private const string RequeteVide = """
        SELECT NOT EXISTS (SELECT 1 FROM personne)
           AND NOT EXISTS (SELECT 1 FROM individu)
           AND NOT EXISTS (SELECT 1 FROM salarie)
           AND NOT EXISTS (SELECT 1 FROM materiel)
           AND NOT EXISTS (SELECT 1 FROM element)
           AND NOT EXISTS (SELECT 1 FROM document)
        """;

    /// <summary>Vrai si la base ne contient aucune donnée métier (contrôle passé au moteur de reprise).</summary>
    public static async Task<bool> EstVideAsync(NpgsqlConnection connexion, NpgsqlTransaction? transaction, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(RequeteVide, connexion, transaction);
        return (bool)(await cmd.ExecuteScalarAsync(ct))!;
    }
}
