using System.Text.Json;
using LogiBTP.Calendrier.Web;
using LogiBTP.Domaine;
using LogiBTP.Planning.Web;
using LogiBTP.Pointage;
using LogiBTP.Pointage.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Ligne de la journée du terrain : pointage de la personne, sur une tâche ou en saisie libre ; nouvelle : aussi pour
/// les membres choisis ; d'une saisie d'équipe : <c>Equipe</c> applique la modification aux membres encore identiques.
/// <c>Numero</c> (terrain-suites lot 10, TS11 a) : numéro d'ordre saisi sans réseau, inconnu de l'appareil (chantier
/// et ordre vides), résolu à l'envoi (<see cref="TerrainBtp.ResoudreNumero"/>).
/// </summary>
public sealed record LigneTerrain(long? Id, long? TacId, int? ChaId, long? EntId, int TypeMo, string? SousType, int Minutes, string? Motif,
    string? Commentaire, List<int>? Membres, bool Equipe = false, string? Numero = null)
{
    /// <summary>Chantier de la ligne, une fois le numéro d'ordre résolu.</summary>
    public int Chantier => ChaId ?? throw ExceptionMetier.Invalide("TERRAIN_CHANTIER", "Chaque ligne a un chantier");
}
/// <summary>
/// Journée envoyée. <c>Connus</c> : pointages du jour que l'appareil connaissait (lus avec la journée) ; seuls
/// ceux-là peuvent être retirés, un pointage ajouté entre-temps ailleurs (bureau, borne, autre appareil, saisie hors
/// ligne d'une journée périmée) est gardé. Absent : la journée est remplacée entièrement.
/// </summary>
public sealed record JourneeTerrain(DateOnly Date, List<LigneTerrain> Lignes, List<long>? Connus = null);

/// <summary>
/// Application de terrain, lot 2 (ANALYSE-TERRAIN.md, T4, T7, T8, T21, T22) : pointage de la journée de la personne
/// connectée. Une ligne pointe une tâche du jour (au niveau de détail planifié : chantier, ordre d'origine, ligne
/// d'ordre d'une tâche d'origine ligne : <c>poi_lig_id</c>, terrain-suites lot 7) ou, en
/// saisie libre, le chantier et l'ordre choisis ; la saisie libre crée une tâche réalisée non planifiée (origine
/// <c>terrain</c>, état terminé) affectée à la personne et à son équipe. Équipe : sur une tâche, le chef de l'équipe
/// affectée pointe pour les membres de la tâche ; en saisie libre, droit « pointage/saisie_libre » à portée EQUIPE
/// (le chef choisit parmi ses équipiers du jour et son service). Un pointage par membre, même groupe (<c>poi_groupe</c>) ;
/// une ligne d'équipe modifiée modifie les pointages des membres encore identiques. Mêmes contrôles et blocages que
/// la saisie au bureau (jour validé : 409 POI_VALIDE).
/// </summary>
public static partial class TerrainBtp
{
    /// <summary>Origine des tâches créées par une saisie libre du terrain.</summary>
    public const string OrigineTerrain = "terrain";
    private const string NoeudSaisieLibre = "pointage/saisie_libre";

    private sealed record TacheJour(long Id, string Libelle, int? ChaId, long? EntId, int? SrvId, int? TypeMo, decimal Poids, bool Chef, string Membres,
        long? LigId = null, string? Ligne = null);
    private sealed record PointageJour(long Id, int ChaId, long? EntId, int TypeMo, string? SousType, int Minutes, string? Motif, string? Commentaire, long? TacId, Guid? Groupe, int NbGroupe,
        long? LigId = null, string? Ligne = null);

    /// <summary>
    /// Ligne d'ordre portée par le pointage d'une tâche (lot 7, TS5 a) : celle de la tâche d'origine ligne, tant que le
    /// pointage reste sur le document de la ligne ; sinon aucune (niveau chantier ou ordre).
    /// </summary>
    public static long? LigneDuPointage(long? ligneTache, long? documentTache, long? documentPointe) =>
        ligneTache is not null && documentTache is not null && documentTache == documentPointe ? ligneTache : null;
    private sealed record Equipier(int Id, string Libelle);

    /// <summary>Tâches du jour @du de la personne @s : type de MO proposé (service de la tâche ou son parent), poids pour répartir la journée, équipe dont elle est le chef.</summary>
    private const string SqlTachesJour = """
        SELECT x.tac_id AS id, x.tac_libelle AS libelle, x.cha_id, x.ent_id, x.tac_srv_id AS srv_id, x.lig_id, x.lig_libelle AS ligne,
          (SELECT n.nat_id FROM nature_element n LEFT JOIN service sv ON sv.srv_id = x.tac_srv_id
           WHERE n.nat_rgn_code = 'MO' AND n.nat_srv_id IN (x.tac_srv_id, sv.srv_parent_id) ORDER BY n.nat_srv_id = x.tac_srv_id DESC, n.nat_code LIMIT 1) AS type_mo,
          coalesce((SELECT a.aff_heures FROM pla_affectation a WHERE a.aff_tac_id = x.tac_id AND a.aff_res_type IN ('SALARIE', 'INTERIM') AND a.aff_res_id = @s::text LIMIT 1), 0)
            * extract(epoch FROM least(x.tac_fin, @du::date + 1) - greatest(x.tac_debut, @du::date)) / greatest(extract(epoch FROM x.tac_fin - x.tac_debut), 60) AS poids,
          EXISTS (SELECT 1 FROM pla_affectation a CROSS JOIN LATERAL f_membres_equipe(a.aff_equipe_id, @du::date) c
                  WHERE a.aff_tac_id = x.tac_id AND a.aff_equipe_id IS NOT NULL AND c.chef AND c.type IN ('SALARIE', 'INTERIM') AND c.ressource = @s::text) AS chef,
          coalesce((SELECT json_agg(json_build_object('id', r.id::int, 'libelle', r.libelle) ORDER BY r.libelle)::text
                    FROM pla_affectation a JOIN v_ressource r ON r.type = a.aff_res_type AND r.id = a.aff_res_id
                    WHERE a.aff_tac_id = x.tac_id AND a.aff_res_type IN ('SALARIE', 'INTERIM') AND a.aff_res_id <> @s::text
                      AND EXISTS (SELECT 1 FROM f_membres_equipe(a.aff_equipe_id, @du::date) c WHERE c.chef AND c.type IN ('SALARIE', 'INTERIM') AND c.ressource = @s::text)), '[]') AS membres
        FROM x WHERE x.tac_origine_type IS DISTINCT FROM 'conge' ORDER BY x.tac_debut, x.tac_id
        """;

    private static RouteGroupBuilder MapJournee(this RouteGroupBuilder g)
    {
        g.MapGet("/journee", async (DateOnly? date, HttpContext http, LogiBtpContext db, IServiceProvider services, CancellationToken ct) =>
        {
            var jour = date ?? DateOnly.FromDateTime(DateTime.Today);
            var u = Utilisateur.Depuis(http);
            if (await ComptesBtp.SalarieAsync(db, u.Code, ct) is not int s) return Results.Ok(new { personne = (object?)null, date = jour });
            return Results.Ok(await JourneeAsync(db, services, u, s, jour, ct));
        });
        // Hors ligne (terrain-suites lot 9, TS10 b, TS11 b) : chantiers et ordres ouverts proposés à la saisie libre et à
        // la recherche d'un ordre par son numéro sans réseau, préchargés chaque jour.
        g.MapGet("/journee/chantiers", async (HttpContext http, LogiBtpContext db, IServiceProvider services, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            if (await ComptesBtp.SalarieAsync(db, u.Code, ct) is not int s) return Results.Ok(new { personne = (object?)null });
            return Results.Ok(await ChantiersHorsLigneAsync(db, services, u, s, ct));
        });
        g.MapPut("/journee", async (JourneeTerrain j, HttpContext http, LogiBtpContext db, IServiceProvider services, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var s = await ComptesBtp.SalarieAsync(db, u.Code, ct) ?? throw ExceptionMetier.Invalide("TERRAIN_PERSONNE", "Compte sans salarié lié");
            await EnregistrerAsync(db, services, u, s, j, ct);
            return Results.Ok(await JourneeAsync(db, services, u, s, j.Date, ct));
        });
        return g;
    }

    private static NpgsqlParameter[] ParametresJour(int s, DateOnly jour) => Parametres(s, jour, jour);

    /// <summary>Portée du droit de saisie libre (null : refusée ; sans module Droits : SOI).</summary>
    private static async Task<string?> PorteeLibreAsync(IServiceProvider services, Utilisateur u, CancellationToken ct) =>
        services.GetService<IDroits>() is { } d ? await d.PorteeAsync(u, NoeudSaisieLibre, ActionsDroits.Creer, ct) : "SOI";

    /// <summary>Équipiers proposés à la saisie libre en équipe : membres de ses équipes du jour et salariés de son service principal.</summary>
    private static Task<List<Equipier>> EquipiersLibresAsync(LogiBtpContext db, Utilisateur u, int s, DateOnly jour, CancellationToken ct) =>
        db.Database.SqlQueryRaw<Equipier>($$"""
            SELECT r.id::int AS id, r.libelle FROM v_ressource r
            WHERE r.type IN ('SALARIE', 'INTERIM') AND r.actif AND r.id <> @s::text
              AND (r.id::int IN ({{ComptesBtp.SqlEquipiers}})
                OR r.srv_id = (SELECT sm.sme_srv_id FROM salarie sa JOIN service_membre sm ON sm.sme_ind_id = sa.sal_ind_id AND sm.sme_principal WHERE sa.sal_id = @s))
            ORDER BY r.libelle
            """, new NpgsqlParameter("s", s), new NpgsqlParameter("u", u.Code), new NpgsqlParameter("jour", jour)).ToListAsync(ct);

    private static async Task<List<TacheJour>> TachesJourAsync(LogiBtpContext db, int s, DateOnly jour, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<TacheJour>($"{SqlTaches}\n{SqlTachesJour}", ParametresJour(s, jour)).ToListAsync(ct);

    /// <summary>Journée : tâches, pointages saisis, minutes du calendrier, blocage, droits de saisie libre et équipiers proposés.</summary>
    private static async Task<object> JourneeAsync(LogiBtpContext db, IServiceProvider services, Utilisateur u, int s, DateOnly jour, CancellationToken ct)
    {
        var pointage = services.GetRequiredService<ServicePointage>();
        var taches = await TachesJourAsync(db, s, jour, ct);
        var pointages = await db.Database.SqlQueryRaw<PointageJour>("""
            SELECT p.poi_id AS id, p.poi_cha_id AS cha_id, p.poi_ent_id AS ent_id, p.poi_type_mo AS type_mo, p.poi_sous_type AS sous_type, p.poi_minutes::int AS minutes,
                   p.poi_motif AS motif, p.poi_commentaire AS commentaire, p.poi_tac_id AS tac_id, p.poi_groupe AS groupe,
                   (SELECT count(*)::int FROM poi_pointage g WHERE g.poi_groupe = p.poi_groupe AND g.poi_couche = 'SAISIE') AS nb_groupe,
                   p.poi_lig_id AS lig_id, nullif(concat_ws(' ', l.lig_code, left(regexp_replace(l.lig_libelle_brut, '\s+', ' ', 'g'), 80)), '') AS ligne
            FROM poi_pointage p LEFT JOIN document_ligne l ON l.lig_id = p.poi_lig_id WHERE p.poi_sal_id = @s AND p.poi_date = @d AND p.poi_couche = 'SAISIE' ORDER BY p.poi_id
            """, new NpgsqlParameter("s", s), new NpgsqlParameter("d", jour)).ToListAsync(ct);
        var journees = await CalendriersBtp.JourneesAsync(db, services.GetRequiredService<ServiceCalendrier>(), TypesFiche.Salarie, s, jour, jour, ct);
        var libre = await PorteeLibreAsync(services, u, ct);
        var specialisation = services.GetRequiredService<SpecialisationPointage>();
        var pdb = services.GetRequiredService<PointageDbContext>();
        var chantiersIds = taches.Where(t => t.ChaId is not null).Select(t => t.ChaId!.Value).Concat(pointages.Select(p => p.ChaId)).Distinct().ToList();
        var chantiers = libre is null ? await specialisation.ChantiersAsync(pdb, null, chantiersIds, ct) : await specialisation.TousChantiersAsync(pdb, ct);
        if (libre is not null) chantiers.AddRange(await specialisation.ChantiersAsync(pdb, null, chantiersIds.Where(id => chantiers.All(c => c.Id != id)).ToList(), ct));
        return new
        {
            personne = new { id = s }, date = jour, minutes_prevues = journees.FirstOrDefault()?.Minutes ?? 0,
            valide = await pointage.JourBloqueAsync(s, jour, ct),
            taches = taches.Select(t => new
            {
                id = t.Id, libelle = t.Libelle, cha_id = t.ChaId, ent_id = t.EntId, lig_id = t.LigId, ligne = t.Ligne, srv_id = t.SrvId, type_mo = t.TypeMo, poids = t.Poids, chef = t.Chef,
                membres = JsonDocument.Parse(t.Membres).RootElement,
            }),
            pointages,
            libre, equipiers = libre is "EQUIPE" or "SERVICE" or "TOUT" ? await EquipiersLibresAsync(db, u, s, jour, ct) : [],
            chantiers, ordres = await specialisation.OrdresAsync(pdb, chantiers.Select(c => c.Id).ToList(), ct),
            motifs = await MotifsAsync(db, ct),
        };
    }

    /// <summary>Périmètre des chantiers gardés hors ligne : service principal de la personne, sinon son planning à un mois (lot 9).</summary>
    public static string PerimetreHorsLigne(int? servicePrincipal) => servicePrincipal is null ? PerimetrePlanning : PerimetreService;
    public const string PerimetreService = "SERVICE";
    public const string PerimetrePlanning = "PLANNING";

    /// <summary>
    /// Chantiers gardés hors ligne pour la personne @s (lot 9, TS10 b) : chantiers ouverts (hors dotations, sauf entretien
    /// en cours) de son service principal ou de ses services fils (@srv : un ordre en vigueur non terminé ou une tâche
    /// du planning à un mois de ce service), chantiers de son planning à un mois (seul critère sans service principal :
    /// @srv nul) et chantiers internes.
    /// </summary>
    public const string SqlChantiersHorsLigne = $"""
        WITH srv AS (SELECT v.srv_id FROM service v WHERE v.srv_id = @srv OR v.srv_parent_id = @srv)
        SELECT c.cha_id AS id, c.cha_code AS code, c.cha_libelle AS libelle, FALSE AS clos, c.cha_interne AS interne,
               c.cha_ville AS ville, t.per_raison_sociale AS client
        FROM chantier c LEFT JOIN personne t ON t.per_id = c.cha_tiers_id
        WHERE c.cha_interne
           OR c.cha_statut = 'OUVERT' AND (NOT f_chantier_dotation(c.cha_id) OR f_chantier_entretien_ouvert(c.cha_id)) AND (
                EXISTS (SELECT 1 FROM pla_tache k JOIN pla_affectation a ON a.aff_tac_id = k.tac_id
                        WHERE a.aff_res_type IN ('SALARIE', 'INTERIM') AND a.aff_res_id = @s::text AND k.tac_type_element = 'chantier' AND k.tac_id_element = c.cha_id::text
                          AND k.tac_debut < current_date + 31 AND k.tac_fin > current_date - 31)
             OR EXISTS (SELECT 1 FROM pla_tache k JOIN srv ON srv.srv_id = k.tac_srv_id
                        WHERE k.tac_type_element = 'chantier' AND k.tac_id_element = c.cha_id::text AND k.tac_debut < current_date + 31 AND k.tac_fin > current_date - 31)
             OR EXISTS (SELECT 1 FROM document d JOIN srv ON srv.srv_id = d.ent_srv_id JOIN type_document ty ON ty.tyd_id = d.ent_tyd_id JOIN statut_document st ON st.std_id = d.ent_std_id
                        WHERE d.ent_chantier_id = c.cha_id AND ty.tyd_famille = 'E' AND d.ent_is_reference AND st.std_code NOT IN ({SqlBtp.HorsVigueur})
                          AND coalesce(d.ent_exe_etat, '') <> 'TERMINE'))
        ORDER BY c.cha_interne, c.cha_code
        LIMIT 5000
        """;

    /// <summary>Chantiers et ordres ouverts gardés hors ligne (lot 9) ; sans droit de saisie libre : aucun.</summary>
    private static async Task<object> ChantiersHorsLigneAsync(LogiBtpContext db, IServiceProvider services, Utilisateur u, int s, CancellationToken ct)
    {
        var libre = await PorteeLibreAsync(services, u, ct);
        var srv = await db.Database.SqlQueryRaw<int?>("""
            SELECT sm.sme_srv_id AS "Value" FROM salarie sa JOIN service_membre sm ON sm.sme_ind_id = sa.sal_ind_id AND sm.sme_principal WHERE sa.sal_id = @s
            """, new NpgsqlParameter("s", s)).FirstOrDefaultAsync(ct);
        var pdb = services.GetRequiredService<PointageDbContext>();
        List<ChantierPointage> chantiers = libre is null ? [] : await pdb.Database.SqlQueryRaw<ChantierPointage>(SqlChantiersHorsLigne, new NpgsqlParameter("s", s),
            SqlBtp.P("srv", srv, NpgsqlTypes.NpgsqlDbType.Integer)).ToListAsync(ct);
        List<OrdrePointage> ordres = chantiers.Count == 0 ? [] : await services.GetRequiredService<SpecialisationPointage>().OrdresAsync(pdb, chantiers.Select(c => c.Id).ToList(), ct);
        return new { personne = new { id = s }, libre, perimetre = PerimetreHorsLigne(srv), chantiers, ordres };
    }

    /// <summary>Ordre trouvé par son numéro (lot 10).</summary>
    public sealed record OrdreNumero(long Id, int ChaId);

    /// <summary>Numéro d'ordre comparé sans casse ni espaces (même règle que <c>chercherOrdre</c> du client).</summary>
    public static string NumeroNormalise(string? numero) => System.Text.RegularExpressions.Regex.Replace(numero ?? "", @"\s+", "").ToUpperInvariant();

    /// <summary>
    /// Ligne nouvelle portant un numéro d'ordre saisi sans réseau (lot 10, TS11 a) : ordre et chantier de l'unique ordre
    /// en vigueur de ce numéro ; aucun ou plusieurs : refus <see cref="ErreursTerrain.OrdreInconnu"/> (journée gardée en
    /// erreur sur l'appareil, règle T9). Ordre déjà choisi ou ligne existante : inchangée.
    /// </summary>
    public static LigneTerrain ResoudreNumero(LigneTerrain l, IReadOnlyList<OrdreNumero> trouves)
    {
        if (l.Id is not null || l.EntId is not null || string.IsNullOrWhiteSpace(l.Numero)) return l;
        if (trouves.Count != 1)
            throw ExceptionMetier.Invalide(ErreursTerrain.OrdreInconnu, $"Ordre {l.Numero.Trim()} inconnu", new { numero = l.Numero.Trim() });
        return l with { EntId = trouves[0].Id, ChaId = trouves[0].ChaId };
    }

    /// <summary>Résout les numéros d'ordre des lignes de la journée (ordres d'exécution en vigueur non terminés, sur un chantier).</summary>
    private static async Task<JourneeTerrain> ResoudreNumerosAsync(LogiBtpContext db, JourneeTerrain j, CancellationToken ct)
    {
        if (!j.Lignes.Any(l => l.Id is null && l.EntId is null && !string.IsNullOrWhiteSpace(l.Numero))) return j;
        var lignes = new List<LigneTerrain>();
        foreach (var l in j.Lignes)
        {
            var trouves = l.Id is null && l.EntId is null && !string.IsNullOrWhiteSpace(l.Numero)
                ? await db.Database.SqlQueryRaw<OrdreNumero>($"""
                    SELECT d.ent_id AS id, d.ent_chantier_id AS cha_id FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document st ON st.std_id = d.ent_std_id
                    WHERE t.tyd_famille = 'E' AND d.ent_is_reference AND d.ent_chantier_id IS NOT NULL AND upper(regexp_replace(d.ent_numero, '\s+', '', 'g')) = @n
                      AND st.std_code NOT IN ({SqlBtp.HorsVigueur}) AND coalesce(d.ent_exe_etat, '') <> 'TERMINE'
                    LIMIT 2
                    """, new NpgsqlParameter("n", NumeroNormalise(l.Numero))).ToListAsync(ct)
                : [];
            lignes.Add(ResoudreNumero(l, trouves));
        }
        return j with { Lignes = lignes };
    }

    private static string Signature(DateOnly d, int cha, long? ent, int type, string? st, int min, string? motif) => $"{d}|{cha}|{ent}|{type}|{st}|{min}|{motif}";

    /// <summary>Remplace les pointages saisis de la journée de la personne par les lignes (les autres jours sont inchangés).</summary>
    private static async Task EnregistrerAsync(LogiBtpContext db, IServiceProvider services, Utilisateur u, int s, JourneeTerrain j, CancellationToken ct)
    {
        var pointage = services.GetRequiredService<ServicePointage>();
        var pdb = services.GetRequiredService<PointageDbContext>();
        var specialisation = services.GetRequiredService<SpecialisationPointage>();
        var taches = (await TachesJourAsync(db, s, j.Date, ct)).ToDictionary(t => t.Id);
        j = await ResoudreNumerosAsync(db, j, ct);
        var lundi = ReglesPointage.LundiDe(j.Date);
        var semaine = await pdb.Pointages.AsNoTracking().Where(x => x.PoiSalId == s && x.PoiCouche == Couches.Saisie && x.PoiDate >= lundi && x.PoiDate <= lundi.AddDays(6)).ToListAsync(ct);
        var avant = semaine.Where(x => x.PoiDate == j.Date).ToDictionary(x => x.PoiId);
        if (j.Lignes.Any(l => l.Id is long id && !avant.ContainsKey(id))) throw ExceptionMetier.Conflit("POI_MODIFIE", "Pointage introuvable dans la journée : relire la journée");

        // Droits : tâche du jour de la personne ; saisie libre selon la portée ; membres de l'équipe de la tâche dont elle est le chef ou ses équipiers.
        var libre = await PorteeLibreAsync(services, u, ct);
        var equipiers = libre is "EQUIPE" or "SERVICE" or "TOUT" ? (await EquipiersLibresAsync(db, u, s, j.Date, ct)).Select(e => e.Id).ToHashSet() : [];
        var nouvellesLibres = new List<(LigneTerrain Ligne, int Index)>();
        foreach (var (l, i) in j.Lignes.Select((l, i) => (l, i)))
        {
            var membres = (l.Membres ?? []).Where(m => m != s).Distinct().ToList();
            if (l.TacId is long t)
            {
                if (!taches.TryGetValue(t, out var tache)) throw ExceptionMetier.Invalide("TERRAIN_TACHE", "Tâche absente de votre journée");
                var autorises = JsonDocument.Parse(tache.Membres).RootElement.EnumerateArray().Select(e => e.GetProperty("id").GetInt32()).ToHashSet();
                if (membres.Count > 0 && (!tache.Chef || membres.Any(m => !autorises.Contains(m))))
                    throw ExceptionMetier.AccesRefuse("pointage de l'équipe de la tâche (chef de l'équipe affectée seulement)");
            }
            else if (l.Id is null)
            {
                if (libre is null) throw ExceptionMetier.AccesRefuse("saisie libre");
                if (membres.Count > 0 && membres.Any(m => !equipiers.Contains(m))) throw ExceptionMetier.AccesRefuse("saisie libre en équipe");
                nouvellesLibres.Add((l, i));
            }
            // Saisie d'équipe modifiée pour tous : chef de l'équipe de la tâche, ou droit de saisie libre en équipe.
            if (l.Equipe && l.Id is long ex && !(avant[ex].PoiTacId is long pt && taches.TryGetValue(pt, out var tj) && tj.Chef) && equipiers.Count == 0)
                throw ExceptionMetier.AccesRefuse("modification de la saisie d'équipe (chef de l'équipe seulement)");
        }

        // Saisie libre : une tâche réalisée non planifiée par ligne nouvelle (avant la transaction des pointages, retirée en cas d'échec).
        var planning = services.GetRequiredService<ServicePlanning>();
        var creees = new Dictionary<int, long>();
        // Tâche d'une ligne : celle choisie, sinon la tâche libre créée ; absente d'une ligne existante = inchangée.
        long? Tache(LigneTerrain l, int i) => l.TacId ?? (creees.TryGetValue(i, out var c) ? c : null);
        // Ligne d'ordre : tâche d'origine ligne pointée sur le document de la ligne (lot 7) ; saisie libre : aucune (TS7 a).
        long? Ligne(LigneTerrain l) => l.TacId is long t && taches.TryGetValue(t, out var tj) ? LigneDuPointage(tj.LigId, tj.EntId, l.EntId) : null;
        var salaries = (await specialisation.SalariesAsync(pdb, new FiltreSalaries(null, null,
            [s, .. j.Lignes.SelectMany(l => l.Membres ?? [])]), ct)).ToDictionary(x => x.Id);
        foreach (var (l, i) in nouvellesLibres)
        {
            var personnes = new[] { s }.Concat(l.Membres ?? []).Distinct().Where(salaries.ContainsKey).ToList();
            var srv = await db.Database.SqlQueryRaw<int?>("SELECT nat_srv_id AS \"Value\" FROM nature_element WHERE nat_id = @n", new NpgsqlParameter("n", l.TypeMo)).FirstOrDefaultAsync(ct);
            var libelle = await db.Database.SqlQueryRaw<string>("""
                SELECT '🛠 ' || coalesce((SELECT d.ent_numero FROM document d WHERE d.ent_id = @e), c.cha_code) AS "Value" FROM chantier c WHERE c.cha_id = @c
                """, SqlBtp.P("e", l.EntId), new NpgsqlParameter("c", l.Chantier)).FirstOrDefaultAsync(ct) ?? "🛠 Saisie libre";
            creees[i] = await planning.CreerIdAsync(new TacheSaisie(2, LiaisonsBtp.DateHeure(j.Date), LiaisonsBtp.DateHeure(j.Date.AddDays(1)), null, personnes.Count,
                srv ?? salaries.GetValueOrDefault(s)?.SrvId, TypesFiche.Chantier, l.Chantier.ToString(), $"{libelle} (saisie libre)",
                personnes.Select(p => new AffectationSaisie(salaries[p].Interimaire ? "INTERIM" : "SALARIE", p.ToString())).ToList(),
                OrigineTerrain, s.ToString(), $"Saisie libre du terrain par {u.Code}", 100, null, "TERMINEE"), u, ct, true);
        }

        try
        {
            await using var tx = await pdb.Database.BeginTransactionAsync(ct);
            // Journée de la personne : lignes nouvelles ou modifiées ; heures de début et de fin d'une ligne inchangée conservées.
            var groupes = new Dictionary<int, Guid>();
            bool Modifiee(LigneTerrain l) => l.Id is not long id || avant[id] is var e && (e.PoiChaId != l.ChaId || e.PoiEntId != l.EntId || e.PoiTypeMo != l.TypeMo
                || e.PoiSousType != l.SousType || e.PoiMinutes != l.Minutes);
            var envoyes = j.Lignes.Where(l => l.Id is not null).Select(l => l.Id!.Value).ToHashSet();
            var saisie = semaine.Where(x => x.PoiDate != j.Date || j.Connus is not null && !j.Connus.Contains(x.PoiId) && !envoyes.Contains(x.PoiId))
                .Select(x => new PointageSaisi(x.PoiId, x.PoiDate, x.PoiChaId, x.PoiEntId, x.PoiTypeMo, x.PoiSousType, x.PoiMinutes, x.PoiDebut, x.PoiFin, x.PoiMotif, x.PoiCommentaire))
                .Concat(j.Lignes.Select((l, i) =>
                {
                    Guid? groupe = l.Id is null && (l.Membres ?? []).Any(m => m != s) ? groupes[i] = Guid.NewGuid() : null;
                    var garde = !Modifiee(l);
                    return new PointageSaisi(l.Id, j.Date, l.Chantier, l.EntId, l.TypeMo, l.SousType, l.Minutes, garde ? avant[l.Id!.Value].PoiDebut : null,
                        garde ? avant[l.Id!.Value].PoiFin : null, l.Motif, l.Commentaire, TacId: Tache(l, i), Groupe: groupe, LigId: Ligne(l));
                })).ToList();
            await pointage.EnregistrerSemaineAsync(s, lundi, new SemaineSaisie(saisie), u, ct);

            // Membres : un pointage par membre pour une ligne d'équipe nouvelle ; ligne d'équipe modifiée : membres encore identiques.
            foreach (var (l, i) in j.Lignes.Select((l, i) => (l, i)))
            {
                foreach (var m in (l.Membres ?? []).Where(m => m != s).Distinct().Where(_ => l.Id is null))
                    await AjouterAsync(pdb, pointage, u, m, new PointageSaisi(null, j.Date, l.Chantier, l.EntId, l.TypeMo, l.SousType, l.Minutes, null, null, l.Motif, l.Commentaire,
                        TacId: Tache(l, i), Groupe: groupes[i], LigId: Ligne(l)), ct);
                if (l.Id is long id && avant[id].PoiGroupe is Guid g && Modifiee(l) && l.Equipe)
                {
                    var e = avant[id];
                    var reference = Signature(e.PoiDate, e.PoiChaId, e.PoiEntId, e.PoiTypeMo, e.PoiSousType, e.PoiMinutes, e.PoiMotif);
                    var autres = await pdb.Pointages.AsNoTracking().Where(p => p.PoiGroupe == g && p.PoiCouche == Couches.Saisie && p.PoiSalId != s).ToListAsync(ct);
                    foreach (var p in autres.Where(p => Signature(p.PoiDate, p.PoiChaId, p.PoiEntId, p.PoiTypeMo, p.PoiSousType, p.PoiMinutes, p.PoiMotif) == reference))
                        await RemplacerAsync(pdb, pointage, u, p, l, Ligne(l), ct);
                }
            }
            await tx.CommitAsync(ct);
        }
        catch
        {
            foreach (var id in creees.Values)
                await planning.SupprimerAsync(id, 1, u, ct, true);
            throw;
        }

        // Non-conformités nouvelles ; tâches libres de la personne devenues sans pointage : retirées.
        foreach (var l in j.Lignes.Where(l => !string.IsNullOrWhiteSpace(l.Motif) && (l.Id is not long id || avant[id].PoiMotif != l.Motif.Trim())))
            await specialisation.ApresNonConformiteAsync(pdb, services, u, salaries[s], l.Chantier, l.EntId, l.Motif!.Trim(), ct);
        var orphelines = await db.Database.SqlQueryRaw<TacheExistante>("""
            SELECT t.tac_id AS id, t.tac_version AS version FROM pla_tache t
            WHERE t.tac_origine_type = 'terrain' AND t.tac_origine_id = @s::text AND NOT EXISTS (SELECT 1 FROM poi_pointage p WHERE p.poi_tac_id = t.tac_id)
            """, new NpgsqlParameter("s", s)).ToListAsync(ct);
        foreach (var o in orphelines) await planning.SupprimerAsync(o.Id, o.Version, u, ct, true);
    }

    private sealed record TacheExistante(long Id, int Version);

    /// <summary>Ajoute un pointage à la semaine d'un membre (droit vérifié par l'appelant : chef de l'équipe de la tâche ou équipier).</summary>
    private static async Task AjouterAsync(PointageDbContext pdb, ServicePointage pointage, Utilisateur u, int salarie, PointageSaisi nouveau, CancellationToken ct)
    {
        var lundi = ReglesPointage.LundiDe(nouveau.Date);
        var existants = await pdb.Pointages.AsNoTracking().Where(x => x.PoiSalId == salarie && x.PoiCouche == Couches.Saisie && x.PoiDate >= lundi && x.PoiDate <= lundi.AddDays(6)).ToListAsync(ct);
        var saisie = existants.Select(x => new PointageSaisi(x.PoiId, x.PoiDate, x.PoiChaId, x.PoiEntId, x.PoiTypeMo, x.PoiSousType, x.PoiMinutes, x.PoiDebut, x.PoiFin, x.PoiMotif, x.PoiCommentaire))
            .Append(nouveau).ToList();
        await pointage.EnregistrerSemaineAsync(salarie, lundi, new SemaineSaisie(saisie), u, ct, controleAcces: false);
    }

    /// <summary>Remplace un pointage d'un membre du groupe par les valeurs de la ligne (commentaire du membre conservé).</summary>
    private static async Task RemplacerAsync(PointageDbContext pdb, ServicePointage pointage, Utilisateur u, PointageEntite p, LigneTerrain l, long? ligne, CancellationToken ct)
    {
        var lundi = ReglesPointage.LundiDe(p.PoiDate);
        var semaine = await pdb.Pointages.AsNoTracking().Where(x => x.PoiSalId == p.PoiSalId && x.PoiCouche == Couches.Saisie && x.PoiDate >= lundi && x.PoiDate <= lundi.AddDays(6)).ToListAsync(ct);
        var saisie = semaine.Select(x => x.PoiId == p.PoiId
            ? new PointageSaisi(x.PoiId, x.PoiDate, l.Chantier, l.EntId, l.TypeMo, l.SousType, l.Minutes, null, null, l.Motif, x.PoiCommentaire, LigId: ligne)
            : new PointageSaisi(x.PoiId, x.PoiDate, x.PoiChaId, x.PoiEntId, x.PoiTypeMo, x.PoiSousType, x.PoiMinutes, x.PoiDebut, x.PoiFin, x.PoiMotif, x.PoiCommentaire)).ToList();
        await pointage.EnregistrerSemaineAsync(p.PoiSalId, lundi, new SemaineSaisie(saisie), u, ct, controleAcces: false);
    }
}
