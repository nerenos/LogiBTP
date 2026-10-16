using System.Text.Json;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Api.Btp;

/// <summary>Éléments de la structure dont on veut les documents (graphe des fiches projet, affaire, chantier, marché).</summary>
public sealed record PerimetreStructure(List<int>? Projets, List<int>? Affaires, List<int>? Chantiers, List<int>? Marches);

/// <summary>Document à créer depuis un marché : code du type (V_RECEPTION…).</summary>
public sealed record DocumentMarche(string Type);

/// <summary>Rattachement d'un document à la structure des affaires (champs facultatifs).</summary>
public sealed record RattachementDocument(int? EntProjetId, int? EntAffaireId, int? EntChantierId, int? EntMarcheId);

/// <summary>
/// Structure des affaires (db/160_structure.sql) : référentiels pour les listes de choix (projets, affaires, chantiers,
/// marchés, commandes clients) et rattachement d'un document, même validé (classement, pas modification du contenu).
/// La hiérarchie est complétée : un marché donne son chantier, un chantier son affaire et son projet. Les fiches (création,
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
                        FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE t.tyd_code = 'V_COMMANDE'),
          'marche_documents', (SELECT coalesce(json_agg(json_build_object('mar_id', x.mdo_mar_id, 'ent_id', x.mdo_ent_id, 'role', x.mdo_role,
                         'rang', x.mdo_rang, 'date', x.mdo_date, 'numero', d.ent_numero, 'objet', d.ent_objet, 'total_ht', d.ent_total_ht)
                         ORDER BY x.mdo_mar_id, x.mdo_rang), '[]')
                        FROM marche_document x JOIN document d ON d.ent_id = x.mdo_ent_id),
          'fonctions', (SELECT coalesce(json_agg(json_build_object('code', fin_code, 'libelle', fin_libelle, 'portee', fin_portee, 'unique', fin_unique,
                         'paiement_direct', fin_paiement_direct, 'actif', fin_actif) ORDER BY fin_ordre, fin_code), '[]') FROM fonction_intervenant))
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
            var projet = r.EntProjetId;
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
                projet = (await db.Database.SqlQuery<int?>($"SELECT cha_prj_id AS \"Value\" FROM chantier WHERE cha_id = {c}").ToListAsync(ct))[0] ?? projet;
            }
            doc.EntProjetId = projet;
            doc.EntAffaireId = affaire;
            doc.EntChantierId = chantier;
            doc.EntMarcheId = r.EntMarcheId;
            await db.SaveChangesAsync(ct);
            // Commande validée rattachée (ou détachée) après coup : base ou avenant du marché, montants recalculés.
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT f_marche_commande({id})", ct);
            return Results.Ok(new { ent_projet_id = doc.EntProjetId, ent_affaire_id = doc.EntAffaireId, ent_chantier_id = doc.EntChantierId, ent_marche_id = doc.EntMarcheId });
        });
        // Document créé depuis un marché (BL…) : toutes les commandes validées du marché, dans l'ordre (base puis avenants),
        // une section et un bloc de pied par commande (CONCEPTION-ACHATS-MARCHES.md, Q18, Q23).
        g.MapPost("/marches/{id:int}/documents", async (int id, DocumentMarche d, HttpContext http, LogiBtpContext db,
            TransformationService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> transformations, CancellationToken ct) =>
        {
            var tyd = await db.TypesDocument.AsNoTracking().Where(t => t.TydCode == d.Type).Select(t => (int?)t.TydId).FirstOrDefaultAsync(ct)
                ?? throw ExceptionMetier.Introuvable($"Type {d.Type}");
            var commandes = await db.Database.SqlQuery<long>($"""
                SELECT x.mdo_ent_id AS "Value" FROM marche_document x JOIN document c ON c.ent_id = x.mdo_ent_id
                WHERE x.mdo_mar_id = {id} AND c.ent_verrouille ORDER BY x.mdo_rang
                """).ToListAsync(ct);
            if (commandes.Count == 0) throw ExceptionMetier.Invalide("MARCHE_SANS_COMMANDE", "Le marché n'a pas de commande validée");
            return await transformations.TransformerPlusieurs(new DemandeTransformationMultiple { CibleTydId = tyd, Sources = commandes }, Utilisateur.Depuis(http), ct);
        });
        // Commandes du marché validées pas encore reprises dans un document (avenant à charger dans un brouillon, Q18).
        g.MapGet("/documents/{id:long}/commandes-marche", async (long id, LogiBtpContext db, CancellationToken ct) =>
            await db.Database.SqlQuery<long>($"""
                SELECT x.mdo_ent_id AS "Value" FROM document d
                JOIN marche_document x ON x.mdo_mar_id = d.ent_marche_id
                JOIN document c ON c.ent_id = x.mdo_ent_id
                WHERE d.ent_id = {id} AND c.ent_verrouille
                  AND NOT EXISTS (SELECT 1 FROM document_lien l WHERE l.lie_source_ent_id = x.mdo_ent_id AND l.lie_cible_ent_id = d.ent_id)
                ORDER BY x.mdo_rang
                """).ToListAsync(ct));
        // Intervenants d'un projet, d'une affaire, d'un chantier ou d'un marché (reprise dans l'annuaire d'un document).
        g.MapGet("/intervenants/{type}/{id:long}", async (string type, long id, LogiBtpContext db, CancellationToken ct) =>
            Intervenants.Gere(type) ? Results.Json(await Intervenants.Lire(db, type, id, ct)) : throw ExceptionMetier.Introuvable($"Type {type}"));
        // Documents rattachés aux éléments demandés (graphe d'une fiche) et liens de transformation entre eux.
        g.MapPost("/documents", async (PerimetreStructure p, LogiBtpContext db, CancellationToken ct) =>
        {
            static NpgsqlParameter T(string nom, List<int>? ids) => new(nom, NpgsqlDbType.Array | NpgsqlDbType.Integer) { Value = (ids ?? []).ToArray() };
            var json = await db.Database.SqlQueryRaw<string>(DocumentsPerimetre, T("prj", p.Projets), T("aff", p.Affaires), T("cha", p.Chantiers), T("mar", p.Marches)).FirstAsync(ct);
            return Results.Content(json, "application/json");
        });
        // Document et ses documents enfants (transformations et copies, à toute profondeur) : arborescence de la GED d'un document.
        g.MapGet("/documents/{id:long}/descendants", async (long id, LogiBtpContext db, CancellationToken ct) =>
        {
            var json = await db.Database.SqlQueryRaw<string>(DocumentsDescendants, new NpgsqlParameter("id", id)).FirstAsync(ct);
            return Results.Content(json, "application/json");
        });
        return api;
    }

    // Colonnes d'un document (CTE docs) : groupe d'indices (rattachement des pièces de la GED), indice de référence.
    private const string ColonnesDocument = """
          SELECT d.ent_id, d.ent_numero, t.tyd_code, t.tyd_libelle, t.tyd_famille, s.std_libelle, d.ent_objet, d.ent_total_ht,
                 d.ent_projet_id, d.ent_affaire_id, d.ent_chantier_id, d.ent_marche_id, coalesce(d.ent_groupe_id, d.ent_id) AS groupe_id,
                 d.ent_is_reference, d.ent_date
          FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document s ON s.std_id = d.ent_std_id
        """;

    private const string ResultatDocuments = """
        SELECT json_build_object(
          'documents', (SELECT coalesce(json_agg(json_build_object('id', ent_id, 'numero', ent_numero, 'type', tyd_code, 'type_libelle', tyd_libelle,
                          'famille', tyd_famille, 'statut', std_libelle, 'objet', ent_objet, 'total_ht', ent_total_ht, 'projet_id', ent_projet_id,
                          'affaire_id', ent_affaire_id, 'chantier_id', ent_chantier_id, 'marche_id', ent_marche_id, 'groupe_id', groupe_id,
                          'reference', ent_is_reference, 'date', ent_date) ORDER BY ent_id), '[]') FROM docs),
          'liens', (SELECT coalesce(json_agg(json_build_object('source', l.lie_source_ent_id, 'cible', l.lie_cible_ent_id, 'type', l.lie_type)), '[]')
                    FROM document_lien l WHERE l.lie_source_ent_id IN (SELECT ent_id FROM docs) AND l.lie_cible_ent_id IN (SELECT ent_id FROM docs)))::text AS "Value"
        """;

    private const string DocumentsPerimetre = "WITH docs AS (" + ColonnesDocument + """
          WHERE d.ent_projet_id = ANY(@prj) OR d.ent_affaire_id = ANY(@aff) OR d.ent_chantier_id = ANY(@cha) OR d.ent_marche_id = ANY(@mar))
        """ + ResultatDocuments;

    private const string DocumentsDescendants = """
        WITH RECURSIVE descendants(ent_id, profondeur) AS (
          SELECT @id::BIGINT, 0
          UNION SELECT l.lie_cible_ent_id, x.profondeur + 1 FROM document_lien l JOIN descendants x ON l.lie_source_ent_id = x.ent_id WHERE x.profondeur < 50),
        docs AS (
        """ + ColonnesDocument + """
          WHERE d.ent_id IN (SELECT ent_id FROM descendants))
        """ + ResultatDocuments;
}
