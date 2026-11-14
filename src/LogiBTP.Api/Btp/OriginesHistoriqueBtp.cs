using LogiBTP.Documents;
using LogiBTP.Domaine;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>Origine d'une ligne de l'historique d'une pièce (db/309) : AGENT, délégation et client de l'agent ; null = action humaine.</summary>
public sealed record OrigineHistorique(long HisId, string HisAction, string HisUtilisateur, string? HisOrigine, string? HisDelegation, string? HisClient);

/// <summary>
/// Origine des écritures d'une pièce (module MCP, lot 11 ; colonnes du cœur posées par <c>SpecialisationBtp.ApresHistoriqueAsync</c>) :
/// <c>GET /api/documents/{id}/origines</c>, lignes de l'historique dans l'ordre (identifiant, action, utilisateur, origine,
/// délégation, client). Le client en tire la mention « 🤖 via &lt;client&gt; » de l'historique et la pastille de l'entête
/// (pièce créée par un agent et pas encore reprise par un humain). Lecture : droit Consulter du type de la pièce, en plus
/// du nœud « documents » de la route.
/// </summary>
public static class OriginesHistoriqueBtp
{
    public static RouteGroupBuilder MapOriginesHistorique(this RouteGroupBuilder api)
    {
        api.MapGet("/documents/{id:long}/origines", (long id, HttpContext http, LogiBtpContext db, CancellationToken ct) => LireAsync(id, http, db, ct));
        return api;
    }

    public static async Task<IReadOnlyList<OrigineHistorique>> LireAsync(long id, HttpContext http, LogiBtpContext db, CancellationToken ct)
    {
        var code = await TypesDocumentBtp.CodeAsync(db, id, ct) ?? throw ExceptionMetier.Introuvable($"Document {id}");
        var famille = await db.TypesDocument.AsNoTracking().Where(t => t.TydCode == code).Select(t => t.TydFamille).FirstAsync(ct);
        var droits = http.RequestServices.GetService<IDroits>();
        if (droits is not null && !await droits.AutoriseAsync(Utilisateur.Depuis(http), FamillesDocument.NoeudDroits(famille, code), ActionsDroits.Consulter, ct))
            throw ExceptionMetier.AccesRefuse(ActionsDroits.Consulter);
        return await db.Database.SqlQuery<OrigineHistorique>($"""
            SELECT his_id AS his_id, his_action AS his_action, his_utilisateur AS his_utilisateur, his_origine AS his_origine,
                   his_delegation AS his_delegation, his_client AS his_client
            FROM document_historique WHERE his_ent_id = {id} ORDER BY his_id
            """).ToListAsync(ct);
    }
}
