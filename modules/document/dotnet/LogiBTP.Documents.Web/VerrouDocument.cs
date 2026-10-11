using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Documents.Web;

/// <summary>État du verrou d'un document : Moi = cette fenêtre (jeton), MemeUtilisateur = l'utilisateur courant.</summary>
public sealed record EtatVerrouDocument(string Utilisateur, DateTimeOffset Depuis, DateTimeOffset Vu, bool Moi, bool MemeUtilisateur);

public sealed record ReponseVerrouDocument(bool Ok, EtatVerrouDocument? Verrou);

public sealed class DemandeVerrouDocument
{
    public Guid Jeton { get; set; }
}

internal sealed class LigneVerrouDocument
{
    public string Utilisateur { get; set; } = "";
    public Guid Jeton { get; set; }
    public DateTimeOffset Depuis { get; set; }
    public DateTimeOffset Vu { get; set; }
}

/// <summary>
/// Verrou de modification des documents (table verrou_document) : pris s'il est libre, détenu par la même fenêtre ou par
/// le même utilisateur (reprise silencieuse) ; sans expiration ; déverrouillage manuel réservé (SpecialisationDocument).
/// </summary>
public class VerrouDocumentService<TDoc, TLigne, TComplet>(DocumentDbContext<TDoc, TLigne> db, SpecialisationDocument<TDoc, TLigne, TComplet> specialisation)
    where TDoc : Document, new()
    where TLigne : DocumentLigne, new()
    where TComplet : DocumentComplet<TDoc, TLigne>, new()
{
    private static EtatVerrouDocument? Etat(LigneVerrouDocument? l, Guid? jeton, Utilisateur u) =>
        l is null ? null : new(l.Utilisateur, l.Depuis, l.Vu, jeton is not null && l.Jeton == jeton, l.Utilisateur == u.Code);

    public virtual async Task<EtatVerrouDocument?> Etat(long id, Guid? jeton, Utilisateur u, CancellationToken ct)
    {
        var l = await db.Database.SqlQuery<LigneVerrouDocument>($"""
            SELECT vdo_utilisateur AS "Utilisateur", vdo_jeton AS "Jeton", vdo_depuis AS "Depuis", vdo_vu AS "Vu"
            FROM verrou_document WHERE vdo_ent_id = {id}
            """).ToListAsync(ct);
        return Etat(l.FirstOrDefault(), jeton, u);
    }

    /// <summary>Prise ou renouvellement, en une instruction (aucune expiration).</summary>
    public virtual async Task<ReponseVerrouDocument> Verrouiller(long id, DemandeVerrouDocument d, Utilisateur u, CancellationToken ct)
    {
        if (!await db.Documents.AnyAsync(x => x.EntId == id, ct)) throw ExceptionMetier.Introuvable($"Document {id}");
        var pris = await db.Database.SqlQuery<LigneVerrouDocument>($"""
            INSERT INTO verrou_document (vdo_ent_id, vdo_utilisateur, vdo_jeton) VALUES ({id}, {u.Code}, {d.Jeton})
            ON CONFLICT (vdo_ent_id) DO UPDATE SET vdo_jeton = EXCLUDED.vdo_jeton, vdo_vu = now(),
                vdo_depuis = CASE WHEN verrou_document.vdo_jeton = EXCLUDED.vdo_jeton THEN verrou_document.vdo_depuis ELSE now() END
            WHERE verrou_document.vdo_jeton = EXCLUDED.vdo_jeton OR verrou_document.vdo_utilisateur = EXCLUDED.vdo_utilisateur
            RETURNING vdo_utilisateur AS "Utilisateur", vdo_jeton AS "Jeton", vdo_depuis AS "Depuis", vdo_vu AS "Vu"
            """).ToListAsync(ct);
        return new ReponseVerrouDocument(pris.Count > 0, await Etat(id, d.Jeton, u, ct));
    }

    /// <summary>Libération par la fenêtre qui détient le verrou.</summary>
    public virtual Task Deverrouiller(long id, Guid jeton, CancellationToken ct) =>
        db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM verrou_document WHERE vdo_ent_id = {id} AND vdo_jeton = {jeton}", ct);

    /// <summary>Déverrouillage manuel d'un verrou resté posé (fenêtre fermée, connexion perdue…).</summary>
    public virtual async Task Forcer(long id, Utilisateur u, CancellationToken ct)
    {
        if (!specialisation.PeutDeverrouiller(u)) throw ExceptionMetier.AccesRefuse("DEVERROUILLER");
        await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM verrou_document WHERE vdo_ent_id = {id}", ct);
    }

    /// <summary>Enregistrement refusé si un autre utilisateur détient le verrou.</summary>
    public virtual async Task Controler(long id, Utilisateur u, CancellationToken ct)
    {
        var v = await Etat(id, null, u, ct);
        if (v is not null && !v.MemeUtilisateur)
            throw ExceptionMetier.Conflit("DOCUMENT_VERROUILLE", $"Document ouvert en modification par {v.Utilisateur}", v);
    }
}
