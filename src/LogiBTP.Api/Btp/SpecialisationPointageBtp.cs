using LogiBTP.Calendrier.Web;
using LogiBTP.Crm.Web;
using LogiBTP.Planning.Web;
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
/// du CRM au service administratif (module CRM actif). Jours travaillés : calendrier effectif du salarié (fériés et
/// fermetures exclus). Congés : tâche du CRM au service administratif à la demande, absence tenue dans le planning
/// (module Planning actif ; tâche gérée d'origine « conge »).
/// </summary>
public class SpecialisationPointageBtp(IHttpContextAccessor http) : SpecialisationPointage
{
    private IServiceProvider Services => http.HttpContext?.RequestServices ?? throw new InvalidOperationException("Pointage : contexte HTTP absent");

    private sealed record CalendrierSalarie(int Id, int? CalId, int? SrvId);

    /// <summary>Jours travaillés d'une semaine : journées à minutes du calendrier effectif du salarié (fériés, fermetures du service exclus).</summary>
    public override async Task<Dictionary<int, List<DateOnly>>> JoursTravaillesAsync(PointageDbContext db, IReadOnlyCollection<int> salaries, DateOnly lundi, CancellationToken ct)
    {
        var calendriers = Services.GetRequiredService<ServiceCalendrier>();
        var lignes = await db.Database.SqlQueryRaw<CalendrierSalarie>("""
            SELECT s.sal_id AS id, coalesce(s.sal_cal_id, v.srv_cal_id) AS cal_id, v.srv_id AS srv_id
            FROM salarie s
            LEFT JOIN LATERAL (SELECT sv.srv_id, sv.srv_cal_id FROM service_membre m JOIN service sv ON sv.srv_id = m.sme_srv_id
                               WHERE m.sme_ind_id = s.sal_ind_id ORDER BY m.sme_principal DESC, sv.srv_ordre LIMIT 1) v ON TRUE
            WHERE s.sal_id = ANY(@ids)
            """, new NpgsqlParameter("ids", salaries.ToArray())).ToListAsync(ct);
        var cache = new Dictionary<(int?, int?), List<DateOnly>>();
        var r = new Dictionary<int, List<DateOnly>>();
        foreach (var l in lignes)
        {
            if (!cache.TryGetValue((l.CalId, l.SrvId), out var jours))
            {
                jours = (await calendriers.JourneesAsync(l.CalId, lundi, lundi.AddDays(6), l.SrvId is int s ? [new Portee("service", s.ToString())] : [], ct))
                    .Where(j => j.Minutes > 0).Select(j => j.Date).ToList();
                cache[(l.CalId, l.SrvId)] = jours;
            }
            r[l.Id] = jours;
        }
        foreach (var s in salaries.Where(s => !r.ContainsKey(s))) r[s] = Enumerable.Range(0, 5).Select(i => lundi.AddDays(i)).ToList();
        return r;
    }

    public override async Task<int?> SalarieDeAsync(PointageDbContext db, Utilisateur u, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<int?>("""
            SELECT s.sal_id AS "Value" FROM salarie s JOIN individu i ON i.ind_id = s.sal_ind_id WHERE i.ind_utilisateur = @u AND s.sal_actif ORDER BY s.sal_id LIMIT 1
            """, new NpgsqlParameter("u", u.Code)).FirstOrDefaultAsync(ct);

    private sealed record TacheExistante(long Id, int Version);

    /// <summary>
    /// Après un congé : à la demande, tâche du CRM au service administratif ; dans le planning, absence du salarié
    /// (option tant que demandée, confirmée et à la couleur de la nature une fois validée, supprimée si refusée ou
    /// annulée ; demi-journées bornées à midi ; heures calculées par le calendrier, mode 2).
    /// </summary>
    public override async Task ApresCongeAsync(PointageDbContext db, IServiceProvider services, Utilisateur u, SalariePointage salarie, CongeEntite c, string action,
        CancellationToken ct)
    {
        var modules = services.GetRequiredService<ModulesSociete>();
        var journal = services.GetRequiredService<ILoggerFactory>().CreateLogger("Pointage");
        if (action == "DEMANDER" && await modules.EstActifAsync("crm", ct))
        {
            var srv = await db.Database.SqlQueryRaw<int?>(
                "SELECT srv_id AS \"Value\" FROM service WHERE srv_nature = 'ADMINISTRATIF' AND srv_actif ORDER BY srv_parent_id NULLS FIRST, srv_ordre LIMIT 1").FirstOrDefaultAsync(ct);
            if (srv is int service)
            {
                try
                {
                    await services.GetRequiredService<ServiceCrm>().Enregistrer(null, new NoteSaisie("TACHE", "A_FAIRE", null, service,
                        $"Congé demandé : {salarie.Nom} {salarie.Prenom} du {c.PcoDu:dd/MM/yyyy}{(c.PcoDebutMidi ? " après-midi" : "")} au {c.PcoAu:dd/MM/yyyy}{(c.PcoFinMidi ? " midi" : "")}",
                        c.PcoCommentaire is null ? null : $"<p>{System.Net.WebUtility.HtmlEncode(c.PcoCommentaire)}</p>",
                        null, DateTimeOffset.UtcNow.AddDays(2), null, false, false, false, [new LienSaisi("salarie", salarie.Id.ToString(), true)], null), u, ct);
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    journal.LogWarning(e, "Tâche du CRM non créée pour le congé {Conge}", c.PcoId);
                }
            }
        }
        if (!await modules.EstActifAsync("planning", ct)) return;
        try
        {
            var planning = services.GetRequiredService<ServicePlanning>();
            var existante = c.PcoTacId is long t
                ? await db.Database.SqlQueryRaw<TacheExistante>("SELECT tac_id AS id, tac_version AS version FROM pla_tache WHERE tac_id = @t", new NpgsqlParameter("t", t)).FirstOrDefaultAsync(ct)
                : null;
            if (c.PcoEtat is "REFUSE" or "ANNULE")
            {
                if (existante is not null) await planning.SupprimerAsync(existante.Id, existante.Version, u, ct, true);
                c.PcoTacId = null;
            }
            else
            {
                var nature = c.PcoNature is null ? null : await db.NaturesAbsence.AsNoTracking().FirstOrDefaultAsync(n => n.PnaCode == c.PcoNature, ct);
                var valide = c.PcoEtat == "VALIDE";
                var saisie = new TacheSaisie(2, c.PcoDu.ToString("yyyy-MM-dd") + (c.PcoDebutMidi ? "T12:00" : "T00:00"),
                    c.PcoFinMidi ? c.PcoAu.ToString("yyyy-MM-dd") + "T12:00" : c.PcoAu.AddDays(1).ToString("yyyy-MM-dd") + "T00:00", null, 1, salarie.SrvId, "absence", null,
                    valide ? nature?.PnaLibelle ?? "Absence" : "Congé demandé", [new AffectationSaisie(salarie.Interimaire ? "INTERIM" : "SALARIE", salarie.Id.ToString())],
                    "conge", c.PcoId.ToString(), c.PcoCommentaire, 0, valide ? nature?.PnaCouleur : null, valide ? "CONFIRMEE" : "OPTION", existante?.Version);
                if (existante is not null) await planning.ModifierAsync(existante.Id, saisie, u, ct, true);
                else c.PcoTacId = await planning.CreerIdAsync(saisie, u, ct, true);
            }
            await db.SaveChangesAsync(ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            journal.LogWarning(e, "Absence du planning non tenue pour le congé {Conge}", c.PcoId);
        }
    }

    public override Task<List<SalariePointage>> SalariesAsync(PointageDbContext db, FiltreSalaries f, CancellationToken ct) =>
        db.Database.SqlQueryRaw<SalariePointage>("""
            SELECT s.sal_id AS id, s.sal_matricule AS matricule, s.sal_nom AS nom, s.sal_prenom AS prenom, sv.srv_id, sv.srv_libelle AS service,
                   (s.sal_statut = 'INTERIM') AS interimaire, s.sal_ppf_id AS ppf_id, s.sal_agence AS agence,
                   s.sal_code AS code, s.sal_matricule_paie AS matricule_paie, s.sal_poste AS fonction
            FROM salarie s
            LEFT JOIN service_membre sm ON sm.sme_ind_id = s.sal_ind_id AND sm.sme_principal
            LEFT JOIN service sv ON sv.srv_id = sm.sme_srv_id
            WHERE (@ids IS NULL AND s.sal_actif AND (s.sal_date_sortie IS NULL OR s.sal_date_sortie >= current_date - 31)
                   AND (@srv IS NULL OR sv.srv_id = @srv OR sv.srv_parent_id = @srv)
                   AND (@srvs IS NULL OR sv.srv_id = ANY(@srvs) OR sv.srv_parent_id = ANY(@srvs))
                   AND (@fct IS NULL OR s.sal_poste = ANY(@fct))
                   AND (@r IS NULL OR s.sal_nom ILIKE @r OR s.sal_prenom ILIKE @r OR s.sal_matricule ILIKE @r OR s.sal_code ILIKE @r OR s.sal_matricule_paie ILIKE @r)
                   OR s.sal_id = ANY(@ids))
            ORDER BY s.sal_nom, s.sal_prenom
            LIMIT @n
            """,
            new NpgsqlParameter("ids", NpgsqlTypes.NpgsqlDbType.Array | NpgsqlTypes.NpgsqlDbType.Integer) { Value = (object?)f.Ids?.ToArray() ?? DBNull.Value },
            new NpgsqlParameter("srv", NpgsqlTypes.NpgsqlDbType.Integer) { Value = (object?)f.Service ?? DBNull.Value },
            new NpgsqlParameter("srvs", NpgsqlTypes.NpgsqlDbType.Array | NpgsqlTypes.NpgsqlDbType.Integer) { Value = f.Services is { Count: > 0 } ? f.Services.ToArray() : DBNull.Value },
            new NpgsqlParameter("fct", NpgsqlTypes.NpgsqlDbType.Array | NpgsqlTypes.NpgsqlDbType.Text) { Value = f.Fonctions is { Count: > 0 } ? f.Fonctions.ToArray() : DBNull.Value },
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

    /// <summary>
    /// Droit de saisie des heures d'un salarié selon la portée du nœud « pointage » (module Droits ; sans lui : SERVICE) :
    /// SOI = ses propres heures, SERVICE = aussi celles des salariés de son service ou du service fils (responsable), TOUT = tous.
    /// </summary>
    public override async Task<bool> PeutSaisirAsync(PointageDbContext db, Utilisateur u, int salarie, CancellationToken ct)
    {
        var droits = http.HttpContext?.RequestServices.GetService<IDroits>();
        var portee = droits is null ? "SERVICE" : await droits.PorteeAsync(u, "pointage", "MODIFIER", ct);
        if (portee is null) return false;
        if (portee == "TOUT") return true;
        return await db.Database.SqlQueryRaw<bool>("""
            SELECT EXISTS (
              SELECT 1 FROM salarie s
              JOIN individu i ON i.ind_utilisateur = @u
              LEFT JOIN service_membre sm ON sm.sme_ind_id = s.sal_ind_id AND sm.sme_principal
              LEFT JOIN service sv ON sv.srv_id = sm.sme_srv_id
              LEFT JOIN service sp ON sp.srv_id = sv.srv_parent_id
              WHERE s.sal_id = @s AND (s.sal_ind_id = i.ind_id OR (@service AND (sv.srv_responsable_id = i.ind_id OR sp.srv_responsable_id = i.ind_id)))) AS "Value"
            """, new NpgsqlParameter("u", u.Code), new NpgsqlParameter("s", salarie), new NpgsqlParameter("service", portee == "SERVICE")).FirstAsync(ct);
    }

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

    /// <summary>Fonctions = postes des salariés actifs (filtre des bornes).</summary>
    public override Task<List<string>> FonctionsAsync(PointageDbContext db, CancellationToken ct) =>
        db.Database.SqlQueryRaw<string>(
            "SELECT DISTINCT sal_poste AS \"Value\" FROM salarie WHERE sal_actif AND coalesce(sal_poste, '') <> '' ORDER BY 1").ToListAsync(ct);

    public override Task<List<MotifPointage>> MotifsAsync(PointageDbContext db, string domaine, CancellationToken ct) =>
        db.Database.SqlQueryRaw<MotifPointage>("SELECT mot_code AS code, mot_libelle AS libelle FROM motif WHERE mot_domaine = @d AND mot_actif ORDER BY mot_ordre, mot_libelle",
            new NpgsqlParameter("d", domaine)).ToListAsync(ct);

    public override Task<List<EquipePointage>> EquipesAsync(PointageDbContext db, int? service, DateOnly date, CancellationToken ct) =>
        db.Database.SqlQueryRaw<EquipePointage>("""
            SELECT e.equ_id AS id, e.equ_libelle AS libelle,
                   ARRAY(SELECT m.ressource::int FROM f_membres_equipe(e.equ_id, @d) m WHERE m.type IN ('SALARIE', 'INTERIM')
                         ORDER BY m.chef DESC, m.niveau, m.ressource::int) AS membres
            FROM equipe e
            LEFT JOIN service sv ON sv.srv_id = e.equ_srv_id
            WHERE e.equ_active AND (@s IS NULL OR e.equ_srv_id = @s OR sv.srv_parent_id = @s)
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
