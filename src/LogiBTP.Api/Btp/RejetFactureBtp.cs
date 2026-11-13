using System.Globalization;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.FactureElectronique;
using LogiBTP.FactureElectronique.Web;
using LogiBTP.Relances;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using LogiBTP.Socle.Donnees;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Avoir interne d'une facture émise (état de l'émission, <see cref="EtatEnvoiFe.Annulation"/>) : proposé sur la facture
/// rejetée (213) ou refusée (210), validée et non annulée ; sur la facture annulée : son avoir et la nouvelle facture ; sur
/// l'avoir lui-même (<see cref="EstAvoir"/>) : la facture annulée (<see cref="FactureId"/>).
/// </summary>
public sealed record AnnulationFe(bool Proposee, string? Statut, string? Transmission, long? FactureId, long? AvoirId, string? AvoirNumero,
    long? CopieId, string? CopieNumero, bool EstAvoir);

/// <summary>Demande d'avoir interne (bouton de la page document, après confirmation) : transmission de l'avoir.</summary>
public sealed record DemandeAnnulationFe(string? Transmission);

/// <summary>
/// Rejet, refus et litige d'une facture émise (plans/facturation-electronique.md, lot 25 ; Q14, Q17). Aucun changement de
/// statut d'une pièce sans action de l'utilisateur :
/// - Rejetée (213) ou Refusée (210) : notification (signaux du lot 11) et proposition, sur la pièce, d'un avoir interne
///   d'annulation ; confirmé par l'utilisateur (POST …/documents/{id}/annulation) : <c>AnnulerParAvoirDans</c> du module
///   Document (lien ANNULATION, avoir daté du jour — pièce transférée en comptabilité comprise, jamais modifiée —, les deux
///   pièces au statut Annulé), avoir déposé pour archivage seul (note BAR ARCHIVEONLY, règle ArchiveOnly) ou non déposé
///   (HORS_FLUX, AVOIR_INTERNE), puis copie en nouvelle facture (brouillon) ; pièce d'avancement : la situation qui l'a
///   servie est remise en cours (nouvel indice), comme l'annulation du marché ; pièces d'avancement suivantes : refus ;
///   étape AVOIR_INTERNE au journal de la facture ;
/// - En litige (207) : relance de la pièce suspendue (module Relances, motif LITIGE, sans fin), levée à Approuvée (205) ;
///   seules les suspensions posées ici sont levées.
/// </summary>
public static class RejetFactureBtp
{
    /// <summary>Auteur des suspensions de relance posées pour un litige (rsu_cree_par).</summary>
    public const string AuteurSuspension = "facture_electronique";

    /// <summary>Fin d'une suspension pour litige : sans fin, levée à Approuvée.</summary>
    public static readonly DateOnly FinSuspension = new(9999, 12, 31);

    /// <summary>Suite d'un statut reçu sur la relance de la pièce.</summary>
    public enum SuiteRelance { Aucune, Suspendre, Lever }

    // ---------------------------------------------------------------- règles sans base

    /// <summary>Avoir interne proposé : statut affiché Rejetée ou Refusée, pièce validée et non annulée, sans avoir interne.</summary>
    public static bool Proposee(string? statut, bool valable, bool dejaAnnulee) =>
        !dejaAnnulee && valable && statut is StatutCdv.Rejetee or StatutCdv.Refusee;

    /// <summary>Transmission demandée (vide : archivage seul) ; inconnue : null.</summary>
    public static string? Transmission(string? demandee) => string.IsNullOrWhiteSpace(demandee)
        ? TransmissionsAvoirInterneFe.ArchivageSeul
        : demandee is TransmissionsAvoirInterneFe.ArchivageSeul or TransmissionsAvoirInterneFe.Aucune ? demandee : null;

    /// <summary>État de l'émission de l'avoir interne : à émettre (archivage seul) ou hors flux (non déposé).</summary>
    public static (string Etat, string? Motif) EtatAvoir(string transmission) => transmission == TransmissionsAvoirInterneFe.Aucune
        ? (EtatsEmissionFe.HorsFlux, MotifsEmissionFe.AvoirInterne)
        : (EtatsEmissionFe.AEmettre, null);

    /// <summary>Suite d'un statut reçu d'une facture émise : En litige → suspendre la relance ; Approuvée → la lever.</summary>
    public static SuiteRelance SuiteDuStatut(string? code) => code switch
    {
        StatutCdv.EnLitige => SuiteRelance.Suspendre,
        StatutCdv.Approuvee => SuiteRelance.Lever,
        _ => SuiteRelance.Aucune,
    };

    // ---------------------------------------------------------------- lecture

    private static async Task<bool> TableAsync(DbContext db, string table, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<bool>("SELECT to_regclass(@t) IS NOT NULL AS \"Value\"", new NpgsqlParameter("t", table)).ToListAsync(ct)).FirstOrDefault();

    private sealed record LigneAnnulation(long Facture, long Avoir, string? AvoirNumero, long? Copie, string? CopieNumero, string Transmission, string Statut);

    private static async Task<LigneAnnulation?> LigneAsync(DbContext db, long id, CancellationToken ct)
    {
        if (!await TableAsync(db, "document_fe_annulation", ct)) return null;
        return (await db.Database.SqlQueryRaw<LigneAnnulation>("""
            SELECT a.dfa_ent_id AS facture, a.dfa_avoir_ent_id AS avoir, av.ent_numero AS avoir_numero, a.dfa_copie_ent_id AS copie,
                   cp.ent_numero AS copie_numero, a.dfa_transmission AS transmission, a.dfa_statut AS statut
            FROM document_fe_annulation a JOIN document av ON av.ent_id = a.dfa_avoir_ent_id LEFT JOIN document cp ON cp.ent_id = a.dfa_copie_ent_id
            WHERE a.dfa_ent_id = @id OR a.dfa_avoir_ent_id = @id
            """, new NpgsqlParameter("id", id)).ToListAsync(ct)).FirstOrDefault();
    }

    /// <summary>Transmission de la pièce si c'est un avoir interne, sinon null.</summary>
    public static async Task<string?> TransmissionAvoirAsync(DbContext db, long id, CancellationToken ct) =>
        await LigneAsync(db, id, ct) is { } l && l.Avoir == id ? l.Transmission : null;

    /// <summary>Annulation d'une pièce (facture ou avoir interne) pour l'état de l'émission.</summary>
    public static async Task<AnnulationFe> AnnulationAsync(DbContext db, long id, string? statut, bool valable, CancellationToken ct)
    {
        var l = await LigneAsync(db, id, ct);
        if (l is null) return new AnnulationFe(Proposee(statut, valable, false), statut, null, null, null, null, null, null, false);
        return new AnnulationFe(false, l.Statut, l.Transmission, l.Facture, l.Avoir, l.AvoirNumero, l.Copie, l.CopieNumero, l.Avoir == id);
    }

    // ---------------------------------------------------------------- avoir interne

    /// <summary>
    /// Avoir interne d'une facture émise rejetée ou refusée, à la demande de l'utilisateur ; rend l'état de l'émission de la
    /// facture (annulation : avoir et nouvelle facture). Refus : <see cref="ErreursEmissionFe.AnnulationImpossible"/>.
    /// </summary>
    public static async Task<EtatEnvoiFe> AnnulerAsync(IServiceProvider services, long id, DemandeAnnulationFe demande, Utilisateur u, CancellationToken ct)
    {
        var db = services.GetRequiredService<LogiBtpContext>();
        var transmission = Transmission(demande.Transmission)
            ?? throw ExceptionMetier.Invalide(ErreursEmissionFe.AnnulationImpossible, $"Transmission {demande.Transmission} inconnue");
        var etat = await EnvoiFactureBtp.EtatAsync(db, id, ct);
        if (etat.Annulation is not { Proposee: true })
        {
            throw ExceptionMetier.Invalide(ErreursEmissionFe.AnnulationImpossible,
                "Seule une facture émise rejetée ou refusée par la plateforme ou le client, validée et non annulée, s'annule par un avoir interne");
        }
        var cascade = await db.Database.SqlQueryRaw<long>("SELECT x.ent_id AS \"Value\" FROM " + Structure.SqlCascade, new NpgsqlParameter("id", id)).ToListAsync(ct);
        if (cascade.Count > 1)
        {
            throw ExceptionMetier.Invalide(ErreursEmissionFe.AnnulationImpossible,
                "Pièces d'avancement suivantes sur le marché : annulez-les d'abord (Annuler par avoir du marché), puis celle-ci", cascade.Where(x => x != id).ToList());
        }
        var avancement = (await db.Database.SqlQueryRaw<bool>(
            "SELECT (ent_marche_id IS NOT NULL AND ent_avt_presentation = 'P') AS \"Value\" FROM document WHERE ent_id = @id",
            new NpgsqlParameter("id", id)).ToListAsync(ct)).FirstOrDefault();
        var transformations = services.GetRequiredService<TransformationService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>();
        var documents = services.GetRequiredService<DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>();

        long avoir;
        long? situation = null;
        await using (var tx = await db.Unite().CommencerAsync(ct))
        {
            avoir = await transformations.AnnulerParAvoirDans(id, u, ct);
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO document_fe_annulation (dfa_ent_id, dfa_avoir_ent_id, dfa_statut, dfa_transmission, dfa_par) VALUES (@e, @a, @s, @t, @p)
                """, [new NpgsqlParameter("e", id), new NpgsqlParameter("a", avoir), new NpgsqlParameter("s", etat.Statut!),
                      new NpgsqlParameter("t", transmission), new NpgsqlParameter("p", u.Code)], ct);
            var (etatAvoir, motif) = EtatAvoir(transmission);
            // Inscrit pour la tâche de fond sans délai (archivage seul), ou hors flux ; l'inscription de la validation est remplacée.
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO document_fe_emission (dfe_ent_id, dfe_etat, dfe_motif, dfe_demande_par, dfe_traite_le)
                VALUES (@a, @etat, @motif, @par, CASE WHEN @etat = 'HORS_FLUX' THEN now() END)
                ON CONFLICT (dfe_ent_id) DO UPDATE SET dfe_etat = EXCLUDED.dfe_etat, dfe_motif = EXCLUDED.dfe_motif, dfe_essais = 0,
                    dfe_erreur = NULL, dfe_demande_par = EXCLUDED.dfe_demande_par, dfe_traite_le = EXCLUDED.dfe_traite_le
                """, [new NpgsqlParameter("a", avoir), new NpgsqlParameter("etat", etatAvoir), SqlBtp.P("motif", motif, NpgsqlTypes.NpgsqlDbType.Varchar),
                      new NpgsqlParameter("par", u.Code)], ct);
            if (avancement) situation = await Structure.SituationServieAsync(db, [id], ct);
            await tx.CommitAsync(ct);
        }

        // Nouvelle facture : copie en brouillon ; pièce d'avancement : situation remise en cours (nouvel indice).
        long? copie = avancement
            ? situation is long s ? (await documents.CreerIndice(s, u, ct)).Document.EntId : null
            : (await documents.Copier(id, u, ct)).Document.EntId;
        if (copie is not null)
        {
            await db.Database.ExecuteSqlRawAsync("UPDATE document_fe_annulation SET dfa_copie_ent_id = @c WHERE dfa_ent_id = @e",
                [new NpgsqlParameter("c", copie), new NpgsqlParameter("e", id)], ct);
        }
        var numero = (await db.Database.SqlQueryRaw<string?>("SELECT ent_numero AS \"Value\" FROM document WHERE ent_id = @a", new NpgsqlParameter("a", avoir))
            .ToListAsync(ct)).FirstOrDefault();
        await services.GetRequiredService<ServiceFactureElectronique>().JournaliserAsync(new EtapeFe(EvenementFe.AvoirInterne, ActeurFe.Utilisateur)
        {
            FluxId = etat.FluxId, TypeElement = TypesElementFe.Document, IdElement = id.ToString(CultureInfo.InvariantCulture),
            EtatAvant = etat.Statut, EtatApres = etat.Statut, Utilisateur = u.Code,
            Detail = new { avoir, numero, transmission, copie, situation_remise_en_cours = avancement },
        }, ct);
        return await EnvoiFactureBtp.EtatAsync(db, id, ct);
    }

    // ---------------------------------------------------------------- litige et relance

    /// <summary>
    /// Statut reçu d'une facture émise : En litige → relance suspendue (une seule suspension posée ici par pièce) ;
    /// Approuvée → suspensions posées ici levées. Module Relances absent de la base : rien. Rend la suite appliquée.
    /// </summary>
    public static async Task<SuiteRelance> RelanceAsync(DbContext db, long ent, string code, string? motif, CancellationToken ct)
    {
        var suite = SuiteDuStatut(code);
        if (suite == SuiteRelance.Aucune || !await TableAsync(db, "relance_suspension", ct)) return SuiteRelance.Aucune;
        var p = new object[] { new NpgsqlParameter("e", ent), new NpgsqlParameter("m", MotifSuspension.Litige), new NpgsqlParameter("a", AuteurSuspension) };
        if (suite == SuiteRelance.Lever)
        {
            await db.Database.ExecuteSqlRawAsync("DELETE FROM relance_suspension WHERE rsu_ent_id = @e AND rsu_motif = @m AND rsu_cree_par = @a", p, ct);
            return suite;
        }
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO relance_suspension (rsu_ent_id, rsu_jusqu_au, rsu_motif, rsu_commentaire, rsu_cree_par)
            SELECT @e, @j, @m, @c, @a
            WHERE NOT EXISTS (SELECT 1 FROM relance_suspension WHERE rsu_ent_id = @e AND rsu_motif = @m AND rsu_cree_par = @a)
            """, [.. p, new NpgsqlParameter("j", FinSuspension),
                  new NpgsqlParameter("c", string.IsNullOrWhiteSpace(motif) ? "Facture électronique en litige" : $"Facture électronique en litige : {motif}")], ct);
        return suite;
    }

    // ---------------------------------------------------------------- route

    /// <summary>Avoir interne d'une facture émise rejetée ou refusée (droit Modifier du nœud ; Créer sur les types d'avoir et de facture).</summary>
    public static RouteGroupBuilder MapRejetFe(this RouteGroupBuilder api)
    {
        api.MapPost("/facture-electronique/documents/{id:long}/annulation", (long id, DemandeAnnulationFe d, HttpContext http, CancellationToken ct) =>
            AnnulerAsync(http.RequestServices, id, d, Utilisateur.Depuis(http), ct));
        return api;
    }
}
