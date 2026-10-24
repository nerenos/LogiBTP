using Microsoft.EntityFrameworkCore;
using LogiBTP.Socle.Web;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Individus de notre structure : rattachés (rattachement actif) à notre société (`per_societe_base`) ou à l'un de ses
/// niveaux inférieurs (agences, établissements). Conducteur de travaux des chantiers (db/215).
/// </summary>
public static class IndividusStructure
{
    public const string SqlStructure = """
        WITH RECURSIVE structure AS (
            SELECT per_id FROM personne WHERE per_societe_base
            UNION SELECT p.per_id FROM personne p JOIN structure s ON p.per_parent_id = s.per_id)
        """;

    public static async Task<bool> EstDeLaStructureAsync(DbContext db, long individu, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<bool>(SqlStructure + """
            SELECT EXISTS (SELECT 1 FROM rattachement r JOIN structure s ON s.per_id = r.rat_per_id WHERE r.rat_ind_id = @i AND r.rat_actif) AS "Value"
            """, new NpgsqlParameter("i", individu)).FirstAsync(ct);

    public sealed record IndividuStructure(long Valeur, string Libelle, string? Detail);

    /// <summary>Individus actifs de la structure (rattachement actif), un par individu : nom, puis fonction et personne de rattachement.</summary>
    public static async Task<List<IndividuStructure>> ListeAsync(DbContext db, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<IndividuStructure>(SqlStructure + """
            SELECT DISTINCT ON (i.ind_id) i.ind_id AS valeur, concat_ws(' ', i.ind_prenom, i.ind_nom) AS libelle,
                   nullif(concat_ws(' · ', r.rat_fonction, p.per_raison_sociale), '') AS detail
            FROM individu i JOIN rattachement r ON r.rat_ind_id = i.ind_id AND r.rat_actif JOIN structure s ON s.per_id = r.rat_per_id
            JOIN personne p ON p.per_id = r.rat_per_id
            WHERE i.ind_actif
            ORDER BY i.ind_id, r.rat_principal DESC, p.per_societe_base DESC
            """).ToListAsync(ct);

    /// <summary>GET /api/structure/individus : individus de notre structure (conducteurs de travaux…).</summary>
    public static RouteGroupBuilder MapIndividusStructure(this RouteGroupBuilder api)
    {
        api.MapGet("/structure/individus", async (LogiBtpContext db, CancellationToken ct) =>
            (await ListeAsync(db, ct)).OrderBy(x => x.Libelle, StringComparer.Ordinal).ToList());
        return api;
    }
}
