using LogiBTP.Domaine;
using LogiBTP.Reglements.Web;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Échéances et règlements d'un chantier ou d'un marché (lot 6 des demandes du 25/10/2026, A27 ; module Règlements
/// actif) : échéances des pièces validées rattachées au chantier (ou au marché), tous tiers et les deux sens, avec le
/// pointé et le reste (<see cref="ServiceReglement.Echeances"/>) ; le pointage se fait dans la page du tiers.
/// </summary>
public static class ReglementsStructure
{
    public static IEndpointRouteBuilder MapReglementsStructure(this IEndpointRouteBuilder api)
    {
        api.MapGet("/structure/{type}/{id:int}/echeances", async (string type, int id, bool? ouvertes, LogiBtpContext db, ServiceReglement s, CancellationToken ct) =>
        {
            var pieces = type switch
            {
                TypesFiche.Chantier => await db.Database.SqlQuery<long>($"SELECT ent_id AS \"Value\" FROM document WHERE ent_chantier_id = {id} AND ent_verrouille").ToListAsync(ct),
                TypesFiche.Marche => await db.Database.SqlQuery<long>($"SELECT ent_id AS \"Value\" FROM document WHERE ent_marche_id = {id} AND ent_verrouille").ToListAsync(ct),
                _ => throw ExceptionMetier.Invalide("TYPE", "Chantier ou marché"),
            };
            return pieces.Count == 0 ? [] : await s.Echeances(new FiltreEcheances(Pieces: pieces), ouvertes ?? false, ct);
        }).ExigeModule(ModulesFacultatifs.Reglement, "Règlements");
        return api;
    }
}
