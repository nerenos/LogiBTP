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

    /// <summary>
    /// Contrôle de l'écran, sans attendre : une reprise en cours sur la base (lancée ailleurs, par la commande de
    /// l'installeur par exemple) verrouille les tables des fiches jusqu'à sa fin (colonnes des champs supplémentaires
    /// créées dans sa transaction) ; le contrôle attendrait alors jusqu'au délai de la commande. Verrou non obtenu en
    /// 3 s : null (reprise en cours).
    /// </summary>
    public static async Task<bool?> EstVideSansAttendreAsync(NpgsqlConnection connexion, NpgsqlTransaction transaction, CancellationToken ct)
    {
        await using (var delai = new NpgsqlCommand("SET LOCAL lock_timeout = '3s'", connexion, transaction))
            await delai.ExecuteNonQueryAsync(ct);
        await using var point = new NpgsqlCommand("SAVEPOINT controle_vide", connexion, transaction);
        await point.ExecuteNonQueryAsync(ct);
        try
        {
            return await EstVideAsync(connexion, transaction, ct);
        }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.LockNotAvailable)
        {
            await using var retour = new NpgsqlCommand("ROLLBACK TO SAVEPOINT controle_vide", connexion, transaction);
            await retour.ExecuteNonQueryAsync(ct);
            return null;
        }
    }
}
