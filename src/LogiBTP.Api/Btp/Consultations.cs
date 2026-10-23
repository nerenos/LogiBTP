using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Lot de consultation (ANALYSE-MODULE-SOUS-TRAITANCE.md ST3, module Document 019i) : une demande de prix d'achat ou
/// un appel d'offres de sous-traitance se copie pour un autre fournisseur ; les copies partagent le code du lot
/// (`ent_consultation`, posé d'office sur la source : son numéro). Routes : <c>/api/structure/documents/{id}/consultation</c>.
/// </summary>
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
    public static async Task<object> CopierAsync(LogiBtpContext db, DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents, long id, Utilisateur u,
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
        return new { id = nouveau };
    }

    public static RouteGroupBuilder MapConsultations(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/structure/documents/{id:long}/consultation");
        g.MapGet("", (long id, LogiBtpContext db, CancellationToken ct) => LireAsync(db, id, ct));
        g.MapPost("", (long id, HttpContext http, LogiBtpContext db, DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents, CancellationToken ct) =>
            CopierAsync(db, documents, id, Utilisateur.Depuis(http), ct));
        return g;
    }
}
