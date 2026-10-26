using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Mail.Web;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Lot de consultation (ANALYSE-MODULE-SOUS-TRAITANCE.md ST3, module Document 019i) : une demande de prix d'achat ou
/// un appel d'offres de sous-traitance se copie pour un autre fournisseur ; les copies partagent le code du lot
/// (`ent_consultation`, posé d'office sur la source : son numéro). Routes : <c>/api/structure/documents/{id}/consultation</c>.
/// </summary>
public sealed record CopieConsultation(long Id);
/// <summary>Envoi groupé du lot (lot 9, A24d) : les offres déjà envoyées ne repartent que si <c>Renvoyer</c>.</summary>
public sealed record EnvoiConsultation(bool Renvoyer = false);
public sealed record EnvoiOffre(long Id, string? Numero, string? Tiers, string Resultat, string? Message);
/// <summary>Offre retenue du lot (lot 9, A24d) : les autres offres en cours passent « Non retenue ».</summary>
public sealed record OffreRetenue(long Retenue, int NonRetenues);

public static class Consultations
{
    private sealed record DocumentLot(long Id, string? Numero, string? Indice, string? Tiers, decimal TotalHt, string Statut, string Type, bool Reference);

    /// <summary>Documents du lot de consultation d'un document (références et indices non remplacés).</summary>
    public static async Task<object> LireAsync(LogiBtpContext db, long id, CancellationToken ct)
    {
        var code = await db.Database.SqlQueryRaw<string?>("SELECT ent_consultation AS \"Value\" FROM document WHERE ent_id = @id", new NpgsqlParameter("id", id)).FirstOrDefaultAsync(ct);
        if (code is null) return new { code = (string?)null, documents = Array.Empty<object>() };
        var docs = await db.Database.SqlQueryRaw<DocumentLot>("""
            SELECT d.ent_id AS id, d.ent_numero AS numero, d.ent_indice AS indice, p.per_raison_sociale AS tiers, d.ent_total_ht AS total_ht,
                   s.std_libelle AS statut, t.tyd_code AS type, d.ent_is_reference AS reference
            FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document s ON s.std_id = d.ent_std_id
            LEFT JOIN personne p ON p.per_id = d.ent_tiers_id
            WHERE d.ent_consultation = @c AND d.ent_is_reference AND s.std_code NOT IN ('REMPLACE')
            ORDER BY d.ent_total_ht, d.ent_id
            """, new NpgsqlParameter("c", code)).ToListAsync(ct);
        return new { code, documents = docs };
    }

    /// <summary>
    /// Nouvelle demande du lot pour un autre fournisseur : copie du document (lignes et entête), sans tiers, sans
    /// intervenant fournisseur ni coordonnées figées ; la source reçoit le code du lot s'il manque (même validée).
    /// </summary>
    public static async Task<CopieConsultation> CopierAsync(LogiBtpContext db, DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents, long id, Utilisateur u,
        CancellationToken ct)
    {
        var consultation = await db.Database.SqlQueryRaw<bool>("""
            SELECT t.tyd_consultation AS "Value" FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE d.ent_id = @id
            """, new NpgsqlParameter("id", id)).FirstOrDefaultAsync(ct);
        if (!consultation) throw ExceptionMetier.Invalide("CONSULTATION_TYPE", "Ce type de document n'a pas de lot de consultation");
        await db.Database.ExecuteSqlRawAsync(
            "UPDATE document SET ent_consultation = coalesce(ent_consultation, coalesce(ent_numero, 'C' || ent_id)) WHERE ent_id = @id",
            [new NpgsqlParameter("id", id)], ct);
        var copie = await documents.Copier(id, u, ct);
        var nouveau = copie.Document.EntId;
        await db.Database.ExecuteSqlRawAsync("""
            UPDATE document d SET ent_consultation = s.ent_consultation, ent_tiers_id = NULL, ent_contact_client = NULL, ent_contact_payeur = NULL,
                   ent_intervenants = (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.ent_intervenants) = 'array' THEN d.ent_intervenants ELSE '[]'::jsonb END) x
                                       WHERE coalesce(x ->> 'fonction', '') NOT IN ('FOURNISSEUR', 'SOUS_TRAITANT'))
            FROM document s WHERE s.ent_id = @source AND d.ent_id = @id
            """, [new NpgsqlParameter("source", id), new NpgsqlParameter("id", nouveau)], ct);
        return new CopieConsultation(nouveau);
    }

    private sealed record OffreLot(long Id, string? Numero, string? Tiers, long? TiersId, bool Verrouille, bool Envoye, bool Terminal);

    private static async Task<(string Code, List<OffreLot> Offres)> OffresAsync(LogiBtpContext db, long id, CancellationToken ct)
    {
        var code = await db.Database.SqlQueryRaw<string?>("SELECT ent_consultation AS \"Value\" FROM document WHERE ent_id = @id", new NpgsqlParameter("id", id)).FirstOrDefaultAsync(ct)
            ?? throw ExceptionMetier.Invalide("CONSULTATION_VIDE", "Pas encore de lot de consultation pour ce document");
        var offres = await db.Database.SqlQueryRaw<OffreLot>("""
            SELECT d.ent_id AS id, d.ent_numero AS numero, p.per_raison_sociale AS tiers, d.ent_tiers_id AS tiers_id, d.ent_verrouille AS verrouille,
                   EXISTS (SELECT 1 FROM mail_lien k JOIN mail_message m ON m.mme_id = k.mli_mme_id
                           WHERE k.mli_type_element = 'document' AND k.mli_id_element = d.ent_id::text AND k.mli_retire_le IS NULL
                             AND m.mme_sens = 'E' AND m.mme_etat NOT IN ('ANNULE', 'ERREUR', 'BROUILLON')) AS envoye,
                   s.std_terminal AS terminal
            FROM document d JOIN statut_document s ON s.std_id = d.ent_std_id LEFT JOIN personne p ON p.per_id = d.ent_tiers_id
            WHERE d.ent_consultation = @c AND d.ent_is_reference ORDER BY d.ent_id
            """, new NpgsqlParameter("c", code)).ToListAsync(ct);
        return (code, offres);
    }

    /// <summary>
    /// Envoi groupé du lot (lot 9, A24d) : un courriel par offre validée de fournisseur connu, préparé comme le bouton
    /// 📧 Envoyer du document (destinataires par défaut, modèle de l'usage, pièces « à envoyer » dont l'édition) et mis en
    /// file par le module Mail ; ses suites (statut envoyé, GED, CRM) restent celles d'un envoi depuis le document. Offres
    /// en brouillon, sans fournisseur, sans adresse ou déjà envoyées par courriel (sauf Renvoyer) : signalées, non envoyées.
    /// </summary>
    public static async Task<List<EnvoiOffre>> EnvoyerAsync(LogiBtpContext db, ServiceEnvoiMail mail, long id, EnvoiConsultation e, Utilisateur u, CancellationToken ct)
    {
        var (_, offres) = await OffresAsync(db, id, ct);
        var r = new List<EnvoiOffre>();
        foreach (var o in offres.Where(o => !o.Terminal))
        {
            EnvoiOffre Ignore(string m) => new(o.Id, o.Numero, o.Tiers, "IGNORE", m);
            if (!o.Verrouille) { r.Add(Ignore("Brouillon : à valider avant l'envoi")); continue; }
            if (o.TiersId is null) { r.Add(Ignore("Sans fournisseur")); continue; }
            if (o.Envoye && !e.Renvoyer) { r.Add(Ignore("Déjà envoyée")); continue; }
            try
            {
                var b = await mail.PreparerAsync(u, "document", o.Id.ToString(), null, ct);
                var a = b.Destinataires.Where(x => x.ParDefaut).ToList();
                if (a.Count == 0) a = b.Destinataires.Take(1).ToList();
                if (a.Count == 0 || b.AliasId is not long alias) { r.Add(Ignore("Aucune adresse de courriel pour ce fournisseur")); continue; }
                var pieces = b.Pieces.Where(x => x.Cochee).Select(x => x.Reference).ToList();
                await mail.EnvoyerAsync(u, new DemandeEnvoi(alias, a.Select(x => new DestinataireSaisi(x.Adresse, x.Nom, x.PerId, x.IndId)).ToList(), null, null,
                    b.Objet, b.CorpsHtml, pieces, "document", o.Id.ToString(), b.Element?.Usage, ConfirmationMassive: true), ct);
                r.Add(new EnvoiOffre(o.Id, o.Numero, o.Tiers, "ENVOYE", string.Join(", ", a.Select(x => x.Adresse))));
            }
            catch (ExceptionMetier x) { r.Add(new EnvoiOffre(o.Id, o.Numero, o.Tiers, "ERREUR", x.Message)); }
        }
        return r;
    }

    /// <summary>
    /// Offre retenue (lot 9, A24d ; transformée en commande par le client, fenêtre de transformation commune) : les autres
    /// offres du lot qui ne sont pas dans un statut terminal passent « Non retenue » (NON_RETENU, 019m).
    /// </summary>
    public static async Task<OffreRetenue> RetenirAsync(LogiBtpContext db, long id, CancellationToken ct)
    {
        var (code, offres) = await OffresAsync(db, id, ct);
        if (!offres.Any(o => o.Id == id && o.Verrouille)) throw ExceptionMetier.Invalide("CONSULTATION_RETENUE", "Seule une offre validée du lot peut être retenue");
        var n = await db.Database.ExecuteSqlRawAsync("""
            UPDATE document d SET ent_std_id = s.std_id
            FROM statut_document s, statut_document a
            WHERE d.ent_consultation = @c AND d.ent_id <> @id AND d.ent_is_reference AND a.std_id = d.ent_std_id AND NOT a.std_terminal
              AND s.std_tyd_id = d.ent_tyd_id AND s.std_code = 'NON_RETENU'
            """, [new NpgsqlParameter("c", code), new NpgsqlParameter("id", id)], ct);
        return new OffreRetenue(id, n);
    }

    public static RouteGroupBuilder MapConsultations(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/structure/documents/{id:long}/consultation");
        g.MapGet("", (long id, LogiBtpContext db, CancellationToken ct) => LireAsync(db, id, ct));
        g.MapPost("", (long id, HttpContext http, LogiBtpContext db, DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents, CancellationToken ct) =>
            CopierAsync(db, documents, id, Utilisateur.Depuis(http), ct));
        g.MapPost("/envoyer", (long id, EnvoiConsultation e, HttpContext http, LogiBtpContext db, ServiceEnvoiMail mail, CancellationToken ct) =>
            EnvoyerAsync(db, mail, id, e, Utilisateur.Depuis(http), ct));
        g.MapPost("/retenir", (long id, LogiBtpContext db, CancellationToken ct) => RetenirAsync(db, id, ct));
        return g;
    }
}
