using LogiBTP.Socle;
using System.Data;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using LogiBTP.Socle.Donnees;

namespace LogiBTP.Rentabilite.Web;

/// <summary>Résultat d'un calcul.</summary>
public sealed record ResumeCalcul(long Id, int Chantier, string Etat, int Faits, int Ajouts, int Retraits, int Modifies, int? Ecarts, string? Message);

/// <summary>Dernier calcul d'un chantier et sa place dans la file (§ 11.5).</summary>
public sealed record FraicheurChantier(ResumeCalculLu? Dernier, bool EnAttente, string? Raison, DateTimeOffset? Depuis, string? Erreur, int VersionRegles,
    IReadOnlyList<ResumeCalculLu> Historique);

public sealed record ResumeCalculLu(long Id, DateTimeOffset Debut, DateTimeOffset? Fin, string Declencheur, string? Raison, string? Par, int Version, string Etat,
    string? Message, int? NbFaits, int? Ajouts, int? Retraits, int? Ecarts);

/// <summary>
/// Somme des faits par ordre, nature, indicateur et composante (le client regroupe et totalise) : cumul jusqu'au <c>au</c>
/// et, si un début de période est donné, part datée de la période (§ 5.4 : budgets, déboursé, facturé sur la période ;
/// engagé et restes à la fin).
/// </summary>
public sealed record AgregatFaits(long? OrdreId, int? NatId, string Indicateur, string Composante, decimal Pa, decimal Pr, decimal Pv, decimal? Heures, int Nb,
    decimal PaPeriode, decimal PrPeriode, decimal PvPeriode, decimal? HeuresPeriode);

/// <summary>Postes de pied (composante POSTE) par indicateur, ordre et libellé, pour le bloc de résultats (§ 4.8).</summary>
public sealed record PosteFaits(long? OrdreId, string Indicateur, string Libelle, decimal Pv, decimal PvPeriode);

/// <summary>Somme des faits ouverts d'une règle de contrôle.</summary>
public sealed record ControleFaits(string Regle, int Nb, decimal Pa, decimal? Heures);

/// <summary>
/// Détail d'un chantier : agrégats (et ceux de la référence comparée : contrôle ou photo), contrôles des règles, dernier
/// contrôle de l'utilisateur et ce qui a changé depuis, photos.
/// </summary>
public sealed record DetailChantier(ChantierRentabilite Chantier, DateOnly? Du, DateOnly? Au, bool VoirCouts, FraicheurChantier Fraicheur,
    IReadOnlyList<OrdreRentabilite> Ordres, IReadOnlyList<NatureRentabilite> Natures, IReadOnlyList<AgregatFaits> Agregats, IReadOnlyList<ControleFaits> Controles,
    ControleLu? Controle, IReadOnlyList<PhotoLue> Photos, ReferenceDetail? Reference, IReadOnlyList<PosteFaits> Postes);

/// <summary>
/// Filtre de la page des faits (un chiffre du Détail) : indicateurs et natures en listes (nature 0 = « Non ventilé »),
/// ordre 0 = « Sans ordre », composante préfixée de « ! » = toutes sauf celle-ci.
/// </summary>
public sealed record FiltreFaits(string[]? Indicateurs, int[]? Natures, long? Ordre, string? Composante, long? Piece, DateOnly? Du, DateOnly? Au)
{
    /// <summary>Filtre lu dans l'adresse : listes séparées par des virgules.</summary>
    public static FiltreFaits Lire(string? indicateur, string? nature, long? ordre, string? composante, long? piece, DateOnly? du, DateOnly? au)
    {
        static string[]? Liste(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var natures = Liste(nature)?.Select(x => int.TryParse(x, out var n) ? n : throw ExceptionMetier.Invalide("RENTABILITE_FILTRE", $"Nature invalide : {x}")).ToArray();
        return new FiltreFaits(Liste(indicateur), natures, ordre, string.IsNullOrWhiteSpace(composante) ? null : composante.Trim(), piece, du, au);
    }
}

public sealed record FaitLu(long AfaId, long? AfaOrdreId, int? AfaMarId, string AfaIndicateur, string AfaComposante, DateOnly AfaDate, int? AfaNatId,
    decimal? AfaQte, string? AfaUnite, decimal? AfaMontantPa, decimal? AfaMontantPr, decimal AfaMontantPv, decimal? AfaHeures, string AfaSourceType,
    string? AfaTypePiece, long? AfaEntId, long? AfaLigId, long? AfaSourceId, string AfaRegle, string? AfaLibelle, long AfaCalculDebut);

/// <summary>Pièces d'un type dont l'utilisateur ne consulte pas le détail : montant global seulement (V65).</summary>
public sealed record FaitsMasques(string Type, int Pieces, int Faits, decimal Pv, decimal? Pa, decimal? Pr);

public sealed record FaitsChantier(ChantierRentabilite Chantier, bool VoirCouts, IReadOnlyList<FaitLu> Faits, IReadOnlyDictionary<long, PieceRentabilite> Pieces,
    IReadOnlyList<FaitsMasques> Masques, IReadOnlyList<NatureRentabilite> Natures, IReadOnlyList<OrdreRentabilite> Ordres);

public sealed record LigneRapprochementLue(string SourceType, long? EntId, PieceRentabilite? Piece, string Indicateur, string Champ, decimal Attendu, decimal Faits,
    decimal Ecart, string Libelle);

/// <summary>
/// Faits versionnés du module (§ 10.4, § 11) : recalcul d'un chantier entier dans une transaction (verrou par chantier,
/// seules les différences s'écrivent), file vidée par le planificateur, recalcul de nuit avec comparaison, lectures du
/// Détail, des faits d'un chiffre et du rapprochement.
/// </summary>
public partial class ServiceRentabilite(RentabiliteDbContext db, SpecialisationRentabilite spec, TimeProvider horloge)
{
    private const int VerrouModule = 7_340_201;

    private DateOnly Aujourdhui => DateOnly.FromDateTime(horloge.GetLocalNow().DateTime);

    // ---------------------------------------------------------------- recalcul

    /// <summary>Recalcule les faits d'un chantier et n'écrit que la différence ; un calcul en erreur est noté et relancé.</summary>
    public async Task<ResumeCalcul> RecalculerAsync(int chantier, string declencheur, string? raison, string? par, CancellationToken ct)
    {
        try
        {
            return await CalculerDansTransactionAsync(chantier, declencheur, raison, par, retirerDeLaFile: true, ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            db.ChangeTracker.Clear();
            var message = e.Message.Length > 2000 ? e.Message[..2000] : e.Message;
            var id = await db.Database.SqlQuery<long>($"""
                INSERT INTO rentabilite_calcul (rca_cha_id, rca_declencheur, rca_raison, rca_par, rca_version, rca_etat, rca_message, rca_fin)
                VALUES ({chantier}, {declencheur}, {raison}, {par}, {spec.VersionRegles}, {EtatCalcul.Erreur}, {message}, now())
                RETURNING rca_id AS "Value"
                """).ToListAsync(ct);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO rentabilite_a_recalculer (arq_cha_id, arq_raison, arq_tentatives, arq_erreur, arq_apres)
                VALUES ({chantier}, {raison ?? declencheur}, 1, {message}, now() + interval '1 minute')
                ON CONFLICT (arq_cha_id) DO UPDATE SET arq_tentatives = rentabilite_a_recalculer.arq_tentatives + 1, arq_erreur = EXCLUDED.arq_erreur,
                    arq_apres = now() + least(interval '1 day', interval '1 minute' * power(2, rentabilite_a_recalculer.arq_tentatives))
                """, ct);
            return new ResumeCalcul(id.FirstOrDefault(), chantier, EtatCalcul.Erreur, 0, 0, 0, 0, null, message);
        }
    }

    private async Task<ResumeCalcul> CalculerDansTransactionAsync(int chantier, string declencheur, string? raison, string? par, bool retirerDeLaFile, CancellationToken ct)
    {
        await using var tx = await db.Unite().CommencerAsync(IsolationLevel.ReadCommitted, ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({VerrouModule}, {chantier})", ct);
        // Retiré de la file avant le calcul : un signalement arrivé pendant le calcul le remet dans la file.
        if (retirerDeLaFile) await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM rentabilite_a_recalculer WHERE arq_cha_id = {chantier}", ct);
        var calcul = (await db.Database.SqlQuery<long>($"""
            INSERT INTO rentabilite_calcul (rca_cha_id, rca_declencheur, rca_raison, rca_par, rca_version)
            VALUES ({chantier}, {declencheur}, {raison}, {par}, {spec.VersionRegles}) RETURNING rca_id AS "Value"
            """).ToListAsync(ct)).Single();
        var nouveaux = await spec.CalculerAsync(db, chantier, Aujourdhui, ct);
        // Saisies prévisionnelles (lot 6) : faits PREVU_* écrits par le module, jamais par la spécialisation.
        nouveaux.AddRange(await FaitsPrevisionsAsync(chantier, ct));
        if (nouveaux.FirstOrDefault(f => f.ChaId != chantier) is { } autre)
            throw new InvalidOperationException($"Fait d'un autre chantier ({autre.ChaId}) dans le calcul du chantier {chantier}");
        var anciens = await LireOuvertsAsync(chantier, ct);
        var diff = ComparaisonFaits.Comparer(anciens, nouveaux);
        if (diff.Retraits.Count > 0)
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE rentabilite_fait SET afa_calcul_fin = {calcul} WHERE afa_id = ANY({diff.Retraits.ToArray()})", ct);
        if (diff.Ajouts.Count > 0) await InsererAsync(diff.Ajouts, calcul, ct);
        // Recalcul de nuit : toute différence hors faits du jour vient d'un événement non signalé (V63).
        int? ecarts = null;
        if (declencheur == Declencheur.Nuit)
        {
            var retires = anciens.Where(a => diff.Retraits.Contains(a.Id)).Select(a => a.Fait);
            ecarts = retires.Count(f => !spec.DependDuJour(f)) + diff.Ajouts.Count(f => !spec.DependDuJour(f));
        }
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE rentabilite_calcul SET rca_fin = now(), rca_etat = {EtatCalcul.Ok}, rca_nb_faits = {nouveaux.Count}, rca_ajouts = {diff.Ajouts.Count},
                rca_retraits = {diff.Retraits.Count}, rca_ecarts = {ecarts}
            WHERE rca_id = {calcul}
            """, ct);
        await tx.CommitAsync(ct);
        return new ResumeCalcul(calcul, chantier, EtatCalcul.Ok, nouveaux.Count, diff.Ajouts.Count, diff.Retraits.Count, diff.Modifies, ecarts, null);
    }

    private async Task<List<FaitConnu>> LireOuvertsAsync(int chantier, CancellationToken ct) =>
        (await db.Database.SqlQuery<FaitLu>($"""
            SELECT afa_id, afa_ordre_id, afa_mar_id, afa_indicateur, afa_composante, afa_date, afa_nat_id, afa_qte, afa_unite, afa_montant_pa, afa_montant_pr,
                   afa_montant_pv, afa_heures, afa_source_type, afa_type_piece, afa_ent_id, afa_lig_id, afa_source_id, afa_regle, afa_libelle, afa_calcul_debut
            FROM rentabilite_fait WHERE afa_cha_id = {chantier} AND afa_calcul_fin IS NULL
            """).ToListAsync(ct))
        .Select(f => new FaitConnu(f.AfaId, new Fait(chantier, f.AfaOrdreId, f.AfaMarId, f.AfaIndicateur, f.AfaComposante, f.AfaDate, f.AfaNatId, f.AfaQte, f.AfaUnite,
            f.AfaMontantPa ?? 0, f.AfaMontantPr ?? 0, f.AfaMontantPv, f.AfaHeures, f.AfaSourceType, f.AfaTypePiece, f.AfaEntId, f.AfaLigId, f.AfaSourceId, f.AfaRegle,
            f.AfaLibelle))).ToList();

    /// <summary>Écriture des faits ajoutés par COPY binaire (dans la transaction en cours).</summary>
    private async Task InsererAsync(IReadOnlyList<Fait> faits, long calcul, CancellationToken ct)
    {
        var cnx = (NpgsqlConnection)db.Database.GetDbConnection();
        await using var copie = await cnx.BeginBinaryImportAsync("""
            COPY rentabilite_fait (afa_cha_id, afa_ordre_id, afa_mar_id, afa_indicateur, afa_composante, afa_date, afa_nat_id, afa_qte, afa_unite,
                afa_montant_pa, afa_montant_pr, afa_montant_pv, afa_heures, afa_source_type, afa_type_piece, afa_ent_id, afa_lig_id, afa_source_id,
                afa_regle, afa_libelle, afa_calcul_debut) FROM STDIN (FORMAT BINARY)
            """, ct);
        static async Task Ecrire<T>(NpgsqlBinaryImporter c, T? v, NpgsqlDbType t, CancellationToken ct) where T : struct
        {
            if (v is { } x) await c.WriteAsync(x, t, ct); else await c.WriteNullAsync(ct);
        }
        static async Task Texte(NpgsqlBinaryImporter c, string? v, CancellationToken ct)
        {
            if (v is null) await c.WriteNullAsync(ct); else await c.WriteAsync(v, NpgsqlDbType.Text, ct);
        }
        foreach (var f in faits)
        {
            await copie.StartRowAsync(ct);
            await copie.WriteAsync(f.ChaId, NpgsqlDbType.Integer, ct);
            await Ecrire(copie, f.OrdreId, NpgsqlDbType.Bigint, ct);
            await Ecrire(copie, f.MarId, NpgsqlDbType.Integer, ct);
            await copie.WriteAsync(f.Indicateur, NpgsqlDbType.Varchar, ct);
            await copie.WriteAsync(f.Composante, NpgsqlDbType.Varchar, ct);
            await copie.WriteAsync(f.Date, NpgsqlDbType.Date, ct);
            await Ecrire(copie, f.NatId, NpgsqlDbType.Integer, ct);
            await Ecrire(copie, f.Qte, NpgsqlDbType.Numeric, ct);
            await Texte(copie, f.Unite, ct);
            await copie.WriteAsync(f.MontantPa, NpgsqlDbType.Numeric, ct);
            await copie.WriteAsync(f.MontantPr, NpgsqlDbType.Numeric, ct);
            await copie.WriteAsync(f.MontantPv, NpgsqlDbType.Numeric, ct);
            await Ecrire(copie, f.Heures, NpgsqlDbType.Numeric, ct);
            await copie.WriteAsync(f.SourceType, NpgsqlDbType.Varchar, ct);
            await Texte(copie, f.TypePiece, ct);
            await Ecrire(copie, f.EntId, NpgsqlDbType.Bigint, ct);
            await Ecrire(copie, f.LigId, NpgsqlDbType.Bigint, ct);
            await Ecrire(copie, f.SourceId, NpgsqlDbType.Bigint, ct);
            await copie.WriteAsync(f.Regle, NpgsqlDbType.Varchar, ct);
            await Texte(copie, f.Libelle, ct);
            await copie.WriteAsync(calcul, NpgsqlDbType.Bigint, ct);
        }
        await copie.CompleteAsync(ct);
    }

    /// <summary>Vide une partie de la file (chantiers prêts, prioritaires d'abord) ; renvoie le nombre de chantiers traités.</summary>
    public async Task<int> TraiterFileAsync(int maximum, CancellationToken ct)
    {
        var chantiers = await db.Database.SqlQuery<int>($"""
            SELECT arq_cha_id AS "Value" FROM rentabilite_a_recalculer WHERE arq_apres IS NULL OR arq_apres <= now()
            ORDER BY arq_prioritaire DESC, arq_depuis LIMIT {maximum}
            """).ToListAsync(ct);
        foreach (var c in chantiers)
        {
            var raison = (await db.Database.SqlQuery<string?>($"SELECT arq_raison AS \"Value\" FROM rentabilite_a_recalculer WHERE arq_cha_id = {c}").ToListAsync(ct))
                .FirstOrDefault();
            await RecalculerAsync(c, Declencheur.File, raison, null, ct);
        }
        return chantiers.Count;
    }

    /// <summary>Recalcul de nuit des chantiers ouverts avec comparaison à l'existant ; renvoie (chantiers, chantiers en écart, erreurs).</summary>
    public async Task<(int Chantiers, int EnEcart, int Erreurs)> NuitAsync(CancellationToken ct)
    {
        var chantiers = await spec.ChantiersOuvertsAsync(db, ct);
        int ecart = 0, erreurs = 0;
        foreach (var c in chantiers)
        {
            var r = await RecalculerAsync(c, Declencheur.Nuit, null, null, ct);
            if (r.Etat == EtatCalcul.Erreur) erreurs++;
            else if (r.Ecarts > 0) ecart++;
        }
        return (chantiers.Count, ecart, erreurs);
    }

    /// <summary>Met des chantiers dans la file (prioritaires : avant les signalements des triggers).</summary>
    public Task SignalerAsync(IReadOnlyCollection<int> chantiers, string raison, bool prioritaire, CancellationToken ct) =>
        db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO rentabilite_a_recalculer (arq_cha_id, arq_raison, arq_prioritaire)
            SELECT DISTINCT c, {raison}, {prioritaire} FROM unnest({chantiers.ToArray()}) c
            ON CONFLICT (arq_cha_id) DO UPDATE SET arq_raison = EXCLUDED.arq_raison,
                arq_prioritaire = rentabilite_a_recalculer.arq_prioritaire OR EXCLUDED.arq_prioritaire, arq_apres = NULL
            """, ct);

    // ---------------------------------------------------------------- lectures

    public async Task<object> FileAsync(CancellationToken ct) =>
        (await db.Database.SqlQuery<EtatFile>($"""
            SELECT count(*)::int AS attente, count(*) FILTER (WHERE arq_erreur IS NOT NULL)::int AS erreurs FROM rentabilite_a_recalculer
            """).ToListAsync(ct)).Single();

    private sealed record EtatFile(int Attente, int Erreurs);

    private async Task<(ChantierRentabilite Chantier, PorteeRentabilite Portee)> AccesAsync(IServiceProvider services, Utilisateur u, int chantier, CancellationToken ct)
    {
        var c = await spec.ChantierAsync(db, chantier, ct) ?? throw ExceptionMetier.Introuvable("Chantier");
        var p = await spec.PorteeAsync(services, u, ct);
        if (!p.Voit(chantier)) throw ExceptionMetier.AccesRefuse(ActionsDroits.Consulter);
        return (c, p);
    }

    /// <summary>Recalcul manuel synchrone d'un chantier (bouton ⟳ : passe devant la file).</summary>
    public async Task<ResumeCalcul> RecalculerManuelAsync(IServiceProvider services, Utilisateur u, int chantier, CancellationToken ct)
    {
        await AccesAsync(services, u, chantier, ct);
        return await RecalculerAsync(chantier, Declencheur.Manuel, null, u.Code, ct);
    }

    /// <summary>Recalcul de tous les chantiers ouverts (administrateur) : mis en file, prioritaires.</summary>
    public async Task<object> RecalculerToutAsync(Utilisateur u, CancellationToken ct)
    {
        u.ExigerAdmin();
        var chantiers = await spec.ChantiersOuvertsAsync(db, ct);
        await SignalerAsync(chantiers, $"Recalcul demandé par {u.Code}", true, ct);
        return new { chantiers = chantiers.Count };
    }

    public async Task<FraicheurChantier> FraicheurAsync(int chantier, CancellationToken ct)
    {
        var historique = await db.Database.SqlQuery<ResumeCalculLu>($"""
            SELECT rca_id AS id, rca_debut AS debut, rca_fin AS fin, rca_declencheur AS declencheur, rca_raison AS raison, rca_par AS par, rca_version AS version,
                   rca_etat AS etat, rca_message AS message, rca_nb_faits AS nb_faits, rca_ajouts AS ajouts, rca_retraits AS retraits, rca_ecarts AS ecarts
            FROM rentabilite_calcul WHERE rca_cha_id = {chantier} ORDER BY rca_id DESC LIMIT 10
            """).ToListAsync(ct);
        var file = (await db.Database.SqlQuery<EnFile>($"""
            SELECT arq_raison AS raison, arq_depuis AS depuis, arq_erreur AS erreur FROM rentabilite_a_recalculer WHERE arq_cha_id = {chantier}
            """).ToListAsync(ct)).FirstOrDefault();
        return new FraicheurChantier(historique.FirstOrDefault(), file is not null, file?.Raison, file?.Depuis, file?.Erreur, spec.VersionRegles, historique);
    }

    private sealed record EnFile(string? Raison, DateTimeOffset Depuis, string? Erreur);

    /// <summary>
    /// Détail d'un chantier (§ 7) : sommes des faits ouverts jusqu'au <paramref name="au"/> (vide : tous), et de la période
    /// depuis <paramref name="du"/> ; <paramref name="reference"/> : « controle » (dernier contrôle de l'utilisateur) ou
    /// « photo:&lt;id&gt; », agrégats tels qu'ils étaient connus alors, pour la colonne d'écart.
    /// </summary>
    public async Task<DetailChantier> DetailAsync(IServiceProvider services, Utilisateur u, int chantier, DateOnly? du, DateOnly? au, string? reference,
        CancellationToken ct)
    {
        if (Periodes.Controler(du, au) is { } erreur) throw ExceptionMetier.Invalide(erreur, "Le début de la période est après sa fin");
        var (c, p) = await AccesAsync(services, u, chantier, ct);
        var agregats = await AgregatsAsync(chantier, du, au, null, ct);
        var regles = spec.ReglesControle.ToArray();
        var controles = await db.Database.SqlQuery<ControleFaits>($"""
            SELECT afa_regle AS regle, count(*)::int AS nb, sum(afa_montant_pa) AS pa, sum(afa_heures) AS heures
            FROM rentabilite_fait
            WHERE afa_cha_id = {chantier} AND afa_calcul_fin IS NULL AND afa_regle = ANY({regles}) AND ({au}::date IS NULL OR afa_date <= {au})
            GROUP BY 1 ORDER BY 1
            """).ToListAsync(ct);
        var postes = await db.Database.SqlQuery<PosteFaits>($"""
            SELECT afa_ordre_id AS ordre_id, afa_indicateur AS indicateur, coalesce(nullif(trim(afa_libelle), ''), '—') AS libelle,
                   sum(afa_montant_pv) AS pv, coalesce(sum(afa_montant_pv) FILTER (WHERE afa_date >= {du}), 0) AS pv_periode
            FROM rentabilite_fait
            WHERE afa_cha_id = {chantier} AND afa_calcul_fin IS NULL AND afa_composante = {Composante.Poste} AND ({au}::date IS NULL OR afa_date <= {au})
            GROUP BY 1, 2, 3 ORDER BY 3
            """).ToListAsync(ct);
        var controle = await DernierControleAsync(u, chantier, ct);
        var photos = await PhotosAsync(chantier, ct);
        ReferenceDetail? reference_ = null;
        if (reference == "controle" && controle is not null)
            reference_ = new ReferenceDetail("controle", controle.CalculId, au, controle.Le, await AgregatsAsync(chantier, du, au, controle.CalculId, ct));
        else if (reference is ['p', 'h', 'o', 't', 'o', ':', .. var x] && long.TryParse(x, out var idPhoto) && photos.FirstOrDefault(f => f.Id == idPhoto) is { } ph)
        {
            var auPhoto = au is { } a && a < ph.Date ? a : ph.Date;
            reference_ = new ReferenceDetail(reference, ph.CalculId, auPhoto, ph.Le, await AgregatsAsync(chantier, du, auPhoto, ph.CalculId, ct));
        }
        if (!p.VoirCouts)
        {
            agregats = agregats.Select(SansCouts).ToList();
            if (reference_ is not null) reference_ = reference_ with { Agregats = reference_.Agregats.Select(SansCouts).ToList() };
        }
        var natures = await spec.NaturesAsync(db, ct);
        var utilisees = agregats.Concat(reference_?.Agregats ?? []).Where(a => a.NatId is not null).Select(a => a.NatId!.Value).ToHashSet();
        return new DetailChantier(c, du, au, p.VoirCouts, await FraicheurAsync(chantier, ct), await spec.OrdresAsync(db, chantier, ct),
            natures.Where(n => utilisees.Contains(n.Id)).ToList(), agregats, controles, controle, photos, reference_, postes);
    }

    private static AgregatFaits SansCouts(AgregatFaits a) => a with { Pa = 0, Pr = 0, PaPeriode = 0, PrPeriode = 0 };

    /// <summary>
    /// Sommes des faits d'un chantier par ordre, nature, indicateur, composante : faits ouverts (<paramref name="calcul"/>
    /// vide) ou tels que connus au calcul donné (ouverts à ce calcul ou avant, non clos à ce calcul ou avant).
    /// </summary>
    private Task<List<AgregatFaits>> AgregatsAsync(int chantier, DateOnly? du, DateOnly? au, long? calcul, CancellationToken ct) =>
        db.Database.SqlQuery<AgregatFaits>($"""
            SELECT afa_ordre_id AS ordre_id, afa_nat_id AS nat_id, afa_indicateur AS indicateur, afa_composante AS composante,
                   sum(afa_montant_pa) AS pa, sum(afa_montant_pr) AS pr, sum(afa_montant_pv) AS pv, sum(afa_heures) AS heures, count(*)::int AS nb,
                   coalesce(sum(afa_montant_pa) FILTER (WHERE afa_date >= {du}), 0) AS pa_periode,
                   coalesce(sum(afa_montant_pr) FILTER (WHERE afa_date >= {du}), 0) AS pr_periode,
                   coalesce(sum(afa_montant_pv) FILTER (WHERE afa_date >= {du}), 0) AS pv_periode,
                   sum(afa_heures) FILTER (WHERE afa_date >= {du}) AS heures_periode
            FROM rentabilite_fait
            WHERE afa_cha_id = {chantier} AND ({au}::date IS NULL OR afa_date <= {au})
              AND (CASE WHEN {calcul}::bigint IS NULL THEN afa_calcul_fin IS NULL
                        ELSE afa_calcul_debut <= {calcul} AND (afa_calcul_fin IS NULL OR afa_calcul_fin > {calcul}) END)
            GROUP BY 1, 2, 3, 4
            """).ToListAsync(ct);

    /// <summary>Faits composant un chiffre (§ 8) : PA / PR masqués sans le droit, pièces d'un type non consultable résumées par type.</summary>
    public async Task<FaitsChantier> FaitsAsync(IServiceProvider services, Utilisateur u, int chantier, FiltreFaits f, CancellationToken ct)
    {
        var (c, p) = await AccesAsync(services, u, chantier, ct);
        long? ordre = f.Ordre is 0 ? null : f.Ordre;
        int[]? natFiltre = f.Natures?.Where(n => n != 0).ToArray();
        var sansNature = f.Natures?.Contains(0) ?? false;
        var exclue = f.Composante is ['!', .. var x] ? x : null;
        var composante = exclue is null ? f.Composante : null;
        var faits = await db.Database.SqlQuery<FaitLu>($"""
            SELECT afa_id, afa_ordre_id, afa_mar_id, afa_indicateur, afa_composante, afa_date, afa_nat_id, afa_qte, afa_unite, afa_montant_pa, afa_montant_pr,
                   afa_montant_pv, afa_heures, afa_source_type, afa_type_piece, afa_ent_id, afa_lig_id, afa_source_id, afa_regle, afa_libelle, afa_calcul_debut
            FROM rentabilite_fait
            WHERE afa_cha_id = {chantier} AND afa_calcul_fin IS NULL
              AND ({f.Indicateurs}::text[] IS NULL OR afa_indicateur = ANY({f.Indicateurs}))
              AND ({composante}::text IS NULL OR afa_composante = {composante})
              AND ({exclue}::text IS NULL OR afa_composante <> {exclue})
              AND ({natFiltre}::int[] IS NULL OR afa_nat_id = ANY({natFiltre}) OR ({sansNature} AND afa_nat_id IS NULL))
              AND ({f.Ordre}::bigint IS NULL OR afa_ordre_id IS NOT DISTINCT FROM {ordre})
              AND ({f.Piece}::bigint IS NULL OR afa_ent_id = {f.Piece})
              AND ({f.Du}::date IS NULL OR afa_date >= {f.Du}) AND ({f.Au}::date IS NULL OR afa_date <= {f.Au})
            ORDER BY afa_date, afa_ent_id, afa_lig_id, afa_id
            """).ToListAsync(ct);
        var masques = faits.Where(x => x.AfaTypePiece is { } t && p.TypesMasques.Contains(t)).GroupBy(x => x.AfaTypePiece!)
            .Select(g => new FaitsMasques(g.Key, g.Select(x => x.AfaEntId).Distinct().Count(), g.Count(), g.Sum(x => x.AfaMontantPv),
                p.VoirCouts ? g.Sum(x => x.AfaMontantPa ?? 0) : null, p.VoirCouts ? g.Sum(x => x.AfaMontantPr ?? 0) : null))
            .ToList();
        var visibles = faits.Where(x => x.AfaTypePiece is not { } t || !p.TypesMasques.Contains(t))
            .Select(x => p.VoirCouts ? x : x with { AfaMontantPa = null, AfaMontantPr = null }).ToList();
        var pieces = await spec.PiecesAsync(db, visibles.Where(x => x.AfaEntId is not null).Select(x => x.AfaEntId!.Value).Distinct().ToArray(), ct);
        var natures = await spec.NaturesAsync(db, ct);
        var utilisees = visibles.Where(x => x.AfaNatId is not null).Select(x => x.AfaNatId!.Value).ToHashSet();
        return new FaitsChantier(c, p.VoirCouts, visibles, pieces, masques, natures.Where(n => utilisees.Contains(n.Id)).ToList(), await spec.OrdresAsync(db, chantier, ct));
    }

    /// <summary>Rapprochement (§ 8) : pour chaque pièce ou source, ce qu'elle montre (total) et la somme de ses faits, avec l'écart.</summary>
    public async Task<List<LigneRapprochementLue>> RapprochementAsync(IServiceProvider services, Utilisateur u, int chantier, CancellationToken ct)
    {
        var (_, p) = await AccesAsync(services, u, chantier, ct);
        var lignes = await spec.RapprochementAsync(db, chantier, ct);
        var sommes = await db.Database.SqlQuery<SommeSource>($"""
            SELECT afa_source_type AS source_type, afa_ent_id AS ent_id, afa_indicateur AS indicateur,
                   sum(afa_montant_pv) AS pv, sum(afa_montant_pa) AS pa
            FROM rentabilite_fait WHERE afa_cha_id = {chantier} AND afa_calcul_fin IS NULL
            GROUP BY 1, 2, 3
            """).ToListAsync(ct);
        var pieces = await spec.PiecesAsync(db, lignes.Where(l => l.EntId is not null).Select(l => l.EntId!.Value).Distinct().ToArray(), ct);
        return lignes
            .Where(l => l.EntId is not { } e || !pieces.TryGetValue(e, out var pc) || !p.TypesMasques.Contains(pc.Type))
            .Where(l => p.VoirCouts || l.Champ == "PV")
            .Select(l =>
            {
                var s = sommes.Where(x => x.SourceType == l.SourceType && x.Indicateur == l.Indicateur && (l.EntId is null || x.EntId == l.EntId))
                    .Sum(x => l.Champ == "PV" ? x.Pv : x.Pa);
                return new LigneRapprochementLue(l.SourceType, l.EntId, l.EntId is { } e ? pieces.GetValueOrDefault(e) : null, l.Indicateur, l.Champ, l.Attendu, s,
                    s - l.Attendu, l.Libelle);
            }).ToList();
    }

    private sealed record SommeSource(string SourceType, long? EntId, string Indicateur, decimal Pv, decimal Pa);
}
