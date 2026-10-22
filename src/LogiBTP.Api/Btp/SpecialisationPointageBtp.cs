using LogiBTP.Crm.Web;
using LogiBTP.Pointage.Web;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Spécialisation du module Pointage par le cœur : salariés et intérimaires actifs (service principal par
/// `service_membre`), chantiers ouverts et internes (`cha_interne`, db/199), types de main-d'œuvre = natures du
/// regroupement MO, services, ordres de la famille E (module Exécution actif) ; droit de saisie : le salarié lui-même,
/// le responsable de son service (ou du service parent). Synthèse (lot 2) : RH = membre d'un service de nature
/// ADMINISTRATIF ; chef = responsable du service principal du salarié ou de son parent ; demande de correction : tâche
/// du CRM au service administratif (module CRM actif).
/// </summary>
public class SpecialisationPointageBtp : SpecialisationPointage
{
    public override Task<List<SalariePointage>> SalariesAsync(PointageDbContext db, FiltreSalaries f, CancellationToken ct) =>
        db.Database.SqlQueryRaw<SalariePointage>("""
            SELECT s.sal_id AS id, s.sal_matricule AS matricule, s.sal_nom AS nom, s.sal_prenom AS prenom, sv.srv_id, sv.srv_libelle AS service,
                   (s.sal_statut = 'INTERIM') AS interimaire, s.sal_ppf_id AS ppf_id, s.sal_agence AS agence,
                   s.sal_code AS code, s.sal_matricule_paie AS matricule_paie
            FROM salarie s
            LEFT JOIN service_membre sm ON sm.sme_ind_id = s.sal_ind_id AND sm.sme_principal
            LEFT JOIN service sv ON sv.srv_id = sm.sme_srv_id
            WHERE (@ids IS NULL AND s.sal_actif AND (s.sal_date_sortie IS NULL OR s.sal_date_sortie >= current_date - 31)
                   AND (@srv IS NULL OR sv.srv_id = @srv OR sv.srv_parent_id = @srv)
                   AND (@r IS NULL OR s.sal_nom ILIKE @r OR s.sal_prenom ILIKE @r OR s.sal_matricule ILIKE @r OR s.sal_code ILIKE @r OR s.sal_matricule_paie ILIKE @r)
                   OR s.sal_id = ANY(@ids))
            ORDER BY s.sal_nom, s.sal_prenom
            LIMIT @n
            """,
            new NpgsqlParameter("ids", NpgsqlTypes.NpgsqlDbType.Array | NpgsqlTypes.NpgsqlDbType.Integer) { Value = (object?)f.Ids?.ToArray() ?? DBNull.Value },
            new NpgsqlParameter("srv", NpgsqlTypes.NpgsqlDbType.Integer) { Value = (object?)f.Service ?? DBNull.Value },
            new NpgsqlParameter("r", NpgsqlTypes.NpgsqlDbType.Text) { Value = string.IsNullOrWhiteSpace(f.Recherche) ? DBNull.Value : $"%{f.Recherche.Trim()}%" },
            new NpgsqlParameter("n", f.Ids?.Count ?? f.Taille)).ToListAsync(ct);

    public override Task<List<ChantierPointage>> ChantiersAsync(PointageDbContext db, string? recherche, IReadOnlyCollection<int>? ids, CancellationToken ct) =>
        db.Database.SqlQueryRaw<ChantierPointage>("""
            SELECT c.cha_id AS id, c.cha_code AS code, c.cha_libelle AS libelle, (c.cha_statut <> 'OUVERT' AND NOT c.cha_interne) AS clos, c.cha_interne AS interne
            FROM chantier c
            WHERE (@ids IS NULL AND (c.cha_statut = 'OUVERT' OR c.cha_interne)
                   AND (@r IS NULL OR c.cha_code ILIKE @r OR c.cha_libelle ILIKE @r OR c.cha_ville ILIKE @r)
                   OR c.cha_id = ANY(@ids))
            ORDER BY c.cha_interne, c.cha_code DESC
            LIMIT 50
            """,
            new NpgsqlParameter("ids", NpgsqlTypes.NpgsqlDbType.Array | NpgsqlTypes.NpgsqlDbType.Integer) { Value = (object?)ids?.ToArray() ?? DBNull.Value },
            new NpgsqlParameter("r", NpgsqlTypes.NpgsqlDbType.Text) { Value = string.IsNullOrWhiteSpace(recherche) ? DBNull.Value : $"%{recherche.Trim()}%" }).ToListAsync(ct);

    public override Task<List<TypeMoPointage>> TypesMoAsync(PointageDbContext db, CancellationToken ct) =>
        db.Database.SqlQueryRaw<TypeMoPointage>("""
            SELECT nat_id AS id, nat_code AS code, nat_libelle AS libelle, nat_srv_id AS srv_id
            FROM nature_element WHERE nat_rgn_code = 'MO' ORDER BY nat_code
            """).ToListAsync(ct);

    public override Task<List<ServicePointageDto>> ServicesAsync(PointageDbContext db, CancellationToken ct) =>
        db.Database.SqlQueryRaw<ServicePointageDto>("""
            SELECT s.srv_id AS id, s.srv_code AS code, s.srv_libelle AS libelle, s.srv_parent_id AS parent_id
            FROM service s LEFT JOIN service p ON p.srv_id = s.srv_parent_id
            WHERE s.srv_actif
            ORDER BY coalesce(p.srv_ordre, s.srv_ordre), coalesce(p.srv_code, s.srv_code), s.srv_parent_id NULLS FIRST, s.srv_ordre
            """).ToListAsync(ct);

    public override Task<List<OrdrePointage>> OrdresAsync(PointageDbContext db, IReadOnlyCollection<int> chantiers, CancellationToken ct) =>
        db.Database.SqlQueryRaw<OrdrePointage>("""
            SELECT d.ent_id AS id, d.ent_chantier_id AS cha_id, d.ent_numero AS numero, d.ent_objet AS objet, t.tyd_libelle AS type, d.ent_srv_id AS srv_id
            FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document s ON s.std_id = d.ent_std_id
            WHERE f_module_actif('execution') AND t.tyd_famille = 'E' AND d.ent_is_reference AND d.ent_chantier_id = ANY(@ids)
              AND s.std_code NOT IN ('ANNULE', 'REMPLACE') AND coalesce(d.ent_exe_etat, '') <> 'TERMINE'
            ORDER BY d.ent_chantier_id, d.ent_numero
            """, new NpgsqlParameter("ids", chantiers.ToArray())).ToListAsync(ct);

    public override async Task<bool> PeutSaisirAsync(PointageDbContext db, Utilisateur u, int salarie, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<bool>("""
            SELECT EXISTS (
              SELECT 1 FROM salarie s
              JOIN individu i ON i.ind_utilisateur = @u
              LEFT JOIN service_membre sm ON sm.sme_ind_id = s.sal_ind_id AND sm.sme_principal
              LEFT JOIN service sv ON sv.srv_id = sm.sme_srv_id
              LEFT JOIN service sp ON sp.srv_id = sv.srv_parent_id
              WHERE s.sal_id = @s AND (s.sal_ind_id = i.ind_id OR sv.srv_responsable_id = i.ind_id OR sp.srv_responsable_id = i.ind_id)) AS "Value"
            """, new NpgsqlParameter("u", u.Code), new NpgsqlParameter("s", salarie)).FirstAsync(ct);

    public override async Task<bool> EstRhAsync(PointageDbContext db, Utilisateur u, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<bool>("""
            SELECT EXISTS (SELECT 1 FROM individu i JOIN service_membre sm ON sm.sme_ind_id = i.ind_id JOIN service s ON s.srv_id = sm.sme_srv_id
                           WHERE i.ind_utilisateur = @u AND s.srv_nature = 'ADMINISTRATIF' AND s.srv_actif) AS "Value"
            """, new NpgsqlParameter("u", u.Code)).FirstAsync(ct);

    public override async Task<HashSet<int>> ChefDeAsync(PointageDbContext db, Utilisateur u, IReadOnlyCollection<int> salaries, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<int>("""
            SELECT s.sal_id AS "Value" FROM salarie s
            JOIN individu i ON i.ind_utilisateur = @u
            JOIN service_membre sm ON sm.sme_ind_id = s.sal_ind_id AND sm.sme_principal
            JOIN service sv ON sv.srv_id = sm.sme_srv_id
            LEFT JOIN service sp ON sp.srv_id = sv.srv_parent_id
            WHERE s.sal_id = ANY(@ids) AND (sv.srv_responsable_id = i.ind_id OR sp.srv_responsable_id = i.ind_id)
            """, new NpgsqlParameter("u", u.Code), new NpgsqlParameter("ids", salaries.ToArray())).ToListAsync(ct)).ToHashSet();

    /// <summary>
    /// Taux de valorisation : coût horaire chargé de la fiche (SALARIE) ; à défaut, salaire mensuel / heures du mois
    /// × 1,42 (charges patronales indicatives, SALAIRE) ; intérimaire : taux de la mission couvrant la période (INTERIM).
    /// </summary>
    public override async Task<Dictionary<int, (decimal Taux, string Source)>> TauxAsync(PointageDbContext db, IReadOnlyCollection<int> salaries, DateOnly du, DateOnly au, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<TauxSalarie>("""
            SELECT s.sal_id AS id,
                   CASE WHEN s.sal_statut = 'INTERIM' THEN (SELECT m.mis_taux_horaire FROM mission_interim m WHERE m.mis_sal_id = s.sal_id AND m.mis_debut <= @au AND m.mis_fin >= @du
                                                            ORDER BY m.mis_debut DESC LIMIT 1)
                        ELSE coalesce(s.sal_cout_horaire, round(s.sal_salaire / nullif(s.sal_heures_mois, 0) * 1.42, 4)) END AS taux,
                   CASE WHEN s.sal_statut = 'INTERIM' THEN 'INTERIM' WHEN s.sal_cout_horaire IS NOT NULL THEN 'SALARIE' ELSE 'SALAIRE' END AS source
            FROM salarie s WHERE s.sal_id = ANY(@ids)
            """, new NpgsqlParameter("ids", salaries.ToArray()), new NpgsqlParameter("du", du), new NpgsqlParameter("au", au)).ToListAsync(ct))
        .Where(t => t.Taux is not null).ToDictionary(t => t.Id, t => (t.Taux!.Value, t.Source));

    private sealed record TauxSalarie(int Id, decimal? Taux, string Source);

    public override Task<List<MotifPointage>> MotifsAsync(PointageDbContext db, string domaine, CancellationToken ct) =>
        db.Database.SqlQueryRaw<MotifPointage>("SELECT mot_code AS code, mot_libelle AS libelle FROM motif WHERE mot_domaine = @d AND mot_actif ORDER BY mot_ordre, mot_libelle",
            new NpgsqlParameter("d", domaine)).ToListAsync(ct);

    public override Task<List<EquipePointage>> EquipesAsync(PointageDbContext db, int? service, DateOnly date, CancellationToken ct) =>
        db.Database.SqlQueryRaw<EquipePointage>("""
            SELECT e.equ_id AS id, e.equ_libelle AS libelle,
                   coalesce(array_agg(c.eqc_sal_id ORDER BY c.eqc_chef DESC, c.eqc_sal_id) FILTER (WHERE c.eqc_sal_id IS NOT NULL), ARRAY[]::int[]) AS membres
            FROM equipe e
            LEFT JOIN service sv ON sv.srv_id = e.equ_srv_id
            LEFT JOIN equipe_composition c ON c.eqc_equ_id = e.equ_id AND c.eqc_du <= @d AND (c.eqc_au IS NULL OR c.eqc_au >= @d)
            WHERE e.equ_active AND (@s IS NULL OR e.equ_srv_id = @s OR sv.srv_parent_id = @s)
            GROUP BY e.equ_id, e.equ_libelle
            ORDER BY e.equ_libelle
            """, new NpgsqlParameter("d", date), new NpgsqlParameter("s", NpgsqlTypes.NpgsqlDbType.Integer) { Value = (object?)service ?? DBNull.Value }).ToListAsync(ct);

    public override Task<OrdrePointage?> OrdreParNumeroAsync(PointageDbContext db, string numero, CancellationToken ct) =>
        db.Database.SqlQueryRaw<OrdrePointage>("""
            SELECT d.ent_id AS id, d.ent_chantier_id AS cha_id, d.ent_numero AS numero, d.ent_objet AS objet, t.tyd_libelle AS type, d.ent_srv_id AS srv_id
            FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id
            WHERE f_module_actif('execution') AND t.tyd_famille = 'E' AND d.ent_is_reference AND d.ent_chantier_id IS NOT NULL AND upper(d.ent_numero) = upper(@n)
            LIMIT 1
            """, new NpgsqlParameter("n", numero)).FirstOrDefaultAsync(ct)!;

    /// <summary>Chantiers des tâches du planning du jour où le salarié est affecté (module Planning actif) : journée pré-remplie.</summary>
    public override async Task<List<int>> ChantiersDuJourAsync(PointageDbContext db, int salarie, DateOnly date, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<int>("""
            SELECT DISTINCT t.tac_id_element::int AS "Value"
            FROM pla_tache t JOIN pla_affectation a ON a.aff_tac_id = t.tac_id
            WHERE f_module_actif('planning') AND t.tac_type_element = 'chantier' AND t.tac_id_element ~ '^[0-9]+$'
              AND a.aff_res_type IN ('SALARIE', 'INTERIM') AND a.aff_res_id = @s::text
              AND t.tac_debut < (@d::date + 1) AND t.tac_fin > @d::date
            """, new NpgsqlParameter("s", salarie.ToString()), new NpgsqlParameter("d", date)).ToListAsync(ct);

    private sealed record MotifService(int? SrvId, string Libelle);

    /// <summary>
    /// Non-conformité signalée à la borne : tâche du CRM au service du motif (sinon au service du salarié), rattachée au
    /// chantier et à l'ordre ; sans effet si le CRM est inactif ; une erreur n'annule pas le pointage.
    /// </summary>
    public override async Task ApresNonConformiteAsync(PointageDbContext db, IServiceProvider services, Utilisateur auteur, SalariePointage salarie, int chantier, long? ordre,
        string motif, CancellationToken ct)
    {
        if (!await services.GetRequiredService<ModulesSociete>().EstActifAsync("crm", ct)) return;
        var m = await db.Database.SqlQueryRaw<MotifService>("SELECT mot_srv_id AS srv_id, mot_libelle AS libelle FROM motif WHERE mot_domaine = 'NON_CONFORMITE' AND mot_libelle = @l LIMIT 1",
            new NpgsqlParameter("l", motif)).FirstOrDefaultAsync(ct);
        if ((m?.SrvId ?? salarie.SrvId) is not int service) return;
        var liens = new List<LienSaisi> { new("chantier", chantier.ToString(), true) };
        if (ordre is long o)
        {
            var groupe = await db.Database.SqlQueryRaw<long>("SELECT ent_groupe_id AS \"Value\" FROM document WHERE ent_id = @o", new NpgsqlParameter("o", o)).FirstOrDefaultAsync(ct);
            if (groupe != 0) liens.Add(new LienSaisi("document", groupe.ToString()));
        }
        try
        {
            await services.GetRequiredService<ServiceCrm>().Enregistrer(null, new NoteSaisie("TACHE", "A_FAIRE", null, service,
                $"Non-conformité signalée par {salarie.Prenom} {salarie.Nom} : {motif}", null, null, DateTimeOffset.UtcNow.AddDays(1), null, false, false, false, liens, null), auteur, ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            services.GetRequiredService<ILoggerFactory>().CreateLogger("Pointage").LogWarning(e, "Tâche du CRM non créée pour la non-conformité de {Salarie}", salarie.Id);
        }
    }

    /// <summary>Tâche du CRM au premier service administratif (RH), rattachée au salarié ; sans effet si le CRM est inactif.</summary>
    public override async Task ApresCorrectionAsync(PointageDbContext db, IServiceProvider services, Utilisateur u, SalariePointage salarie, CorrectionEntite c, CancellationToken ct)
    {
        if (!await services.GetRequiredService<ModulesSociete>().EstActifAsync("crm", ct)) return;
        var srv = await db.Database.SqlQueryRaw<int?>(
            "SELECT srv_id AS \"Value\" FROM service WHERE srv_nature = 'ADMINISTRATIF' AND srv_actif ORDER BY srv_parent_id NULLS FIRST, srv_ordre LIMIT 1").FirstOrDefaultAsync(ct);
        if (srv is not int service) return;
        try
        {
            await services.GetRequiredService<ServiceCrm>().Enregistrer(null, new NoteSaisie("TACHE", "A_FAIRE", null, service,
                $"Pointages de {salarie.Nom} {salarie.Prenom} : correction demandée (semaine du {c.PcoLundi:dd/MM/yyyy})",
                c.PcoMotif is null ? null : $"<p>{System.Net.WebUtility.HtmlEncode(c.PcoMotif)}</p>",
                null, DateTimeOffset.UtcNow.AddDays(2), null, false, false, false, [new LienSaisi("salarie", salarie.Id.ToString(), true)], null), u, ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            services.GetRequiredService<ILoggerFactory>().CreateLogger("Pointage").LogWarning(e, "Tâche du CRM non créée pour la correction {Correction}", c.PcoId);
        }
    }
}
