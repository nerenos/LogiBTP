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
            TransformationService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> transformations,
            DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents, CancellationToken ct) =>
        {
            var tyd = await db.TypesDocument.AsNoTracking().Where(t => t.TydCode == d.Type).Select(t => (int?)t.TydId).FirstOrDefaultAsync(ct)
                ?? throw ExceptionMetier.Introuvable($"Type {d.Type}");
            var commandes = await db.Database.SqlQuery<long>($"""
                SELECT x.mdo_ent_id AS "Value" FROM marche_document x JOIN document c ON c.ent_id = x.mdo_ent_id
                WHERE x.mdo_mar_id = {id} AND c.ent_verrouille ORDER BY x.mdo_rang
                """).ToListAsync(ct);
            if (commandes.Count == 0) throw ExceptionMetier.Invalide("MARCHE_SANS_COMMANDE", "Le marché n'a pas de commande validée");
            var cree = await transformations.TransformerPlusieurs(new DemandeTransformationMultiple { CibleTydId = tyd, Sources = commandes }, Utilisateur.Depuis(http), ct);
            // Avancement : l'option du marché permet (ou non) de dépasser son montant (Q27).
            var entId = cree.Document.EntId;
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE document SET ent_avt_depassement = (SELECT mar_depassement_autorise FROM marche WHERE mar_id = {id}) WHERE ent_id = {entId} AND ent_avt_presentation IS NOT NULL", ct);
            cree.Document.EntAvtDepassement = await db.Database.SqlQuery<bool>($"SELECT ent_avt_depassement AS \"Value\" FROM document WHERE ent_id = {entId}").FirstAsync(ct);
            // Situation, facture d'avancement : numéro suivant dès la création (Q29).
            await SpecialisationBtp.NumeroterAvancement(db, entId, ct);
            cree.Document.EntRangAvancement = await db.Database.SqlQuery<int?>($"SELECT ent_rang_avancement AS \"Value\" FROM document WHERE ent_id = {entId}").FirstAsync(ct);
            // Facture : retenue de garantie et postes TTC du marché posés dans le pied global (Q5, 11.4), visibles dès la saisie.
            var type = await db.TypesDocument.AsNoTracking().FirstAsync(t => t.TydId == tyd, ct);
            var complet = await documents.Charger(entId, ct);
            if (PostesMarche.Portee(type, complet.Document) is string portee && await PostesMarche.Appliquer(db, complet, portee, ct))
            {
                return (await documents.Enregistrer(entId, complet, Utilisateur.Depuis(http), ct)).Document ?? cree;
            }
            return cree;
        });
        // Coordonnées figées d'un document : instantané d'une personne et de son contact (bouton ⟳ de l'entête).
        g.MapGet("/contact", async (long per_id, long? ind_id, LogiBtpContext db, CancellationToken ct) =>
            await ContactsDocument.Instantane(db, per_id, ind_id, ct) is { } c ? Results.Ok(c) : Results.NotFound());
        // Postes de pied du marché (Q5 à Q9, 11.3) : lecture ; écriture (droit MODIFIER de la fiche marché vérifié par la fiche).
        // Acomptes (Q10 à Q13) : mode de la société (écriture : administrateur, tant qu'aucun acompte n'existe), acomptes du
        // marché, nouvelle demande, émission de la facture ou du reçu.
        g.MapGet("/acomptes/mode", (LogiBtpContext db, CancellationToken ct) => Acomptes.Mode(db, ct));
        g.MapPut("/acomptes/mode", (ModeAcomptes m, HttpContext http, LogiBtpContext db, CancellationToken ct) => Acomptes.EnregistrerMode(db, m, Utilisateur.Depuis(http), ct));
        g.MapGet("/marches/{id:int}/acomptes", (int id, LogiBtpContext db, CancellationToken ct) => Acomptes.Lire(db, id, ct));
        g.MapPost("/marches/{id:int}/acomptes", async (int id, DemandeAcompte d, HttpContext http, LogiBtpContext db,
            DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents, CancellationToken ct) =>
            // Création et enregistrement de la demande ont chacun leur transaction (pas de transaction englobante).
            await Acomptes.Creer(db, documents, id, d, Utilisateur.Depuis(http), ct));
        g.MapPost("/acomptes/{id:int}/emettre", async (int id, HttpContext http, LogiBtpContext db, DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents,
            TransformationService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> transformations, CancellationToken ct) =>
            await Acomptes.Emettre(db, documents, transformations, id, Utilisateur.Depuis(http), ct));
        g.MapGet("/marches/{id:int}/postes", (int id, LogiBtpContext db, CancellationToken ct) => PostesMarche.Lire(db, id, ct));
        g.MapPut("/marches/{id:int}/postes", (int id, List<PosteMarche> postes, LogiBtpContext db, CancellationToken ct) => PostesMarche.Enregistrer(db, id, postes, ct));
        // Onglet Gestion de la fiche marché (CONCEPTION-MARCHES-REGLEMENTS.md, Q1 à Q3) : commandes (marché, TS) avec prévu,
        // situé (dernière situation de référence), facturé (factures et avoirs d'avancement non annulés) et reste ;
        // situations (références), pièces d'avancement (annulées comprises, marquées), autres documents, totaux.
        g.MapGet("/marches/{id:int}/gestion", async (int id, LogiBtpContext db, CancellationToken ct) =>
            Results.Content(await db.Database.SqlQueryRaw<string>(SqlGestionMarche, new NpgsqlParameter("id", id)).FirstAsync(ct), "application/json"));
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
        // Bloc de déduction d'un document d'avancement (13.7) : numéro de situation, documents précédents du marché (figés
        // à la validation d'une facture, sinon lus), à déduire du cumul.
        g.MapGet("/documents/{id:long}/avancement", async (long id, LogiBtpContext db, CancellationToken ct) =>
        {
            var json = await db.Database.SqlQuery<string>($"""
                SELECT json_build_object(
                  'rang', d.ent_rang_avancement,
                  'precedents', CASE WHEN EXISTS (SELECT 1 FROM document_deduction WHERE ded_ent_id = d.ent_id)
                    THEN (SELECT json_agg(json_build_object('ent_id', x.ent_id, 'numero', x.ent_numero, 'type', t.tyd_libelle, 'rang', k.ded_rang,
                            'date', x.ent_date, 'total_ht', k.ded_montant_ht, 'total_ttc', k.ded_montant_ttc) ORDER BY k.ded_rang NULLS FIRST, x.ent_id)
                          FROM document_deduction k JOIN document x ON x.ent_id = k.ded_deduit_ent_id JOIN type_document t ON t.tyd_id = x.ent_tyd_id
                          WHERE k.ded_ent_id = d.ent_id)
                    ELSE (SELECT coalesce(json_agg(json_build_object('ent_id', x.ent_id, 'numero', x.ent_numero, 'type', tx.tyd_libelle, 'rang', x.ent_rang_avancement,
                            'date', x.ent_date, 'total_ht', x.ent_total_ht, 'total_ttc', x.ent_total_ttc) ORDER BY x.ent_rang_avancement NULLS FIRST, x.ent_id), '[]')
                          FROM document x JOIN type_document tx ON tx.tyd_id = x.ent_tyd_id JOIN statut_document s ON s.std_id = x.ent_std_id
                          WHERE x.ent_marche_id = d.ent_marche_id AND x.ent_id <> d.ent_id AND x.ent_verrouille AND s.std_code <> 'ANNULE'
                            AND (x.ent_avt_presentation = 'P' OR tx.tyd_avancement = 'R')
                            AND (x.ent_rang_avancement IS NULL OR d.ent_rang_avancement IS NULL OR x.ent_rang_avancement < d.ent_rang_avancement))
                  END,
                  -- Pièces d'avancement annulées du marché (masquées de l'avancement, réaffichables pour contrôle).
                  'annules', (SELECT coalesce(json_agg(json_build_object('ent_id', x.ent_id, 'numero', x.ent_numero, 'type', tx.tyd_libelle,
                        'rang', x.ent_rang_avancement, 'total_ht', x.ent_total_ht, 'nature', x.ent_nature_avoir) ORDER BY x.ent_rang_avancement NULLS FIRST, x.ent_id), '[]')
                      FROM document x JOIN type_document tx ON tx.tyd_id = x.ent_tyd_id JOIN statut_document s ON s.std_id = x.ent_std_id
                      WHERE x.ent_marche_id = d.ent_marche_id AND s.std_code = 'ANNULE' AND x.ent_avt_presentation = 'P')) AS "Value"
                FROM document d WHERE d.ent_id = {id}
                """).FirstAsync(ct);
            return Results.Content(json, "application/json");
        });
        // Annulation d'une pièce d'avancement (Q30, 13.12 bis) : elle et toutes les pièces d'avancement suivantes du marché
        // (factures, avoirs d'avancement) sont annulées par avoir, en une transaction ; la dernière situation qui les a
        // servies est remise en cours (nouvel indice, avancements conservés). Hors avancement : la pièce seule.
        g.MapGet("/documents/{id:long}/annulation", async (long id, LogiBtpContext db, CancellationToken ct) =>
            Results.Content(await db.Database.SqlQueryRaw<string>(SqlListeCascade, new NpgsqlParameter("id", id)).FirstAsync(ct), "application/json"));
        g.MapPost("/documents/{id:long}/annulation", async (long id, HttpContext http, LogiBtpContext db,
            TransformationService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> transformations,
            DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var avoirs = new List<long>();
            long? situation;
            await using (var tx = await db.Database.BeginTransactionAsync(ct))
            {
                var pieces = await db.Database.SqlQueryRaw<long>("SELECT x.ent_id AS \"Value\" FROM " + SqlCascade + " ORDER BY x.ent_rang_avancement DESC NULLS LAST, x.ent_id DESC",
                    new NpgsqlParameter("id", id)).ToListAsync(ct);
                if (pieces.Count == 0) throw ExceptionMetier.Invalide("ANNULATION_IMPOSSIBLE", "Pièce déjà annulée ou non validée");
                foreach (var p in pieces) avoirs.Add(await transformations.AnnulerParAvoirDans(p, u, ct));
                // Dernière situation (de référence) dont une pièce annulée est issue.
                situation = await db.Database.SqlQuery<long?>($"""
                    SELECT s.ent_id AS "Value" FROM document s
                    JOIN type_document t ON t.tyd_id = s.ent_tyd_id AND t.tyd_avancement = 'S'
                    JOIN document_lien l ON l.lie_source_ent_id = s.ent_id AND l.lie_type = 'TRANSFORMATION'
                    WHERE l.lie_cible_ent_id = ANY({pieces.ToArray()}) AND s.ent_is_reference AND s.ent_verrouille
                    ORDER BY s.ent_rang_avancement DESC NULLS LAST, s.ent_id DESC LIMIT 1
                    """).FirstOrDefaultAsync(ct);
                await tx.CommitAsync(ct);
            }
            long? revision = situation is long sid ? (await documents.CreerIndice(sid, u, ct)).Document.EntId : null;
            return Results.Ok(new { avoirs, situation = revision });
        });
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

    /// <summary>
    /// Pièces annulées avec la pièce {id} (alias x) : elle-même, et dans un marché les pièces d'avancement validées non
    /// annulées qui la suivent (numéro de situation, puis ordre de création).
    /// </summary>
    private const string SqlGestionMarche = """
        WITH cmd AS (
            SELECT x.mdo_ent_id AS ent_id, x.mdo_role, x.mdo_rang, c.ent_numero, c.ent_date, c.ent_objet, c.ent_total_ht
            FROM marche_document x JOIN document c ON c.ent_id = x.mdo_ent_id
            WHERE x.mdo_mar_id = @id AND c.ent_verrouille),
        lignes AS (SELECT l.lig_ent_id AS cmd_id, l.lig_id FROM document_ligne l WHERE l.lig_ent_id IN (SELECT ent_id FROM cmd)),
        travaux AS (
            SELECT l.lig_ent_id AS cmd_id, sum(l.lig_montant_ht) AS mt
            FROM document_ligne l LEFT JOIN document_ligne p ON p.lig_id = l.lig_parent_id
            WHERE l.lig_ent_id IN (SELECT ent_id FROM cmd) AND l.lig_tyl_id IN (2, 3) AND coalesce(p.lig_tyl_id, 0) <> 2 AND l.lig_type_prix = 'V'
            GROUP BY l.lig_ent_id),
        doc AS (
            SELECT d.*, t.tyd_code, t.tyd_libelle, t.tyd_avancement, s.std_code, s.std_libelle
            FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document s ON s.std_id = d.ent_std_id
            WHERE d.ent_marche_id = @id),
        sit AS (
            SELECT ent_id FROM doc WHERE tyd_avancement = 'S' AND ent_verrouille AND ent_is_reference AND std_code <> 'ANNULE'
            ORDER BY ent_rang_avancement DESC NULLS LAST, ent_id DESC LIMIT 1),
        facture AS (
            SELECT li.cmd_id, sum(l.lig_montant_ht) AS mt
            FROM document_ligne l JOIN lignes li ON li.lig_id = l.lig_avt_source_lig_id JOIN doc d ON d.ent_id = l.lig_ent_id
            WHERE d.ent_verrouille AND d.ent_avt_presentation = 'P' AND d.std_code <> 'ANNULE'
            GROUP BY li.cmd_id),
        situe AS (
            SELECT li.cmd_id, sum(l.lig_avt_montant_cumul) AS mt
            FROM document_ligne l JOIN lignes li ON li.lig_id = l.lig_avt_source_lig_id
            WHERE l.lig_ent_id = (SELECT ent_id FROM sit)
            GROUP BY li.cmd_id)
        SELECT json_build_object(
          'montant_ht', (SELECT mar_montant_ht FROM marche WHERE mar_id = @id),
          'facture_ht', (SELECT coalesce(sum(f.facture_ht), 0) FROM v_facturation_document f WHERE f.ent_marche_id = @id),
          'derniere_situation', (SELECT ent_id FROM sit),
          'commandes', (SELECT coalesce(json_agg(json_build_object('ent_id', c.ent_id, 'role', c.mdo_role, 'rang', c.mdo_rang,
                'numero', c.ent_numero, 'date', c.ent_date, 'objet', c.ent_objet, 'prevu_ht', c.ent_total_ht, 'travaux_ht', w.mt,
                'situe_ht', s.mt, 'facture_ht', coalesce(f.mt, 0)) ORDER BY c.mdo_rang), '[]')
              FROM cmd c LEFT JOIN travaux w ON w.cmd_id = c.ent_id LEFT JOIN facture f ON f.cmd_id = c.ent_id LEFT JOIN situe s ON s.cmd_id = c.ent_id),
          'situations', (SELECT coalesce(json_agg(json_build_object('ent_id', d.ent_id, 'numero', d.ent_numero, 'indice', d.ent_indice,
                'rang', d.ent_rang_avancement, 'date', d.ent_date, 'statut', d.std_libelle, 'valide', d.ent_verrouille, 'total_ht', d.ent_total_ht,
                'facturee', EXISTS (SELECT 1 FROM document_lien k JOIN doc f ON f.ent_id = k.lie_cible_ent_id
                                    WHERE k.lie_source_ent_id = d.ent_id AND k.lie_type = 'TRANSFORMATION' AND f.std_code <> 'ANNULE'),
                'indices', (SELECT count(*) FROM document g WHERE g.ent_groupe_id = d.ent_groupe_id))
                ORDER BY d.ent_rang_avancement NULLS LAST, d.ent_id), '[]')
              FROM doc d WHERE d.tyd_avancement = 'S' AND d.ent_is_reference),
          'factures', (SELECT coalesce(json_agg(json_build_object('ent_id', d.ent_id, 'type', d.tyd_libelle, 'code', d.tyd_code, 'numero', d.ent_numero,
                'rang', d.ent_rang_avancement, 'date', d.ent_date, 'statut', d.std_libelle, 'valide', d.ent_verrouille,
                'annule', d.std_code = 'ANNULE', 'nature', d.ent_nature_avoir, 'total_ht', d.ent_total_ht, 'total_ttc', d.ent_total_ttc,
                'net_a_payer', d.ent_net_a_payer) ORDER BY d.ent_rang_avancement NULLS LAST, d.ent_id), '[]')
              FROM doc d WHERE d.ent_avt_presentation = 'P'),
          'autres', (SELECT coalesce(json_agg(json_build_object('ent_id', d.ent_id, 'type', d.tyd_libelle, 'numero', d.ent_numero,
                'date', d.ent_date, 'statut', d.std_libelle, 'total_ht', d.ent_total_ht) ORDER BY d.ent_id), '[]')
              FROM doc d WHERE d.ent_avt_presentation IS NULL AND d.ent_id NOT IN (SELECT ent_id FROM cmd))
        ) AS "Value"
        """;

    private const string SqlListeCascade = """
        SELECT coalesce(json_agg(json_build_object('ent_id', x.ent_id, 'numero', x.ent_numero, 'type', t.tyd_libelle,
            'rang', x.ent_rang_avancement, 'total_ht', x.ent_total_ht) ORDER BY x.ent_rang_avancement NULLS FIRST, x.ent_id), '[]') AS "Value"
        FROM
        """ + " " + SqlCascade;

    private const string SqlCascade = """
        document d
        JOIN document x ON x.ent_verrouille AND (x.ent_id = d.ent_id OR (d.ent_marche_id IS NOT NULL AND d.ent_avt_presentation = 'P'
            AND x.ent_marche_id = d.ent_marche_id AND x.ent_avt_presentation = 'P'
            AND (coalesce(x.ent_rang_avancement, 0) > coalesce(d.ent_rang_avancement, 0)
                 OR (coalesce(x.ent_rang_avancement, 0) = coalesce(d.ent_rang_avancement, 0) AND x.ent_id > d.ent_id))))
        JOIN type_document t ON t.tyd_id = x.ent_tyd_id
        JOIN statut_document st ON st.std_id = x.ent_std_id AND st.std_code <> 'ANNULE'
        WHERE d.ent_id = @id
        """;

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
