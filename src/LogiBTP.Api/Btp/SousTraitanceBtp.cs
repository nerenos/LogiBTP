using LogiBTP.Socle.Web;
using LogiBTP.SousTraitance;
using LogiBTP.SousTraitance.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Spécialisation du module Sous-traitance par le cœur (ANALYSE-MODULE-SOUS-TRAITANCE.md § 5.3) : marchés de
/// sous-traitance (`marche` de sens ST : sous-traitant, public, garantie, montant), pièces fournies = documents de la GED
/// du sous-traitant (élément `personne`, portée TIERS) et du marché (élément `marche`, portée MARCHE) par leur catégorie,
/// fin de validité saisie (`dge_valide_au`, module GED 052).
/// </summary>
public class SpecialisationSousTraitanceBtp : SpecialisationSousTraitance
{
    private sealed record LigneMarche(int Id, long? TiersId, bool Public, string? Garantie, decimal MontantHt, string? Libelle);
    private sealed record LignePiece(string Categorie, string Portee, long DgeId, DateOnly? DeposeLe, DateOnly? ValideAu);

    public override async Task<MarcheSousTraitance?> MarcheAsync(SousTraitanceDbContext db, int id, CancellationToken ct)
    {
        var m = await db.Database.SqlQueryRaw<LigneMarche>("""
            SELECT mar_id AS id, mar_tiers_id AS tiers_id, mar_nature = 'U' AS public, mar_garantie AS garantie, coalesce(mar_montant_ht, 0) AS montant_ht,
                   mar_libelle AS libelle
            FROM marche WHERE mar_id = @id AND mar_sens = 'ST'
            """, new NpgsqlParameter("id", id)).FirstOrDefaultAsync(ct);
        return m is null ? null : new MarcheSousTraitance(m.Id, m.TiersId, m.Public, m.Garantie, m.MontantHt, m.Libelle);
    }

    public override async Task<List<PieceFournie>> PiecesAsync(SousTraitanceDbContext db, long tiers, int? marche, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<LignePiece>("""
            SELECT d.dge_categorie AS categorie, CASE d.dge_type_element WHEN 'marche' THEN 'MARCHE' ELSE 'TIERS' END AS portee, d.dge_id,
                   coalesce(d.dge_date_document, d.dge_cree_le::date) AS depose_le, d.dge_valide_au AS valide_au
            FROM document_ged d
            WHERE NOT d.dge_supprime AND d.dge_categorie IS NOT NULL AND d.dge_parent_id IS NULL
              AND ((d.dge_type_element = 'personne' AND d.dge_id_element = @t) OR (d.dge_type_element = 'marche' AND d.dge_id_element = @m))
            """, new NpgsqlParameter("t", tiers.ToString()), new NpgsqlParameter("m", NpgsqlDbType.Text) { Value = (object?)marche?.ToString() ?? DBNull.Value })
            .ToListAsync(ct)).Select(p => new PieceFournie(p.Categorie, p.Portee, p.DgeId, p.DeposeLe, p.ValideAu)).ToList();

    public override async Task DefinirValiditeAsync(SousTraitanceDbContext db, long piece, DateOnly? valideAu, Utilisateur u, CancellationToken ct)
    {
        var n = await db.Database.ExecuteSqlRawAsync("""
            UPDATE document_ged SET dge_valide_au = @v, dge_modifie_le = now()
            WHERE dge_id = @id AND NOT dge_supprime AND dge_type_element IN ('personne', 'marche')
            """, [new NpgsqlParameter("v", NpgsqlDbType.Date) { Value = (object?)valideAu ?? DBNull.Value }, new NpgsqlParameter("id", piece)], ct);
        if (n == 0) throw ExceptionMetier.Introuvable($"Pièce {piece}");
    }

    /// <summary>
    /// Contrôle des pièces à la validation (ST13) : commande de sous-traitance (action COMMANDE) et facture de
    /// sous-traitance (FACTURE) refusées tant qu'une pièce bloquante manque ou a expiré ; module actif seulement.
    /// </summary>
    public static async Task ControlerPiecesAsync(IServiceProvider? services, string typeCode, int? marche, List<LogiBTP.Socle.MessageCalcul> erreurs, CancellationToken ct)
    {
        var action = typeCode switch { "T_COMMANDE" => "COMMANDE", "T_FACTURE_AVT" => "FACTURE", _ => null };
        if (action is null || marche is not int m || services is null) return;
        if (!await services.GetRequiredService<ModulesSociete>().EstActifAsync("sous_traitance", ct)) return;
        var pieces = await services.GetRequiredService<ServiceSousTraitance>().BloquantsAsync(m, action, ct);
        if (pieces.Count > 0)
        {
            erreurs.Add(new LogiBTP.Socle.MessageCalcul(null, "ST_PIECES", $"Pièces du sous-traitant à fournir : {string.Join(", ", pieces)}"));
        }
    }
}
