using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Plan de comptes minimal (db/166_lignes_comptes.sql) : libellés des comptes comptables affichés sur les lignes des
/// documents (lig_cpt_code ou compte hérité de la nature), en attendant le module Comptabilité.
/// </summary>
public static class Comptes
{
    private const string Liste = """
        SELECT (SELECT coalesce(json_agg(json_build_object('code', cpt_code, 'libelle', cpt_libelle, 'actif', cpt_actif) ORDER BY cpt_code), '[]')
                FROM compte_comptable)
        """;

    public static IEndpointRouteBuilder MapComptes(this IEndpointRouteBuilder api)
    {
        api.MapGet("/comptes-comptables", async (LogiBtpContext db, CancellationToken ct) =>
        {
            var json = await db.Database.SqlQueryRaw<string>(Liste + " AS \"Value\"").FirstAsync(ct);
            return Results.Content(json, "application/json");
        });
        return api;
    }
}
