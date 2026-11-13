using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using LogiBTP.Socle.Donnees;

namespace LogiBTP.Rentabilite.Web;

/// <summary>Version du prévisionnel de facturation d'un chantier (une par enregistrement).</summary>
public sealed record VersionFacturation(long Id, int ChaId, string Par, DateTimeOffset Le, string? Commentaire, decimal BudgetPv);

/// <summary>Mois d'une version : mode (MONTANT, POURCENT), valeur saisie, montant HT prévu.</summary>
public sealed record MoisFacturation(long VersionId, DateOnly Mois, string Mode, decimal Valeur, decimal Montant);

/// <summary>Version et ses mois.</summary>
public sealed record VersionFacturationLue(VersionFacturation Version, IReadOnlyList<MoisFacturation> Mois);

/// <summary>Facturé d'un chantier pour un mois (faits FACTURE, PV, postes compris).</summary>
public sealed record FactureMois(int ChaId, DateOnly Mois, decimal Pv);

/// <summary>Prévisionnel de facturation d'un chantier : budget PV actuel, versions (la plus récente d'abord), facturé par mois.</summary>
public sealed record FacturationChantier(ChantierRentabilite Chantier, decimal BudgetPv, IReadOnlyList<VersionFacturationLue> Versions, IReadOnlyList<FactureMois> Facture);

/// <summary>Enregistrement d'une prévision : tous ses mois (une nouvelle version), commentaire, dernière version vue (409 si une autre a été enregistrée depuis).</summary>
public sealed record SaisieFacturation(string? Commentaire, long? Derniere, IReadOnlyList<LigneFacturation> Lignes);

/// <summary>Prévu d'un chantier pour un mois (dernière version).</summary>
public sealed record PrevuMois(int ChaId, DateOnly Mois, decimal Montant);

/// <summary>Liste du prévisionnel de facturation : chantiers × mois, prévu (dernière version) et facturé.</summary>
public sealed record FacturationListe(DateOnly Du, DateOnly Au, IReadOnlyList<ChantierListe> Chantiers, IReadOnlyList<PrevuMois> Prevu, IReadOnlyList<FactureMois> Facture,
    IReadOnlyList<VersionFacturation> Versions);

/// <summary>Prévisionnel de facturation (ANALYSE-MODULE-ANALYSE.md § 10.2, lot 7).</summary>
public partial class ServiceRentabilite
{
    private Task<decimal> BudgetPvAsync(int chantier, CancellationToken ct) =>
        db.Database.SqlQuery<decimal>($"""
            SELECT coalesce(sum(afa_montant_pv), 0) AS "Value" FROM rentabilite_fait
            WHERE afa_cha_id = {chantier} AND afa_calcul_fin IS NULL AND afa_indicateur = {Indicateur.Budget}
            """).SingleAsync(ct);

    private Task<List<FactureMois>> FactureParMoisAsync(int[] chantiers, DateOnly? du, DateOnly? au, CancellationToken ct) =>
        db.Database.SqlQuery<FactureMois>($"""
            SELECT afa_cha_id AS cha_id, date_trunc('month', afa_date)::date AS mois, sum(afa_montant_pv) AS pv
            FROM rentabilite_fait
            WHERE afa_cha_id = ANY({chantiers}) AND afa_calcul_fin IS NULL AND afa_indicateur = {Indicateur.Facture}
              AND ({du}::date IS NULL OR afa_date >= {du}) AND ({au}::date IS NULL OR afa_date <= {au})
            GROUP BY 1, 2 ORDER BY 1, 2
            """).ToListAsync(ct);

    /// <summary>Prévisionnel d'un chantier visible : versions et leurs mois, facturé par mois, budget PV actuel.</summary>
    public async Task<FacturationChantier> FacturationAsync(IServiceProvider services, Utilisateur u, int chantier, CancellationToken ct)
    {
        var (c, _) = await AccesAsync(services, u, chantier, ct);
        var versions = await db.Database.SqlQuery<VersionFacturation>($"""
            SELECT rfv_id AS id, rfv_cha_id AS cha_id, rfv_par AS par, rfv_le AS le, rfv_commentaire AS commentaire, rfv_budget_pv AS budget_pv
            FROM rentabilite_facturation_version WHERE rfv_cha_id = {chantier} ORDER BY rfv_id DESC
            """).ToListAsync(ct);
        var ids = versions.Select(v => v.Id).ToArray();
        List<MoisFacturation> mois = ids.Length == 0 ? [] : await db.Database.SqlQuery<MoisFacturation>($"""
            SELECT rfp_rfv_id AS version_id, rfp_mois AS mois, rfp_mode AS mode, rfp_valeur AS valeur, rfp_montant AS montant
            FROM rentabilite_facturation_prevue WHERE rfp_rfv_id = ANY({ids}) ORDER BY rfp_rfv_id, rfp_mois
            """).ToListAsync(ct);
        var parVersion = mois.ToLookup(m => m.VersionId);
        return new FacturationChantier(c, await BudgetPvAsync(chantier, ct), versions.Select(v => new VersionFacturationLue(v, parVersion[v.Id].ToList())).ToList(),
            await FactureParMoisAsync([chantier], null, null, ct));
    }

    /// <summary>
    /// Enregistre une nouvelle version de la prévision d'un chantier (tous ses mois ; les montants des mois en % sont
    /// calculés sur le budget PV actuel) ; 409 si une autre version a été enregistrée depuis la dernière vue.
    /// </summary>
    public async Task<FacturationChantier> EnregistrerFacturationAsync(IServiceProvider services, Utilisateur u, int chantier, SaisieFacturation s, CancellationToken ct)
    {
        await AccesAsync(services, u, chantier, ct);
        await spec.AutoriserFacturationAsync(services, u, ct);
        var budget = await BudgetPvAsync(chantier, ct);
        var lignes = s.Lignes ?? [];
        if (Facturation.Controler(lignes, budget) is [var premiere, ..] erreurs)
            throw ExceptionMetier.Invalide(premiere.Code, $"Prévision de facturation incorrecte ({erreurs.Count} mois)", new { erreurs });
        await using (var tx = await db.Unite().CommencerAsync(ct))
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({VerrouModule + 1}, {chantier})", ct);
            var derniere = (await db.Database.SqlQuery<long?>($"""
                SELECT max(rfv_id) AS "Value" FROM rentabilite_facturation_version WHERE rfv_cha_id = {chantier}
                """).ToListAsync(ct)).FirstOrDefault();
            if (derniere != s.Derniere)
                throw ExceptionMetier.Conflit(ErreurFacturation.Version, "Une autre prévision a été enregistrée entre-temps : relire avant d'enregistrer");
            var id = (await db.Database.SqlQuery<long>($"""
                INSERT INTO rentabilite_facturation_version (rfv_cha_id, rfv_par, rfv_commentaire, rfv_budget_pv)
                VALUES ({chantier}, {u.Code}, {(string.IsNullOrWhiteSpace(s.Commentaire) ? null : s.Commentaire.Trim())}, {budget})
                RETURNING rfv_id AS "Value"
                """).ToListAsync(ct)).Single();
            foreach (var l in lignes)
            {
                var valeur = Facturation.Lire(l.Valeur)!.Value;
                var mois = DateOnly.Parse(l.Mois!);
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO rentabilite_facturation_prevue (rfp_rfv_id, rfp_mois, rfp_mode, rfp_valeur, rfp_montant)
                    VALUES ({id}, {mois}, {l.Mode}, {valeur}, {Facturation.Montant(l.Mode!, valeur, budget)})
                    """, ct);
            }
            await tx.CommitAsync(ct);
        }
        return await FacturationAsync(services, u, chantier, ct);
    }

    /// <summary>Liste chantiers × mois (§ 10.2) : chantiers visibles de la Liste, prévu de la dernière version et facturé de chaque mois.</summary>
    public async Task<FacturationListe> FacturationListeAsync(IServiceProvider services, Utilisateur u, DateOnly? du, DateOnly? au, bool exclus, bool clos, CancellationToken ct)
    {
        var debut = Premier(du ?? Aujourdhui.AddMonths(-2));
        var fin = Premier(au ?? Aujourdhui.AddMonths(9)).AddMonths(1).AddDays(-1);
        if (fin < debut) throw ExceptionMetier.Invalide(ErreurPeriode.Ordre, "Le début de la période est après sa fin");
        var p = await spec.PorteeAsync(services, u, ct);
        var chantiers = (await spec.ChantiersListeAsync(db, ct)).Where(c => p.Voit(c.Id) && (exclus || !c.Exclu) && (clos || !c.Clos)).ToList();
        var ids = chantiers.Select(c => c.Id).ToArray();
        var versions = await db.Database.SqlQuery<VersionFacturation>($"""
            SELECT DISTINCT ON (rfv_cha_id) rfv_id AS id, rfv_cha_id AS cha_id, rfv_par AS par, rfv_le AS le, rfv_commentaire AS commentaire, rfv_budget_pv AS budget_pv
            FROM rentabilite_facturation_version WHERE rfv_cha_id = ANY({ids}) ORDER BY rfv_cha_id, rfv_id DESC
            """).ToListAsync(ct);
        var dernieres = versions.Select(v => v.Id).ToArray();
        var prevu = await db.Database.SqlQuery<PrevuMois>($"""
            SELECT v.rfv_cha_id AS cha_id, p.rfp_mois AS mois, p.rfp_montant AS montant
            FROM rentabilite_facturation_prevue p JOIN rentabilite_facturation_version v ON v.rfv_id = p.rfp_rfv_id
            WHERE p.rfp_rfv_id = ANY({dernieres}) AND p.rfp_mois BETWEEN {debut} AND {fin}
            ORDER BY 1, 2
            """).ToListAsync(ct);
        return new FacturationListe(debut, fin, chantiers, prevu, await FactureParMoisAsync(ids, debut, fin, ct), versions);
    }

    private static DateOnly Premier(DateOnly d) => new(d.Year, d.Month, 1);
}
