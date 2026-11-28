using System.Text.Json;
using LogiBTP.Import.Reprise;
using LogiBTP.Socle.Donnees;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Api.Reprise;

/// <summary>
/// Écriture dans la base cible pendant une reprise : SQL constant, valeurs en paramètres positionnels ($1, $2…), sur la
/// connexion et la transaction de l'unité d'écriture du moteur (jamais validée ni annulée ici).
/// </summary>
public static class SqlReprise
{
    /// <summary>Poste des chronomètres de la reprise : requêtes SQL directes sur la base cible.</summary>
    public const string PosteSql = "SQL_CIBLE";

    private static NpgsqlCommand Commande(UniteEcriture u, string sql, object?[] valeurs)
    {
        var cmd = new NpgsqlCommand(sql, u.Connexion, u.Transaction);
        foreach (var v in valeurs)
            cmd.Parameters.Add(v switch
            {
                null => new NpgsqlParameter { Value = DBNull.Value },
                Json j => new NpgsqlParameter { Value = j.Texte, NpgsqlDbType = NpgsqlDbType.Jsonb },
                _ => new NpgsqlParameter { Value = v },
            });
        return cmd;
    }

    /// <summary>Valeur JSON passée en jsonb.</summary>
    public sealed record Json(string Texte)
    {
        public static Json De(object valeur) => new(JsonSerializer.Serialize(valeur));
    }

    public static async Task<int> ExecuterAsync(UniteEcriture u, string sql, CancellationToken ct, params object?[] valeurs)
    {
        await using var cmd = Commande(u, sql, valeurs);
        return await ChronosReprise.MesurerAsync(PosteSql, () => cmd.ExecuteNonQueryAsync(ct));
    }

    /// <summary>Première colonne de la première ligne (INSERT … RETURNING), null sinon.</summary>
    public static async Task<object?> ScalaireAsync(UniteEcriture u, string sql, CancellationToken ct, params object?[] valeurs)
    {
        await using var cmd = Commande(u, sql, valeurs);
        var r = await ChronosReprise.MesurerAsync(PosteSql, () => cmd.ExecuteScalarAsync(ct));
        return r is DBNull ? null : r;
    }

    public static async Task<List<T>> LireAsync<T>(UniteEcriture u, string sql, Func<NpgsqlDataReader, T> ligne, CancellationToken ct,
        params object?[] valeurs)
    {
        await using var cmd = Commande(u, sql, valeurs);
        return await ChronosReprise.MesurerAsync(PosteSql, async () =>
        {
            await using var r = await cmd.ExecuteReaderAsync(ct);
            var liste = new List<T>();
            while (await r.ReadAsync(ct)) liste.Add(ligne(r));
            return liste;
        });
    }

    /// <summary>Lignes d'une requête de la source, chargées en mémoire (référentiels : quelques centaines de lignes).</summary>
    public static async Task<List<LigneSource>> SourceAsync(ContexteReprise ctx, string requete, CancellationToken ct,
        IReadOnlyDictionary<string, object?>? parametres = null)
    {
        var lignes = new List<LigneSource>();
        await foreach (var l in ctx.Lecteur.LireAsync(requete, parametres, ct)) lignes.Add(l);
        return lignes;
    }

    /// <summary>Paramètre du module Comptabilité fusionné (objet jsonb) : les clés fournies remplacent les anciennes.</summary>
    public static Task<int> FusionnerParametreComptaAsync(UniteEcriture u, string cle, object valeur, CancellationToken ct) =>
        ExecuterAsync(u, """
            INSERT INTO parametre_comptabilite (pcp_cle, pcp_valeur) VALUES ($1, $2)
            ON CONFLICT (pcp_cle) DO UPDATE SET pcp_valeur = CASE jsonb_typeof(parametre_comptabilite.pcp_valeur)
                WHEN 'object' THEN parametre_comptabilite.pcp_valeur || EXCLUDED.pcp_valeur ELSE EXCLUDED.pcp_valeur END
            """, ct, cle, Json.De(valeur));
}
