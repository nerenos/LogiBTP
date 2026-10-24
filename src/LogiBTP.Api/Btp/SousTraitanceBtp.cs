using LogiBTP.Crm.Web;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
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
/// fin de validité saisie (`dge_valide_au`, module GED 052) ; paiement direct (§ 5.5) : factures de sous-traitance du
/// marché, factures au client du marché de vente lié (sinon du chantier), lien `PAIEMENT_DIRECT` et poste du sous-traitant
/// sur le marché de vente (la déduction vaut le montant accepté : `PostesMarche.Appliquer`), tâche du CRM au service Chantier.
/// </summary>
public class SpecialisationSousTraitanceBtp : SpecialisationSousTraitance
{
    private sealed record LigneMarche(int Id, long? TiersId, bool Public, string? Garantie, decimal MontantHt, string? Libelle, decimal? MontantAgree, bool Autoliquidation);
    private sealed record LigneFacture(long Id, int MarcheId, string? Numero, string? Reference, DateOnly? Date, decimal Ht, decimal Ttc, bool Valide, bool Annule);
    private sealed record LigneFactureClient(long Id, string? Numero, DateOnly? Date, decimal Ttc, bool Valide);

    // Facture reçue : montants saisis du sous-traitant, sinon totaux calculés de la pièce.
    private const string SqlFactures = """
        SELECT d.ent_id AS id, d.ent_marche_id AS marche_id, d.ent_numero AS numero, d.ent_reference_externe AS reference, d.ent_date AS date,
               coalesce(d.ent_st_recu_ht, d.ent_total_ht, 0) AS ht, coalesce(d.ent_st_recu_ttc, d.ent_total_ttc, 0) AS ttc, d.ent_verrouille AS valide,
               s.std_code = 'ANNULE' AS annule
        FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document s ON s.std_id = d.ent_std_id
        JOIN marche m ON m.mar_id = d.ent_marche_id AND m.mar_sens = 'ST'
        WHERE t.tyd_code = 'T_FACTURE_AVT' AND d.ent_nature_avoir IS NULL
        """;
    private sealed record LignePiece(string Categorie, string Portee, long DgeId, DateOnly? DeposeLe, DateOnly? ValideAu);

    public override async Task<MarcheSousTraitance?> MarcheAsync(SousTraitanceDbContext db, int id, CancellationToken ct)
    {
        var m = await db.Database.SqlQueryRaw<LigneMarche>("""
            SELECT mar_id AS id, mar_tiers_id AS tiers_id, mar_nature = 'U' AS public, mar_garantie AS garantie, coalesce(mar_montant_ht, 0) AS montant_ht,
                   mar_libelle AS libelle, mar_montant_agree AS montant_agree, mar_autoliquidation AS autoliquidation
            FROM marche WHERE mar_id = @id AND mar_sens = 'ST'
            """, new NpgsqlParameter("id", id)).FirstOrDefaultAsync(ct);
        return m is null ? null : new MarcheSousTraitance(m.Id, m.TiersId, m.Public, m.Garantie, m.MontantHt, m.Libelle, m.MontantAgree, m.Autoliquidation);
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

    private static FactureSousTraitance Facture(LigneFacture f) => new(f.Id, f.MarcheId, f.Numero, f.Reference, f.Date, f.Ht, f.Ttc, f.Valide, f.Annule);

    public override async Task<FactureSousTraitance?> FactureAsync(SousTraitanceDbContext db, long id, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<LigneFacture>(SqlFactures + " AND d.ent_id = @id", new NpgsqlParameter("id", id)).ToListAsync(ct)).Select(Facture).FirstOrDefault();

    public override async Task<List<FactureSousTraitance>> FacturesAsync(SousTraitanceDbContext db, int marche, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<LigneFacture>(SqlFactures + " AND d.ent_marche_id = @m ORDER BY d.ent_rang_avancement NULLS LAST, d.ent_id",
            new NpgsqlParameter("m", marche)).ToListAsync(ct)).Select(Facture).ToList();

    /// <summary>Factures et factures d'avancement non annulées du marché de vente lié, sinon factures directes du chantier (ST5).</summary>
    public override async Task<List<FactureClient>> FacturesClientsAsync(SousTraitanceDbContext db, int marche, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<LigneFactureClient>("""
            SELECT d.ent_id AS id, d.ent_numero AS numero, d.ent_date AS date, coalesce(d.ent_total_ttc, 0) AS ttc, d.ent_verrouille AS valide
            FROM marche st JOIN document d ON (st.mar_marche_vente_id IS NOT NULL AND d.ent_marche_id = st.mar_marche_vente_id)
                                           OR (st.mar_marche_vente_id IS NULL AND d.ent_chantier_id = st.mar_cha_id AND d.ent_marche_id IS NULL)
            JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document s ON s.std_id = d.ent_std_id
            WHERE st.mar_id = @m AND t.tyd_code IN ('V_FACTURE', 'V_FACTURE_AVT') AND s.std_code <> 'ANNULE' AND d.ent_nature_avoir IS NULL
            ORDER BY d.ent_date DESC, d.ent_id DESC
            """, new NpgsqlParameter("m", marche)).ToListAsync(ct))
        .Select(f => new FactureClient(f.Id, f.Numero, f.Date, f.Ttc, f.Valide)).ToList();

    /// <summary>
    /// Lien PAIEMENT_DIRECT (facture du sous-traitant → notre facture), poste PAIEMENT_DIRECT du sous-traitant créé sur le
    /// marché de vente s'il manque, puis postes réappliqués sur notre facture en brouillon (déduction visible tout de suite).
    /// </summary>
    public override async Task LierAsync(SousTraitanceDbContext db, long facture, long factureClient, Utilisateur u, CancellationToken ct)
    {
        NpgsqlParameter[] P() => [new("f", facture), new("c", factureClient)];
        await db.Database.ExecuteSqlRawAsync("INSERT INTO document_lien (lie_source_ent_id, lie_cible_ent_id, lie_type) VALUES (@f, @c, 'PAIEMENT_DIRECT') ON CONFLICT DO NOTHING", P(), ct);
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO marche_poste (mpo_mar_id, mpo_portee, mpo_type, mpo_libelle, mpo_niveau, mpo_mode, mpo_valeur, mpo_sens, mpo_per_id, mpo_ordre, mpo_actif)
            SELECT c.ent_marche_id, 'G', 'PAIEMENT_DIRECT', left('Paiement direct — ' || coalesce(p.per_raison_sociale, 'sous-traitant'), 150), 'TTC', 'M', 0, -1, s.ent_tiers_id,
                   coalesce((SELECT max(mpo_ordre) FROM marche_poste WHERE mpo_mar_id = c.ent_marche_id), 0) + 1, true
            FROM document s JOIN document c ON c.ent_id = @c LEFT JOIN personne p ON p.per_id = s.ent_tiers_id
            WHERE s.ent_id = @f AND c.ent_marche_id IS NOT NULL AND s.ent_tiers_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM marche_poste x WHERE x.mpo_mar_id = c.ent_marche_id AND x.mpo_type = 'PAIEMENT_DIRECT'
                              AND x.mpo_per_id = s.ent_tiers_id AND x.mpo_portee = 'G')
            """, P(), ct);
        if (SpecialisationBtp.Http?.HttpContext?.RequestServices is not { } services) return;
        var documents = services.GetRequiredService<DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>();
        var ctx = services.GetRequiredService<LogiBtpContext>();
        var complet = await documents.Charger(factureClient, ct);
        if (complet.Document.EntVerrouille || complet.Document.EntMarcheId is null) return;
        var type = await ctx.TypesDocument.AsNoTracking().FirstAsync(t => t.TydId == complet.Document.EntTydId, ct);
        if (await PostesMarche.Portee(ctx, type, complet.Document, ct) is string portee && await PostesMarche.Appliquer(ctx, complet, portee, ct))
        {
            await documents.Enregistrer(factureClient, complet, u, ct);
        }
    }

    private sealed record ContexteFacture(long GroupeId, int? ChantierId, string? Tiers, long? Conducteur);

    /// <summary>
    /// Demande reçue (ST16) : tâche du CRM au conducteur de travaux du chantier du marché (individu de notre structure),
    /// sinon à prendre par le service Chantier (sinon Achat) ; échéance = réception + 15 jours, rattachée à la facture, au
    /// marché et au chantier ; une tâche impossible à créer est journalisée.
    /// </summary>
    public override async Task ApresDemandeAsync(SousTraitanceDbContext db, DemandePaiement d, FactureSousTraitance f, Utilisateur u, CancellationToken ct)
    {
        if (SpecialisationBtp.Http?.HttpContext?.RequestServices is not { } services) return;
        if (!await services.GetRequiredService<ModulesSociete>().EstActifAsync("crm", ct)) return;
        try
        {
            var srv = await db.Database.SqlQueryRaw<int>(
                "SELECT srv_id AS \"Value\" FROM service WHERE srv_code IN ('CHANTIER', 'ACHAT') ORDER BY srv_code = 'CHANTIER' DESC LIMIT 1").ToListAsync(ct);
            var c = await db.Database.SqlQueryRaw<ContexteFacture>("""
                SELECT coalesce(d.ent_groupe_id, d.ent_id) AS groupe_id, coalesce(d.ent_chantier_id, m.mar_cha_id) AS chantier_id, p.per_raison_sociale AS tiers,
                       c.cha_conducteur_ind_id AS conducteur
                FROM document d LEFT JOIN personne p ON p.per_id = d.ent_tiers_id LEFT JOIN marche m ON m.mar_id = d.ent_marche_id
                LEFT JOIN chantier c ON c.cha_id = coalesce(d.ent_chantier_id, m.mar_cha_id)
                WHERE d.ent_id = @id
                """, new NpgsqlParameter("id", f.Id)).FirstAsync(ct);
            var liens = new List<LienSaisi> { new("document", c.GroupeId.ToString(), true), new("marche", f.MarcheId.ToString()) };
            if (c.ChantierId is int cha) liens.Add(new LienSaisi("chantier", cha.ToString()));
            var echeance = new DateTimeOffset(d.Delai.Echeance.ToDateTime(new TimeOnly(12, 0)));
            var mode = d.Mode == "DIRECT" ? "paiement direct" : "délégation de paiement";
            await services.GetRequiredService<ServiceCrm>().Enregistrer(null, new NoteSaisie("TACHE", "A_FAIRE", null, c.Conducteur is null && srv.Count > 0 ? srv[0] : null,
                $"Demande de {mode} à accepter : {c.Tiers ?? "sous-traitant"}, facture {f.Reference ?? f.Numero}",
                $"<p>Montant demandé : {d.MontantDemande.ToString("N2", new System.Globalization.NumberFormatInfo { NumberGroupSeparator = " ", NumberDecimalSeparator = "," })} €. À accepter ou refuser avant le {d.Delai.Echeance:dd/MM/yyyy}.</p>",
                c.Conducteur, echeance, null, false, false, false, liens, null), u, ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            services.GetRequiredService<ILoggerFactory>().CreateLogger("SousTraitance").LogWarning(e, "Tâche du CRM non créée pour la demande de paiement {Id}", d.Id);
        }
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
