using System.Text.Json;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Documents.Web;

/// <summary>Origine d'un document importé, enregistrée après sa création (fichier source conservé par l'application).</summary>
public sealed class OrigineDocumentDto
{
    public string Format { get; set; } = "";
    public long? FichierId { get; set; }
    public string? NomFichier { get; set; }
    public string? Reference { get; set; }
    public JsonDocument? Rapport { get; set; }
}

/// <summary>Document lié (source ou cible d'une transformation ou d'une copie).</summary>
public sealed record DocumentLie(long EntId, string? Numero, string? Indice, string TypeCode, string TypeLibelle, string? Objet, string? Statut, string Lien, DateOnly Date);

/// <summary>Traçabilité d'un document : origine (import), documents dont il est issu et qui en sont issus, historique.</summary>
public sealed record Tracabilite(object? Origine, List<DocumentLie> Sources, List<DocumentLie> Cibles, List<VersionHistorique> Historique);

/// <summary>Version enregistrée d'un document : action, auteur, motif, total HT et nombre de lignes de l'instantané.</summary>
public sealed record VersionHistorique(long HisId, int HisVersion, string HisAction, DateTimeOffset HisDate, string HisUtilisateur, string? HisMotif,
    decimal? TotalHt, int NombreLignes);

/// <summary>
/// Traçabilité des documents : origine d'un import (format, fichier source réutilisable, rapport), liens de
/// transformation et de copie dans les deux sens, historique des versions.
/// </summary>
public class TracabiliteService<TDoc, TLigne, TComplet>(DocumentDbContext<TDoc, TLigne> db, DocumentService<TDoc, TLigne, TComplet> documents)
    where TDoc : Document, new()
    where TLigne : DocumentLigne, new()
    where TComplet : DocumentComplet<TDoc, TLigne>, new()
{
    public async Task<Tracabilite> Lire(long id, CancellationToken ct)
    {
        if (!await db.Documents.AnyAsync(d => d.EntId == id, ct)) throw ExceptionMetier.Introuvable($"Document {id}");
        var origine = await db.Origines.AsNoTracking().Where(o => o.DorEntId == id)
            .Select(o => new { o.DorType, o.DorFormat, o.DorFichierId, o.DorNomFichier, o.DorReference, o.DorRapport, o.DorDate, o.DorUtilisateur })
            .FirstOrDefaultAsync(ct);
        var liens = await db.DocumentsLien.AsNoTracking().Where(l => l.LieSourceEntId == id || l.LieCibleEntId == id).ToListAsync(ct);
        var ids = liens.Select(l => l.LieSourceEntId == id ? l.LieCibleEntId : l.LieSourceEntId).Distinct().ToList();
        var docs = await (from d in db.Documents.AsNoTracking()
                          join t in db.TypesDocument.AsNoTracking() on d.EntTydId equals t.TydId
                          join s in db.StatutsDocument.AsNoTracking() on d.EntStdId equals s.StdId
                          where ids.Contains(d.EntId)
                          select new { d.EntId, d.EntNumero, d.EntIndice, t.TydCode, t.TydLibelle, d.EntObjet, s.StdLibelle, d.EntDate }).ToListAsync(ct);
        DocumentLie? Lie(long autre, string lien)
        {
            var d = docs.FirstOrDefault(x => x.EntId == autre);
            return d is null ? null : new DocumentLie(d.EntId, d.EntNumero, d.EntIndice, d.TydCode, d.TydLibelle, d.EntObjet, d.StdLibelle, lien, d.EntDate);
        }
        var sources = liens.Where(l => l.LieCibleEntId == id).Select(l => Lie(l.LieSourceEntId, l.LieType)).OfType<DocumentLie>().ToList();
        var cibles = liens.Where(l => l.LieSourceEntId == id).Select(l => Lie(l.LieCibleEntId, l.LieType)).OfType<DocumentLie>().ToList();
        return new Tracabilite(origine, sources, cibles, await Versions(id, ct));
    }

    /// <summary>
    /// Versions enregistrées d'un document (instantanés de l'état avant chaque action), de la plus récente à la plus
    /// ancienne : motif, total HT et nombre de lignes de l'instantané (écran de restauration d'une version).
    /// </summary>
    public async Task<List<VersionHistorique>> Versions(long id, CancellationToken ct) =>
        await db.Database.SqlQuery<VersionHistorique>($"""
            SELECT his_id AS his_id, his_version AS his_version, his_action AS his_action, his_date AS his_date,
                   his_utilisateur AS his_utilisateur, his_motif AS his_motif,
                   CASE WHEN jsonb_typeof(his_instantane -> 'document' -> 'ent_total_ht') = 'number'
                        THEN (his_instantane -> 'document' ->> 'ent_total_ht')::numeric END AS total_ht,
                   CASE WHEN jsonb_typeof(his_instantane -> 'lignes') = 'array' THEN jsonb_array_length(his_instantane -> 'lignes') ELSE 0 END AS nombre_lignes
            FROM document_historique WHERE his_ent_id = {id} ORDER BY his_id DESC
            """).ToListAsync(ct);

    /// <summary>Origine d'un document créé par un import (une seule par document, remplacée si elle existe).</summary>
    public async Task EnregistrerOrigine(long id, OrigineDocumentDto o, Utilisateur u, CancellationToken ct)
    {
        var doc = await db.Documents.AsNoTracking().FirstOrDefaultAsync(d => d.EntId == id, ct) ?? throw ExceptionMetier.Introuvable($"Document {id}");
        await documents.VerifierDroit(u, doc.EntTydId, ActionsDroits.Creer, ct);
        if (string.IsNullOrWhiteSpace(o.Format)) throw ExceptionMetier.Invalide("FORMAT", "Format d'import obligatoire");
        var e = await db.Origines.FirstOrDefaultAsync(x => x.DorEntId == id, ct);
        if (e is null) db.Origines.Add(e = new DocumentOrigine { DorEntId = id });
        e.DorType = "IMPORT";
        e.DorFormat = o.Format;
        e.DorFichierId = o.FichierId;
        e.DorNomFichier = o.NomFichier;
        e.DorReference = o.Reference;
        e.DorRapport = o.Rapport;
        e.DorDate = DateTimeOffset.UtcNow;
        e.DorUtilisateur = u.Code;
        await db.SaveChangesAsync(ct);
    }
}
