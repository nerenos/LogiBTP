using LogiBTP.Documents;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Aides SQL communes du cœur : paramètre nullable, réponse JSON construite par la requête, fragments de statuts.
/// </summary>
public static class SqlBtp
{
    /// <summary>Statuts d'une pièce hors vigueur, pour <c>std_code NOT IN (…)</c> : annulée, remplacée par un indice.</summary>
    public const string HorsVigueur = $"'{StatutsDocument.Annule}', '{StatutsDocument.Remplace}'";

    /// <summary>
    /// Condition des choix de nouvelle saisie sur la vue <c>v_ressource</c> (alias <c>r</c>) : écarte salariés, matériels et
    /// sous-traitants « ne plus utiliser » (usage N, db/228) ; ceux en sommeil (S) restent proposés, l'historique reste lisible.
    /// </summary>
    public const string RessourceUtilisable = """
        NOT EXISTS (SELECT 1 FROM salarie u WHERE r.type IN ('SALARIE', 'INTERIM') AND u.sal_id::text = r.id AND u.sal_usage = 'N')
        AND NOT EXISTS (SELECT 1 FROM materiel u WHERE r.type = 'MATERIEL' AND u.mat_id::text = r.id AND u.mat_usage = 'N')
        AND NOT EXISTS (SELECT 1 FROM personne u WHERE r.type = 'SOUS_TRAITANT' AND u.per_id::text = r.id AND u.per_usage = 'N')
        """;

    /// <summary>Statuts d'une pièce close : hors vigueur ou soldée.</summary>
    public const string HorsVigueurOuSolde = $"{HorsVigueur}, '{StatutsDocument.Solde}'";

    /// <summary>
    /// Statuts hors vigueur pour une requête interpolée d'EF (passés en paramètre tableau) :
    /// <c>std_code &lt;&gt; ALL({SqlBtp.StatutsHorsVigueur})</c>.
    /// </summary>
    public static readonly string[] StatutsHorsVigueur = [StatutsDocument.Annule, StatutsDocument.Remplace];

    /// <summary>Statuts d'une pièce close pour une requête interpolée d'EF : hors vigueur ou soldée.</summary>
    public static readonly string[] StatutsHorsVigueurOuSolde = [.. StatutsHorsVigueur, StatutsDocument.Solde];

    /// <summary>Paramètre nommé ; null → <c>DBNull</c> (type obligatoire pour un null que PostgreSQL ne peut deviner).</summary>
    public static NpgsqlParameter P(string nom, object? valeur, NpgsqlDbType? type = null) =>
        type is { } t ? new NpgsqlParameter(nom, t) { Value = valeur ?? DBNull.Value } : new NpgsqlParameter(nom, valeur ?? DBNull.Value);

    /// <summary>Réponse JSON d'une requête qui renvoie un seul texte JSON (colonne <c>"Value"</c>).</summary>
    public static async Task<IResult> JsonAsync(this LogiBtpContext db, string sql, CancellationToken ct, params NpgsqlParameter[] p) =>
        Results.Content(await db.Database.SqlQueryRaw<string>(sql, p).FirstAsync(ct), "application/json");
}

/// <summary>Types de documents lus par le cœur : identifiant d'un code, code du type d'un document.</summary>
public static class TypesDocumentBtp
{
    /// <summary>Identifiant du type de ce code (exception s'il n'existe pas).</summary>
    public static Task<int> IdAsync(LogiBtpContext db, string code, CancellationToken ct) =>
        db.TypesDocument.AsNoTracking().Where(t => t.TydCode == code).Select(t => t.TydId).FirstAsync(ct);

    /// <summary>Code du type d'un document (null si le document n'existe pas).</summary>
    public static Task<string?> CodeAsync(DbContext db, long document, CancellationToken ct) =>
        db.Database.SqlQueryRaw<string?>("SELECT t.tyd_code AS \"Value\" FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE d.ent_id = @id",
            new NpgsqlParameter("id", document)).FirstOrDefaultAsync(ct);
}
