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
                   (s.sal_statut = 'INTERIM') AS interimaire
            FROM salarie s
            LEFT JOIN service_membre sm ON sm.sme_ind_id = s.sal_ind_id AND sm.sme_principal
            LEFT JOIN service sv ON sv.srv_id = sm.sme_srv_id
            WHERE (@ids IS NULL AND s.sal_actif AND (s.sal_date_sortie IS NULL OR s.sal_date_sortie >= current_date - 31)
                   AND (@srv IS NULL OR sv.srv_id = @srv OR sv.srv_parent_id = @srv)
                   AND (@r IS NULL OR s.sal_nom ILIKE @r OR s.sal_prenom ILIKE @r OR s.sal_matricule ILIKE @r)
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
            SELECT d.ent_id AS id, d.ent_chantier_id AS cha_id, d.ent_numero AS numero, d.ent_objet AS objet, t.tyd_libelle AS type
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
