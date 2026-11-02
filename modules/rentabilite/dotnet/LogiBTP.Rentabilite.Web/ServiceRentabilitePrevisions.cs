using System.Text.Json;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Rentabilite.Web;

/// <summary>Saisie prévisionnelle relue (table rentabilite_prevision).</summary>
public sealed record PrevisionLue(long Id, int ChaId, long? OrdreId, string Indicateur, string Composante, int? NatId, DateOnly Date, decimal Pa, decimal Pr,
    decimal Pv, string Libelle, string? Motif, int? TiersId, DateOnly? Echeance, string? PieceAttendue, DateOnly? SoldeeLe, long? SoldeEntId, string? SoldeMotif,
    string? SoldePar, string CreePar, DateTimeOffset CreeLe, string? MajPar, DateTimeOffset? MajLe, int Version)
{
    /// <summary>La saisie telle qu'elle a été faite (pour son fait).</summary>
    public SaisiePrevision Saisie() => new(Indicateur, Composante, Date, OrdreId, NatId, Pa, Pr, Pv, Libelle, Motif, TiersId, Echeance, PieceAttendue, Version);
}

/// <summary>Saisie affichée : la saisie, son état du jour (ouverte, échue, soldée), le nom de son tiers, la pièce qui la solde.</summary>
public sealed record PrevisionAffichee(PrevisionLue Prevision, string Etat, string? Tiers, PieceRentabilite? SoldePiece);

/// <summary>Pièce réelle arrivée après une saisie (même chantier, indicateur, composante, nature, tiers) : solde proposé (§ 10.1).</summary>
public sealed record PropositionSolde(long PrevisionId, long EntId, PieceRentabilite? Piece, decimal Pa, decimal Pr, decimal Pv);

/// <summary>Ligne du journal d'une saisie : action, état avant et après, auteur, date.</summary>
public sealed record JournalPrevision(long Id, string Action, string? Avant, string? Apres, string Par, DateTimeOffset Le);

/// <summary>Saisies prévisionnelles d'un chantier : saisies, propositions de solde, axes de la saisie (natures, ordres).</summary>
public sealed record PrevisionsChantier(ChantierRentabilite Chantier, bool VoirCouts, IReadOnlyList<PrevisionAffichee> Previsions, IReadOnlyList<PropositionSolde> Propositions,
    IReadOnlyList<NatureRentabilite> Natures, IReadOnlyList<OrdreRentabilite> Ordres);

/// <summary>Solde d'une saisie : date (aujourd'hui par défaut), pièce qui la remplace, motif.</summary>
public sealed record SoldeDemande(DateOnly? Le, long? EntId, string? Motif);

/// <summary>Saisies prévisionnelles (ANALYSE-MODULE-ANALYSE.md § 10.1, lot 6).</summary>
public partial class ServiceRentabilite
{
    private const string ColonnesPrevision = """
        rpr_id AS id, rpr_cha_id AS cha_id, rpr_ordre_id AS ordre_id, rpr_indicateur AS indicateur, rpr_composante AS composante, rpr_nat_id AS nat_id,
        rpr_date AS date, rpr_montant_pa AS pa, rpr_montant_pr AS pr, rpr_montant_pv AS pv, rpr_libelle AS libelle, rpr_motif AS motif,
        rpr_tiers_id AS tiers_id, rpr_echeance AS echeance, rpr_piece_attendue AS piece_attendue, rpr_soldee_le AS soldee_le,
        rpr_solde_ent_id AS solde_ent_id, rpr_solde_motif AS solde_motif, rpr_solde_par AS solde_par, rpr_cree_par AS cree_par, rpr_cree_le AS cree_le,
        rpr_maj_par AS maj_par, rpr_maj_le AS maj_le, rpr_version AS version
        """;

    private static readonly JsonSerializerOptions JsonJournal = new(JsonSerializerDefaults.Web) { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

    /// <summary>Faits des saisies ni soldées ni supprimées d'un chantier (ajoutés à ceux de la spécialisation à chaque calcul).</summary>
    private async Task<List<Fait>> FaitsPrevisionsAsync(int chantier, CancellationToken ct) =>
        (await LirePrevisionsAsync(chantier, null, ct)).Where(p => p.SoldeeLe is null).Select(p => Previsions.Fait(chantier, p.Id, p.Saisie())).ToList();

    private Task<List<PrevisionLue>> LirePrevisionsAsync(int? chantier, long? id, CancellationToken ct) =>
        db.Database.SqlQueryRaw<PrevisionLue>($"""
            SELECT {ColonnesPrevision} FROM rentabilite_prevision
            WHERE rpr_supprimee_le IS NULL AND (@cha::int IS NULL OR rpr_cha_id = @cha) AND (@id::bigint IS NULL OR rpr_id = @id)
            ORDER BY rpr_date, rpr_id
            """, new Npgsql.NpgsqlParameter("cha", NpgsqlTypes.NpgsqlDbType.Integer) { Value = (object?)chantier ?? DBNull.Value },
            new Npgsql.NpgsqlParameter("id", NpgsqlTypes.NpgsqlDbType.Bigint) { Value = (object?)id ?? DBNull.Value }).ToListAsync(ct);

    /// <summary>Saisies d'un chantier (soldées comprises), état du jour, tiers et pièces de solde, propositions de solde.</summary>
    public async Task<PrevisionsChantier> PrevisionsAsync(IServiceProvider services, Utilisateur u, int chantier, CancellationToken ct)
    {
        var (c, p) = await AccesAsync(services, u, chantier, ct);
        var lues = await LirePrevisionsAsync(chantier, null, ct);
        var propositions = await PropositionsAsync(chantier, lues, ct);
        var pieces = await spec.PiecesAsync(db, lues.Where(x => x.SoldeEntId is not null).Select(x => x.SoldeEntId!.Value)
            .Concat(propositions.Select(x => x.EntId)).Distinct().ToArray(), ct);
        var tiers = await spec.TiersAsync(db, lues.Where(x => x.TiersId is not null).Select(x => x.TiersId!.Value).Distinct().ToArray(), ct);
        var previsions = lues.Select(x => Afficher(p.VoirCouts ? x : x with { Pa = 0, Pr = 0 }, pieces, tiers)).ToList();
        propositions = propositions.Select(x => x with { Piece = pieces.GetValueOrDefault(x.EntId) })
            .Where(x => x.Piece is null || !p.TypesMasques.Contains(x.Piece.Type)).ToList();
        return new PrevisionsChantier(c, p.VoirCouts, previsions, propositions, await spec.NaturesAsync(db, ct), await spec.OrdresAsync(db, chantier, ct));
    }

    private PrevisionAffichee Afficher(PrevisionLue x, IReadOnlyDictionary<long, PieceRentabilite> pieces, IReadOnlyDictionary<int, string> tiers) =>
        new(x, Previsions.Etat(x.SoldeeLe, x.Echeance, Aujourdhui), x.TiersId is { } t ? tiers.GetValueOrDefault(t) : null,
            x.SoldeEntId is { } e ? pieces.GetValueOrDefault(e) : null);

    private sealed record PropositionSql(long PrevisionId, long EntId, decimal Pa, decimal Pr, decimal Pv);

    /// <summary>
    /// Propositions de solde : pour chaque saisie ouverte, pièces réelles dont les faits ont été connus après la saisie
    /// (calcul postérieur à sa création), de même indicateur et composante, de même nature si la saisie en a une, de même
    /// tiers si elle en a un, et qui ne soldent pas déjà une autre saisie.
    /// </summary>
    private async Task<List<PropositionSolde>> PropositionsAsync(int chantier, IReadOnlyList<PrevisionLue> lues, CancellationToken ct)
    {
        if (!lues.Any(x => x.SoldeeLe is null)) return [];
        var sql = await db.Database.SqlQuery<PropositionSql>($"""
            SELECT p.rpr_id AS prevision_id, f.afa_ent_id AS ent_id, sum(f.afa_montant_pa) AS pa, sum(f.afa_montant_pr) AS pr, sum(f.afa_montant_pv) AS pv
            FROM rentabilite_prevision p
            JOIN rentabilite_fait f ON f.afa_cha_id = p.rpr_cha_id AND f.afa_calcul_fin IS NULL AND f.afa_indicateur = p.rpr_indicateur
                 AND f.afa_composante = p.rpr_composante AND f.afa_source_type = {SourceFait.Document} AND f.afa_ent_id IS NOT NULL
                 AND (p.rpr_nat_id IS NULL OR f.afa_nat_id = p.rpr_nat_id)
            JOIN rentabilite_calcul k ON k.rca_id = f.afa_calcul_debut AND k.rca_debut >= p.rpr_cree_le
            WHERE p.rpr_cha_id = {chantier} AND p.rpr_soldee_le IS NULL AND p.rpr_supprimee_le IS NULL
              AND NOT EXISTS (SELECT 1 FROM rentabilite_prevision o WHERE o.rpr_solde_ent_id = f.afa_ent_id AND o.rpr_supprimee_le IS NULL)
            GROUP BY 1, 2
            ORDER BY 1, 2
            """).ToListAsync(ct);
        if (sql.Count == 0) return [];
        var pieces = await spec.PiecesAsync(db, sql.Select(x => x.EntId).Distinct().ToArray(), ct);
        var parId = lues.ToDictionary(x => x.Id);
        return sql.Where(x => parId[x.PrevisionId].TiersId is not { } t || pieces.GetValueOrDefault(x.EntId)?.TiersId == t)
            .Select(x => new PropositionSolde(x.PrevisionId, x.EntId, null, x.Pa, x.Pr, x.Pv)).ToList();
    }

    private async Task<PrevisionLue> PrevisionAsync(IServiceProvider services, Utilisateur u, long id, CancellationToken ct)
    {
        var x = (await LirePrevisionsAsync(null, id, ct)).FirstOrDefault() ?? throw ExceptionMetier.Introuvable("Saisie prévisionnelle");
        await AccesAsync(services, u, x.ChaId, ct);
        return x;
    }

    private static void Controler(SaisiePrevision s)
    {
        if (Previsions.Controler(s) is [var premiere, ..] erreurs)
            throw ExceptionMetier.Invalide(premiere.Code, string.Join(" ; ", erreurs.Select(e => e.Message)), new { erreurs });
    }

    private Task JournaliserAsync(long id, string action, PrevisionLue? avant, PrevisionLue? apres, string par, CancellationToken ct)
    {
        string? Json(PrevisionLue? x) => x is null ? null : JsonSerializer.Serialize(x, JsonJournal);
        return db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO rentabilite_prevision_journal (rpj_rpr_id, rpj_action, rpj_avant, rpj_apres, rpj_par)
            VALUES ({id}, {action}, {Json(avant)}::jsonb, {Json(apres)}::jsonb, {par})
            """, ct);
    }

    /// <summary>Après une écriture : le chantier est recalculé (les faits prévus sont ceux du calcul suivant).</summary>
    private Task<ResumeCalcul> ApresEcritureAsync(int chantier, string action, Utilisateur u, CancellationToken ct) =>
        RecalculerAsync(chantier, Declencheur.Manuel, $"Saisie prévisionnelle ({action})", u.Code, ct);

    /// <summary>Crée une saisie sur un chantier visible, la journalise et recalcule le chantier.</summary>
    public async Task<PrevisionLue> CreerPrevisionAsync(IServiceProvider services, Utilisateur u, int chantier, SaisiePrevision s, CancellationToken ct)
    {
        await AccesAsync(services, u, chantier, ct);
        await spec.AutoriserPrevisionAsync(services, u, ActionsDroits.Creer, ct);
        Controler(s);
        var (pa, pr, pv) = Previsions.Montants(s);
        var composante = Previsions.ComposanteDe(s.Indicateur, s.Composante);
        long id;
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            id = (await db.Database.SqlQuery<long>($"""
                INSERT INTO rentabilite_prevision (rpr_cha_id, rpr_ordre_id, rpr_indicateur, rpr_composante, rpr_nat_id, rpr_date, rpr_montant_pa, rpr_montant_pr,
                    rpr_montant_pv, rpr_libelle, rpr_motif, rpr_tiers_id, rpr_echeance, rpr_piece_attendue, rpr_cree_par)
                VALUES ({chantier}, {s.OrdreId}, {s.Indicateur}, {composante}, {s.NatId}, {s.Date}, {pa}, {pr}, {pv}, {s.Libelle!.Trim()}, {Vide(s.Motif)},
                    {s.TiersId}, {s.Echeance}, {Vide(s.PieceAttendue)}, {u.Code})
                RETURNING rpr_id AS "Value"
                """).ToListAsync(ct)).Single();
            var apres = (await LirePrevisionsAsync(null, id, ct)).Single();
            await JournaliserAsync(id, ActionPrevision.Creation, null, apres, u.Code, ct);
            await tx.CommitAsync(ct);
        }
        await ApresEcritureAsync(chantier, ActionPrevision.Creation, u, ct);
        return (await LirePrevisionsAsync(null, id, ct)).Single();
    }

    /// <summary>Modifie une saisie ouverte (version attendue : 409 si elle a changé entre-temps), la journalise et recalcule.</summary>
    public async Task<PrevisionLue> ModifierPrevisionAsync(IServiceProvider services, Utilisateur u, long id, SaisiePrevision s, CancellationToken ct)
    {
        var avant = await PrevisionAsync(services, u, id, ct);
        await spec.AutoriserPrevisionAsync(services, u, ActionsDroits.Modifier, ct);
        if (avant.SoldeeLe is not null) throw ExceptionMetier.Conflit(ErreurPrevision.Soldee, "Saisie soldée : la rouvrir pour la modifier");
        Controler(s);
        var (pa, pr, pv) = Previsions.Montants(s);
        var composante = Previsions.ComposanteDe(s.Indicateur, s.Composante);
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            var n = await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE rentabilite_prevision SET rpr_ordre_id = {s.OrdreId}, rpr_indicateur = {s.Indicateur}, rpr_composante = {composante}, rpr_nat_id = {s.NatId},
                    rpr_date = {s.Date}, rpr_montant_pa = {pa}, rpr_montant_pr = {pr}, rpr_montant_pv = {pv}, rpr_libelle = {s.Libelle!.Trim()},
                    rpr_motif = {Vide(s.Motif)}, rpr_tiers_id = {s.TiersId}, rpr_echeance = {s.Echeance}, rpr_piece_attendue = {Vide(s.PieceAttendue)},
                    rpr_maj_par = {u.Code}, rpr_maj_le = now(), rpr_version = rpr_version + 1
                WHERE rpr_id = {id} AND rpr_supprimee_le IS NULL AND ({s.Version}::int IS NULL OR rpr_version = {s.Version})
                """, ct);
            if (n == 0) throw ExceptionMetier.Conflit(ErreurPrevision.Version, "Saisie modifiée entre-temps : relire avant de la modifier");
            await JournaliserAsync(id, ActionPrevision.Modification, avant, (await LirePrevisionsAsync(null, id, ct)).Single(), u.Code, ct);
            await tx.CommitAsync(ct);
        }
        await ApresEcritureAsync(avant.ChaId, ActionPrevision.Modification, u, ct);
        return (await LirePrevisionsAsync(null, id, ct)).Single();
    }

    /// <summary>Solde une saisie (remplacée par une pièce réelle, ou abandonnée avec un motif) : elle n'a plus de fait.</summary>
    public async Task<PrevisionLue> SolderPrevisionAsync(IServiceProvider services, Utilisateur u, long id, SoldeDemande d, CancellationToken ct)
    {
        var avant = await PrevisionAsync(services, u, id, ct);
        await spec.AutoriserPrevisionAsync(services, u, ActionsDroits.Modifier, ct);
        if (avant.SoldeeLe is not null) throw ExceptionMetier.Conflit(ErreurPrevision.Soldee, "Saisie déjà soldée");
        if (d.EntId is null && string.IsNullOrWhiteSpace(d.Motif))
            throw ExceptionMetier.Invalide(ErreurPrevision.Soldee, "Pièce qui remplace la saisie ou motif obligatoire");
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE rentabilite_prevision SET rpr_soldee_le = {d.Le ?? Aujourdhui}, rpr_solde_ent_id = {d.EntId}, rpr_solde_motif = {Vide(d.Motif)},
                    rpr_solde_par = {u.Code}, rpr_maj_par = {u.Code}, rpr_maj_le = now(), rpr_version = rpr_version + 1
                WHERE rpr_id = {id}
                """, ct);
            await JournaliserAsync(id, ActionPrevision.Solde, avant, (await LirePrevisionsAsync(null, id, ct)).Single(), u.Code, ct);
            await tx.CommitAsync(ct);
        }
        await ApresEcritureAsync(avant.ChaId, ActionPrevision.Solde, u, ct);
        return (await LirePrevisionsAsync(null, id, ct)).Single();
    }

    /// <summary>Rouvre une saisie soldée (solde retiré) : son fait revient au calcul suivant.</summary>
    public async Task<PrevisionLue> RouvrirPrevisionAsync(IServiceProvider services, Utilisateur u, long id, CancellationToken ct)
    {
        var avant = await PrevisionAsync(services, u, id, ct);
        await spec.AutoriserPrevisionAsync(services, u, ActionsDroits.Modifier, ct);
        if (avant.SoldeeLe is null) return avant;
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE rentabilite_prevision SET rpr_soldee_le = NULL, rpr_solde_ent_id = NULL, rpr_solde_motif = NULL, rpr_solde_par = NULL,
                    rpr_maj_par = {u.Code}, rpr_maj_le = now(), rpr_version = rpr_version + 1
                WHERE rpr_id = {id}
                """, ct);
            await JournaliserAsync(id, ActionPrevision.Reouverture, avant, (await LirePrevisionsAsync(null, id, ct)).Single(), u.Code, ct);
            await tx.CommitAsync(ct);
        }
        await ApresEcritureAsync(avant.ChaId, ActionPrevision.Reouverture, u, ct);
        return (await LirePrevisionsAsync(null, id, ct)).Single();
    }

    /// <summary>Supprime une saisie (gardée avec son journal, sans fait).</summary>
    public async Task SupprimerPrevisionAsync(IServiceProvider services, Utilisateur u, long id, CancellationToken ct)
    {
        var avant = await PrevisionAsync(services, u, id, ct);
        await spec.AutoriserPrevisionAsync(services, u, ActionsDroits.Supprimer, ct);
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE rentabilite_prevision SET rpr_supprimee_le = now(), rpr_maj_par = {u.Code}, rpr_maj_le = now(), rpr_version = rpr_version + 1
                WHERE rpr_id = {id}
                """, ct);
            await JournaliserAsync(id, ActionPrevision.Suppression, avant, null, u.Code, ct);
            await tx.CommitAsync(ct);
        }
        await ApresEcritureAsync(avant.ChaId, ActionPrevision.Suppression, u, ct);
    }

    /// <summary>Journal d'une saisie (le plus récent d'abord).</summary>
    public async Task<List<JournalPrevision>> JournalPrevisionAsync(IServiceProvider services, Utilisateur u, long id, CancellationToken ct)
    {
        await PrevisionAsync(services, u, id, ct);
        return await db.Database.SqlQuery<JournalPrevision>($"""
            SELECT rpj_id AS id, rpj_action AS action, rpj_avant::text AS avant, rpj_apres::text AS apres, rpj_par AS par, rpj_le AS le
            FROM rentabilite_prevision_journal WHERE rpj_rpr_id = {id} ORDER BY rpj_id DESC
            """).ToListAsync(ct);
    }

    private static string? Vide(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();
}
