using System.Text.Json;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>Rattachement d'un document à la structure des affaires (champs facultatifs).</summary>
public sealed record RattachementDocument(int? EntProjetId, int? EntAffaireId, int? EntChantierId, int? EntMarcheId);

/// <summary>
/// Structure des affaires (db/160_structure.sql) : référentiels pour les listes de choix (projets, affaires, chantiers,
/// marchés, commandes clients) et rattachement d'un document, même validé (classement, pas modification du contenu).
/// La hiérarchie est complétée : un marché donne son chantier, un chantier son affaire. Les fiches (création,
/// modification) passent par le module Fiche.
/// </summary>
public static class Structure
{
    private const string Referentiels = """
        SELECT json_build_object(
          'affaires', (SELECT coalesce(json_agg(json_build_object('id', aff_id, 'code', aff_code, 'libelle', aff_libelle, 'nature', aff_nature,
                         'statut', aff_statut, 'tiers_id', aff_tiers_id) ORDER BY aff_code), '[]') FROM affaire),
          'projets', (SELECT coalesce(json_agg(json_build_object('id', prj_id, 'code', prj_code, 'libelle', prj_libelle, 'statut', prj_statut,
                         'tiers_id', prj_tiers_id, 'ville', prj_ville, 'montant_estime', prj_montant_estime) ORDER BY prj_code), '[]') FROM projet),
          'chantiers', (SELECT coalesce(json_agg(json_build_object('id', cha_id, 'code', cha_code, 'libelle', cha_libelle, 'statut', cha_statut,
                         'aff_id', cha_aff_id, 'prj_id', cha_prj_id, 'tiers_id', cha_tiers_id, 'ville', cha_ville) ORDER BY cha_code), '[]') FROM chantier),
          'marches', (SELECT coalesce(json_agg(json_build_object('id', mar_id, 'code', mar_code, 'libelle', mar_libelle, 'statut', mar_statut,
                         'cha_id', mar_cha_id, 'ent_id', mar_ent_id, 'tiers_id', mar_tiers_id, 'montant_ht', mar_montant_ht) ORDER BY mar_code), '[]') FROM marche),
          'commandes', (SELECT coalesce(json_agg(json_build_object('id', d.ent_id, 'numero', d.ent_numero, 'objet', d.ent_objet,
                         'total_ht', d.ent_total_ht, 'tiers_id', d.ent_tiers_id) ORDER BY d.ent_id DESC), '[]')
                        FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE t.tyd_code = 'V_COMMANDE'))
        """;

    public static IEndpointRouteBuilder MapStructure(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/structure");
        g.MapGet("/referentiels", async (LogiBtpContext db, CancellationToken ct) =>
        {
            var json = await db.Database.SqlQueryRaw<string>(Referentiels + " AS \"Value\"").FirstAsync(ct);
            return Results.Content(json, "application/json");
        });
        g.MapPut("/documents/{id:long}/rattachement", async (long id, RattachementDocument r, LogiBtpContext db, CancellationToken ct) =>
        {
            var doc = await db.Documents.FirstOrDefaultAsync(d => d.EntId == id, ct) ?? throw ExceptionMetier.Introuvable($"Document {id}");
            var chantier = r.EntChantierId;
            var affaire = r.EntAffaireId;
            if (r.EntMarcheId is int m)
            {
                chantier = await db.Database.SqlQuery<int>($"SELECT mar_cha_id AS \"Value\" FROM marche WHERE mar_id = {m}").FirstOrDefaultAsync(ct);
                if (chantier == 0) throw ExceptionMetier.Introuvable($"Marché {m}");
            }
            if (chantier is int c)
            {
                var aff = await db.Database.SqlQuery<int?>($"SELECT cha_aff_id AS \"Value\" FROM chantier WHERE cha_id = {c}").ToListAsync(ct);
                if (aff.Count == 0) throw ExceptionMetier.Introuvable($"Chantier {c}");
                affaire = aff[0] ?? affaire;
            }
            doc.EntProjetId = r.EntProjetId;
            doc.EntAffaireId = affaire;
            doc.EntChantierId = chantier;
            doc.EntMarcheId = r.EntMarcheId;
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { ent_projet_id = doc.EntProjetId, ent_affaire_id = doc.EntAffaireId, ent_chantier_id = doc.EntChantierId, ent_marche_id = doc.EntMarcheId });
        });
        return api;
    }
}
