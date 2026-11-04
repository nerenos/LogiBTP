using LogiBTP.Domaine.Ressources;
using LogiBTP.Domaine;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using static LogiBTP.Api.Btp.SqlBtp;
using NpgsqlTypes;

namespace LogiBTP.Api.Btp;

public sealed record TypeHabilitationSaisi(string Code, string Libelle, string Categorie, string Concerne, int? DureeMois, int Ordre, bool Actif);
public sealed record HabilitationSaisie(int? Id, string Code, DateOnly? ObtenueLe, DateOnly? ValideJusquAu, string? Numero, string? Organisme, long? DgeId, string? Commentaire);
public sealed record MissionSaisie(int? Id, long? AgenceId, DateOnly? Debut, DateOnly? Fin, decimal? TauxHoraire, int? ChantierId, string? Commentaire);
public sealed record MotifSaisi(int? Id, string Domaine, string Code, string Libelle, int? SrvId, int Ordre, bool Actif);
public sealed record NatureService(int Id, int? SrvId);

/// <summary>
/// Référentiel des ressources (db/195 ; ANALYSE-MODULES-TRANSVERSE.md § 4.2 et § 4.4) : types d'habilitations,
/// habilitations des salariés et des matériels (état par <see cref="ReglesRessources"/>), missions des intérimaires,
/// motifs typés, natures de main-d'œuvre rattachées aux services, équipes et compositions en cours.
/// Routes : <c>/api/ressources/*</c>.
/// </summary>
public static class Ressources
{
    private static readonly HashSet<string> Elements = [TypesFiche.Salarie, TypesFiche.Materiel];
    private static readonly HashSet<string> Categories = ["CACES", "HAUTEUR", "ELECTRIQUE", "SECURITE", "MEDICAL", "CONTROLE", "AUTRE"];
    private static readonly HashSet<string> Concernes = ["SALARIE", "MATERIEL", "LES_DEUX"];
    private static readonly HashSet<string> Domaines = ["BLOCAGE", "NON_CONFORMITE", "ECART_PLANNING", "AUTRE"];

    private static void Admin(Utilisateur u)
    {
        u.ExigerParametres();
    }

    private sealed record LigneType(string Code, int? DureeMois, string Concerne, bool Actif);

    /// <summary>Types d'habilitations pour les règles (durée, élément concerné, actif).</summary>
    public static async Task<Dictionary<string, TypeHabilitation>> TypesAsync(LogiBtpContext db, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<LigneType>("SELECT tha_code AS code, tha_duree_mois AS duree_mois, tha_concerne AS concerne, tha_actif AS actif FROM type_habilitation")
            .ToListAsync(ct)).ToDictionary(x => x.Code, x => new TypeHabilitation(x.DureeMois, x.Concerne, x.Actif));

    private sealed record LigneHabilitation(int Id, string Code, string Libelle, DateOnly? ObtenueLe, DateOnly? ValideJusquAu, string? Numero,
        string? Organisme, long? DgeId, string? Commentaire, int? DureeMois, string TypeElement, int IdElement, string? Element);

    private const string SqlHabilitations = """
        SELECT h.hab_id AS id, h.hab_tha_code AS code, t.tha_libelle AS libelle, h.hab_obtenue_le AS obtenue_le, h.hab_valide_jusqu_au AS valide_jusqu_au,
               h.hab_numero AS numero, h.hab_organisme AS organisme, h.hab_dge_id AS dge_id, h.hab_commentaire AS commentaire, t.tha_duree_mois AS duree_mois,
               h.hab_type_element AS type_element, h.hab_id_element AS id_element,
               CASE h.hab_type_element WHEN 'salarie' THEN (SELECT concat_ws(' ', s.sal_prenom, s.sal_nom, '·', s.sal_matricule) FROM salarie s WHERE s.sal_id = h.hab_id_element)
                    ELSE (SELECT concat_ws(' · ', m.mat_code, m.mat_designation) FROM materiel m WHERE m.mat_id = h.hab_id_element) END AS element
        FROM habilitation h JOIN type_habilitation t ON t.tha_code = h.hab_tha_code
        """;

    private static object Decrire(LigneHabilitation h, DateOnly aujourdhui)
    {
        var e = ReglesRessources.Etat(new HabilitationEvaluee(h.Code, h.ObtenueLe, h.ValideJusquAu), h.DureeMois, aujourdhui);
        return new
        {
            id = h.Id, code = h.Code, libelle = h.Libelle, obtenue_le = h.ObtenueLe, valide_jusqu_au = h.ValideJusquAu, fin = e.Fin, etat = e.Etat,
            jours_restants = e.JoursRestants, numero = h.Numero, organisme = h.Organisme, dge_id = h.DgeId, commentaire = h.Commentaire,
            type_element = h.TypeElement, id_element = h.IdElement, element = h.Element,
        };
    }

    private static DateOnly Aujourdhui => DateOnly.FromDateTime(DateTime.Now);

    public static async Task<List<object>> HabilitationsAsync(LogiBtpContext db, string element, int id, CancellationToken ct)
    {
        if (!Elements.Contains(element)) throw ExceptionMetier.Invalide("ELEMENT", $"Élément inconnu : {element}");
        var l = await db.Database.SqlQueryRaw<LigneHabilitation>(SqlHabilitations + " WHERE h.hab_type_element = @e AND h.hab_id_element = @i ORDER BY t.tha_ordre, h.hab_obtenue_le DESC NULLS LAST",
            P("e", element), P("i", id)).ToListAsync(ct);
        return l.Select(h => Decrire(h, Aujourdhui)).ToList();
    }

    /// <summary>Remplace les habilitations d'un élément (contrôles du jeu partagé ; erreurs de toutes les lignes).</summary>
    public static async Task EnregistrerHabilitationsAsync(LogiBtpContext db, string element, int id, List<HabilitationSaisie> liste, Utilisateur u, CancellationToken ct)
    {
        if (!Elements.Contains(element)) throw ExceptionMetier.Invalide("ELEMENT", $"Élément inconnu : {element}");
        var table = element == TypesFiche.Salarie ? "SELECT count(*)::int AS \"Value\" FROM salarie WHERE sal_id = @i" : "SELECT count(*)::int AS \"Value\" FROM materiel WHERE mat_id = @i";
        if (await db.Database.SqlQueryRaw<int>(table, P("i", id)).FirstAsync(ct) == 0) throw ExceptionMetier.Introuvable($"{element} {id}");
        var types = await TypesAsync(db, ct);
        var erreurs = liste.Select((h, i) => new { i, codes = ReglesRessources.Controler(new HabilitationEvaluee(h.Code, h.ObtenueLe, h.ValideJusquAu), types, element) })
            .Where(x => x.codes.Count > 0).ToList();
        if (erreurs.Count > 0)
        {
            throw ExceptionMetier.Invalide(erreurs[0].codes[0], string.Join(" · ", erreurs.Select(x => $"ligne {x.i + 1} : {string.Join(", ", x.codes.Select(c => ReglesRessources.Messages[c]))}")),
                erreurs.Select(x => new { index = x.i, codes = x.codes }).ToList());
        }
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var gardes = liste.Where(h => h.Id is not null).Select(h => h.Id!.Value).ToArray();
        await db.Database.ExecuteSqlRawAsync("DELETE FROM habilitation WHERE hab_type_element = @e AND hab_id_element = @i AND NOT (hab_id = ANY(@g))",
            [P("e", element), P("i", id), P("g", gardes)], ct);
        foreach (var h in liste)
        {
            var p = new[]
            {
                P("code", h.Code), P("e", element), P("i", id), P("ob", h.ObtenueLe, NpgsqlDbType.Date), P("fin", h.ValideJusquAu, NpgsqlDbType.Date),
                P("num", h.Numero, NpgsqlDbType.Varchar), P("org", h.Organisme, NpgsqlDbType.Varchar), P("dge", h.DgeId, NpgsqlDbType.Bigint),
                P("com", h.Commentaire, NpgsqlDbType.Text), P("u", u.Code),
            };
            if (h.Id is int hid)
            {
                await db.Database.ExecuteSqlRawAsync("""
                    UPDATE habilitation SET hab_tha_code = @code, hab_obtenue_le = @ob, hab_valide_jusqu_au = @fin, hab_numero = @num, hab_organisme = @org,
                      hab_dge_id = @dge, hab_commentaire = @com, hab_maj_par = @u, hab_maj_le = now()
                    WHERE hab_id = @id AND hab_type_element = @e AND hab_id_element = @i
                    """, [.. p, P("id", hid)], ct);
            }
            else
            {
                await db.Database.ExecuteSqlRawAsync("""
                    INSERT INTO habilitation (hab_tha_code, hab_type_element, hab_id_element, hab_obtenue_le, hab_valide_jusqu_au, hab_numero, hab_organisme, hab_dge_id, hab_commentaire, hab_maj_par)
                    VALUES (@code, @e, @i, @ob, @fin, @num, @org, @dge, @com, @u)
                    """, p, ct);
            }
        }
        await tx.CommitAsync(ct);
    }

    /// <summary>
    /// Habilitations, entretiens et visites à surveiller (expirées ou à renouveler, échéance dans les <paramref name="jours"/> jours), tous
    /// éléments ; la dernière de chaque type et élément seulement (une habilitation renouvelée ne reste pas en alerte).
    /// </summary>
    public static async Task<List<object>> ASurveillerAsync(LogiBtpContext db, string? element, int jours, CancellationToken ct)
    {
        var l = await db.Database.SqlQueryRaw<LigneHabilitation>("SELECT * FROM (" + SqlHabilitations + """
            ) x
            WHERE (@e IS NULL OR x.type_element = @e)
              AND NOT EXISTS (SELECT 1 FROM habilitation y WHERE y.hab_type_element = x.type_element AND y.hab_id_element = x.id_element
                                AND y.hab_tha_code = x.code AND y.hab_id <> x.id AND coalesce(y.hab_obtenue_le, '0001-01-01') > coalesce(x.obtenue_le, '0001-01-01'))
              AND coalesce(x.valide_jusqu_au, (x.obtenue_le + make_interval(months => coalesce(x.duree_mois, 0)))::date) <= current_date + @j
              AND (x.valide_jusqu_au IS NOT NULL OR x.duree_mois IS NOT NULL)
            ORDER BY coalesce(x.valide_jusqu_au, (x.obtenue_le + make_interval(months => coalesce(x.duree_mois, 0)))::date)
            LIMIT 2000
            """, P("e", element, NpgsqlDbType.Varchar), P("j", jours)).ToListAsync(ct);
        return l.Select(h => Decrire(h, Aujourdhui)).ToList();
    }

    private sealed record LigneMission(int Id, long? AgenceId, string? Agence, DateOnly Debut, DateOnly Fin, decimal? TauxHoraire, int? ChantierId, string? Commentaire);

    private const string SqlMissions = """
        SELECT m.mis_id AS id, m.mis_agence_id AS agence_id, coalesce(nullif(p.per_nom_commercial, ''), p.per_raison_sociale) AS agence,
               m.mis_debut AS debut, m.mis_fin AS fin, m.mis_taux_horaire AS taux_horaire, m.mis_chantier_id AS chantier_id, m.mis_commentaire AS commentaire
        FROM mission_interim m LEFT JOIN personne p ON p.per_id = m.mis_agence_id WHERE m.mis_sal_id = @s ORDER BY m.mis_debut
        """;

    public static async Task<List<object>> MissionsAsync(LogiBtpContext db, int salarie, CancellationToken ct)
    {
        var l = await db.Database.SqlQueryRaw<LigneMission>(SqlMissions, P("s", salarie)).ToListAsync(ct);
        var enCours = ReglesRessources.EnCours(l.Select(m => new MissionEvaluee(m.Id, m.Debut, m.Fin, m.AgenceId, m.TauxHoraire)), Aujourdhui);
        return l.Select(m => (object)new
        {
            id = m.Id, agence_id = m.AgenceId, agence = m.Agence, debut = m.Debut, fin = m.Fin, taux_horaire = m.TauxHoraire, chantier_id = m.ChantierId,
            commentaire = m.Commentaire, en_cours = enCours?.Id == m.Id,
        }).ToList();
    }

    /// <summary>Mission en cours d'un salarié (fin de validité proposée pour le compte d'un intérimaire).</summary>
    public static async Task<DateOnly?> FinMissionEnCoursAsync(DbContext db, int salarie, CancellationToken ct)
    {
        var l = await db.Database.SqlQueryRaw<LigneMission>(SqlMissions, P("s", salarie)).ToListAsync(ct);
        return ReglesRessources.EnCours(l.Select(m => new MissionEvaluee(m.Id, m.Debut, m.Fin, m.AgenceId, m.TauxHoraire)), Aujourdhui)?.Fin;
    }

    public static async Task EnregistrerMissionsAsync(LogiBtpContext db, int salarie, List<MissionSaisie> liste, Utilisateur u, CancellationToken ct)
    {
        if (await db.Database.SqlQueryRaw<int>("SELECT count(*)::int AS \"Value\" FROM salarie WHERE sal_id = @s", P("s", salarie)).FirstAsync(ct) == 0)
        {
            throw ExceptionMetier.Introuvable($"Salarié {salarie}");
        }
        var erreurs = ReglesRessources.ControlerMissions(liste.Select(m => new MissionEvaluee(m.Id, m.Debut, m.Fin, m.AgenceId, m.TauxHoraire)).ToList());
        if (erreurs.Count > 0)
        {
            throw ExceptionMetier.Invalide(erreurs[0].Codes[0], string.Join(" · ", erreurs.Select(x => $"mission {x.Index + 1} : {string.Join(", ", x.Codes.Select(c => ReglesRessources.Messages[c]))}")),
                erreurs.Select(x => new { index = x.Index, codes = x.Codes }).ToList());
        }
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var gardes = liste.Where(m => m.Id is not null).Select(m => m.Id!.Value).ToArray();
        await db.Database.ExecuteSqlRawAsync("DELETE FROM mission_interim WHERE mis_sal_id = @s AND NOT (mis_id = ANY(@g))", [P("s", salarie), P("g", gardes)], ct);
        foreach (var m in liste)
        {
            var p = new[]
            {
                P("s", salarie), P("ag", m.AgenceId, NpgsqlDbType.Bigint), P("d", m.Debut, NpgsqlDbType.Date), P("f", m.Fin, NpgsqlDbType.Date),
                P("t", m.TauxHoraire, NpgsqlDbType.Numeric), P("ch", m.ChantierId, NpgsqlDbType.Integer), P("c", m.Commentaire, NpgsqlDbType.Text), P("u", u.Code),
            };
            if (m.Id is int id)
            {
                await db.Database.ExecuteSqlRawAsync("""
                    UPDATE mission_interim SET mis_agence_id = @ag, mis_debut = @d, mis_fin = @f, mis_taux_horaire = @t, mis_chantier_id = @ch, mis_commentaire = @c,
                      mis_maj_par = @u, mis_maj_le = now() WHERE mis_id = @id AND mis_sal_id = @s
                    """, [.. p, P("id", id)], ct);
            }
            else
            {
                await db.Database.ExecuteSqlRawAsync("""
                    INSERT INTO mission_interim (mis_sal_id, mis_agence_id, mis_debut, mis_fin, mis_taux_horaire, mis_chantier_id, mis_commentaire, mis_maj_par)
                    VALUES (@s, @ag, @d, @f, @t, @ch, @c, @u)
                    """, p, ct);
            }
        }
        await tx.CommitAsync(ct);
    }

    private const string SqlTypes = """
        SELECT coalesce(json_agg(json_build_object('code', t.tha_code, 'libelle', t.tha_libelle, 'categorie', t.tha_categorie, 'concerne', t.tha_concerne,
          'duree_mois', t.tha_duree_mois, 'ordre', t.tha_ordre, 'actif', t.tha_actif,
          'nb', (SELECT count(*) FROM habilitation h WHERE h.hab_tha_code = t.tha_code)) ORDER BY t.tha_ordre, t.tha_code), '[]') AS "Value"
        FROM type_habilitation t
        """;

    private const string SqlMotifs = """
        SELECT coalesce(json_agg(json_build_object('id', m.mot_id, 'domaine', m.mot_domaine, 'code', m.mot_code, 'libelle', m.mot_libelle,
          'srv_id', m.mot_srv_id, 'service', s.srv_libelle, 'ordre', m.mot_ordre, 'actif', m.mot_actif) ORDER BY m.mot_domaine, m.mot_ordre, m.mot_code), '[]') AS "Value"
        FROM motif m LEFT JOIN service s ON s.srv_id = m.mot_srv_id WHERE (@d IS NULL OR m.mot_domaine = @d)
        """;

    private const string SqlNatures = """
        SELECT coalesce(json_agg(json_build_object('id', n.nat_id, 'code', n.nat_code, 'libelle', n.nat_libelle, 'srv_id', n.nat_srv_id, 'service', s.srv_libelle, 'actif', n.nat_actif)
          ORDER BY n.nat_code), '[]') AS "Value"
        FROM nature_element n LEFT JOIN service s ON s.srv_id = n.nat_srv_id WHERE n.nat_rgn_code = 'MO'
        """;

    /// <summary>
    /// Échéances des matériels en service (db/230) : fins de location et de garantie passées ou dans les @j jours, la
    /// plus proche d'abord.
    /// </summary>
    private const string SqlEcheancesMateriels = """
        SELECT coalesce(json_agg(json_build_object('id', e.id, 'code', e.code, 'designation', e.designation, 'genre', e.genre, 'date', e.date,
               'tiers', e.tiers) ORDER BY e.date, e.code), '[]') AS "Value"
        FROM (SELECT m.mat_id AS id, m.mat_code AS code, m.mat_designation AS designation, 'LOCATION' AS genre, m.mat_fin_location AS date,
                     (SELECT p.per_raison_sociale FROM personne p WHERE p.per_id = m.mat_loueur_id) AS tiers
              FROM materiel m WHERE m.mat_fin_location IS NOT NULL AND m.mat_usage <> 'S' AND m.mat_date_sortie IS NULL
              UNION ALL
              SELECT m.mat_id, m.mat_code, m.mat_designation, 'GARANTIE', m.mat_fin_garantie, NULL
              FROM materiel m WHERE m.mat_fin_garantie IS NOT NULL AND m.mat_usage <> 'S' AND m.mat_date_sortie IS NULL) e
        WHERE e.date <= current_date + @j
        """;

    /// <summary>Équipes et composition à une date (membres dont la période couvre la date).</summary>
    private const string SqlEquipes = """
        SELECT coalesce(json_agg(json_build_object('id', e.equ_id, 'code', e.equ_code, 'libelle', e.equ_libelle, 'srv_id', e.equ_srv_id, 'actif', e.equ_active,
          'chef_sal_id', e.equ_chef_sal_id,
          'membres', (SELECT coalesce(json_agg(json_build_object('sal_id', c.eqc_sal_id, 'nom', concat_ws(' ', s.sal_prenom, s.sal_nom), 'du', c.eqc_du, 'au', c.eqc_au, 'chef', c.eqc_chef)
                        ORDER BY c.eqc_chef DESC, s.sal_nom), '[]')
                      FROM equipe_composition c JOIN salarie s ON s.sal_id = c.eqc_sal_id
                      WHERE c.eqc_equ_id = e.equ_id AND c.eqc_du <= @d AND (c.eqc_au IS NULL OR c.eqc_au >= @d)))
          ORDER BY e.equ_code), '[]') AS "Value"
        FROM equipe e
        """;

    public static IEndpointRouteBuilder MapRessources(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/ressources");
        g.MapGet("/types-habilitation", (LogiBtpContext db, CancellationToken ct) => db.JsonAsync(SqlTypes, ct));
        g.MapPut("/types-habilitation", async (List<TypeHabilitationSaisi> l, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            await EnregistrerTypesAsync(db, l, Utilisateur.Depuis(http), ct);
            return await db.JsonAsync(SqlTypes, ct);
        });
        g.MapGet("/habilitations", (string? element, int? jours, LogiBtpContext db, CancellationToken ct) => ASurveillerAsync(db, element, jours ?? 60, ct));
        g.MapGet("/habilitations/{element}/{id:int}", (string element, int id, LogiBtpContext db, CancellationToken ct) => HabilitationsAsync(db, element, id, ct));
        g.MapPut("/habilitations/{element}/{id:int}", async (string element, int id, List<HabilitationSaisie> l, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            await EnregistrerHabilitationsAsync(db, element, id, l, Utilisateur.Depuis(http), ct);
            return await HabilitationsAsync(db, element, id, ct);
        });
        g.MapGet("/missions/{salarie:int}", (int salarie, LogiBtpContext db, CancellationToken ct) => MissionsAsync(db, salarie, ct));
        g.MapPut("/missions/{salarie:int}", async (int salarie, List<MissionSaisie> l, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            await EnregistrerMissionsAsync(db, salarie, l, Utilisateur.Depuis(http), ct);
            return await MissionsAsync(db, salarie, ct);
        });
        g.MapGet("/motifs", (string? domaine, LogiBtpContext db, CancellationToken ct) => db.JsonAsync(SqlMotifs, ct, P("d", domaine, NpgsqlDbType.Varchar)));
        g.MapPut("/motifs", async (List<MotifSaisi> l, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            await EnregistrerMotifsAsync(db, l, Utilisateur.Depuis(http), ct);
            return await db.JsonAsync(SqlMotifs, ct, P("d", null, NpgsqlDbType.Varchar));
        });
        g.MapGet("/natures-mo", (LogiBtpContext db, CancellationToken ct) => db.JsonAsync(SqlNatures, ct));
        g.MapGet("/materiels/echeances", (int? jours, LogiBtpContext db, CancellationToken ct) =>
            db.JsonAsync(SqlEcheancesMateriels, ct, P("j", Math.Clamp(jours ?? 60, 0, 3650), NpgsqlDbType.Integer)));
        g.MapPut("/natures-mo", async (List<NatureService> l, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            Admin(Utilisateur.Depuis(http));
            foreach (var n in l)
            {
                await db.Database.ExecuteSqlRawAsync("UPDATE nature_element SET nat_srv_id = @s WHERE nat_id = @n AND nat_rgn_code = 'MO'",
                    [P("s", n.SrvId, NpgsqlDbType.Integer), P("n", n.Id)], ct);
            }
            return await db.JsonAsync(SqlNatures, ct);
        });
        // Habilitations exigées du conducteur d'un matériel (codes de types concernant un salarié).
        g.MapGet("/materiels/{id:int}/exigees", (int id, LogiBtpContext db, CancellationToken ct) =>
            db.JsonAsync("SELECT coalesce((SELECT mat_habilitations::text FROM materiel WHERE mat_id = @i), '[]') AS \"Value\"", ct, P("i", id)));
        g.MapPut("/materiels/{id:int}/exigees", async (int id, List<string> codes, LogiBtpContext db, CancellationToken ct) =>
        {
            var types = await TypesAsync(db, ct);
            var inconnus = codes.Where(c => !types.TryGetValue(c, out var t) || t.Concerne == "MATERIEL").ToList();
            if (inconnus.Count > 0) throw ExceptionMetier.Invalide("HAB_TYPE", $"Habilitations inconnues ou propres aux matériels : {string.Join(", ", inconnus)}");
            await db.Database.ExecuteSqlRawAsync("UPDATE materiel SET mat_habilitations = CAST(@c AS jsonb) WHERE mat_id = @i",
                [P("c", System.Text.Json.JsonSerializer.Serialize(codes.Distinct().Order(StringComparer.Ordinal))), P("i", id)], ct);
            return Results.NoContent();
        });
        g.MapGet("/equipes", (DateOnly? date, LogiBtpContext db, CancellationToken ct) => db.JsonAsync(SqlEquipes, ct, P("d", date ?? DateOnly.FromDateTime(DateTime.Now), NpgsqlDbType.Date)));
        return api;
    }

    /// <summary>Types d'habilitations (administrateur) : un type retiré est supprimé s'il est inutilisé, sinon désactivé.</summary>
    public static async Task EnregistrerTypesAsync(LogiBtpContext db, List<TypeHabilitationSaisi> l, Utilisateur u, CancellationToken ct)
    {
        Admin(u);
        foreach (var t in l)
        {
            if (string.IsNullOrWhiteSpace(t.Code) || string.IsNullOrWhiteSpace(t.Libelle)) throw ExceptionMetier.Invalide("TYPE_HABILITATION", "Code et libellé obligatoires");
            if (!Categories.Contains(t.Categorie) || !Concernes.Contains(t.Concerne)) throw ExceptionMetier.Invalide("TYPE_HABILITATION", $"Catégorie ou élément inconnu ({t.Code})");
            if (t.DureeMois is <= 0) throw ExceptionMetier.Invalide("TYPE_HABILITATION", $"Durée de validité positive ou vide ({t.Code})");
        }
        var codes = l.Select(t => t.Code.Trim().ToUpperInvariant()).ToArray();
        if (codes.Distinct().Count() != codes.Length) throw ExceptionMetier.Invalide("TYPE_HABILITATION", "Codes en double");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlRawAsync("UPDATE type_habilitation t SET tha_actif = FALSE WHERE NOT (tha_code = ANY(@c)) AND EXISTS (SELECT 1 FROM habilitation h WHERE h.hab_tha_code = t.tha_code)", [P("c", codes)], ct);
        await db.Database.ExecuteSqlRawAsync("DELETE FROM type_habilitation t WHERE NOT (tha_code = ANY(@c)) AND NOT EXISTS (SELECT 1 FROM habilitation h WHERE h.hab_tha_code = t.tha_code)", [P("c", codes)], ct);
        foreach (var t in l)
        {
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO type_habilitation (tha_code, tha_libelle, tha_categorie, tha_concerne, tha_duree_mois, tha_ordre, tha_actif)
                VALUES (@c, @l, @cat, @con, @d, @o, @a)
                ON CONFLICT (tha_code) DO UPDATE SET tha_libelle = EXCLUDED.tha_libelle, tha_categorie = EXCLUDED.tha_categorie, tha_concerne = EXCLUDED.tha_concerne,
                  tha_duree_mois = EXCLUDED.tha_duree_mois, tha_ordre = EXCLUDED.tha_ordre, tha_actif = EXCLUDED.tha_actif
                """, [P("c", t.Code.Trim().ToUpperInvariant()), P("l", t.Libelle.Trim()), P("cat", t.Categorie), P("con", t.Concerne),
                    P("d", t.DureeMois, NpgsqlDbType.Integer), P("o", t.Ordre), P("a", t.Actif)], ct);
        }
        await tx.CommitAsync(ct);
    }

    /// <summary>Motifs (administrateur) : liste complète ; un motif retiré est désactivé (il peut être cité par des ordres ou pointages).</summary>
    public static async Task EnregistrerMotifsAsync(LogiBtpContext db, List<MotifSaisi> l, Utilisateur u, CancellationToken ct)
    {
        Admin(u);
        foreach (var m in l)
        {
            if (!Domaines.Contains(m.Domaine) || string.IsNullOrWhiteSpace(m.Code) || string.IsNullOrWhiteSpace(m.Libelle))
            {
                throw ExceptionMetier.Invalide("MOTIF", "Domaine, code et libellé obligatoires");
            }
        }
        if (l.Select(m => (m.Domaine, m.Code.Trim().ToUpperInvariant())).Distinct().Count() != l.Count) throw ExceptionMetier.Invalide("MOTIF", "Codes en double dans un domaine");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var gardes = l.Where(m => m.Id is not null).Select(m => m.Id!.Value).ToArray();
        await db.Database.ExecuteSqlRawAsync("UPDATE motif SET mot_actif = FALSE WHERE NOT (mot_id = ANY(@g))", [P("g", gardes)], ct);
        foreach (var m in l)
        {
            var p = new[] { P("d", m.Domaine), P("c", m.Code.Trim().ToUpperInvariant()), P("l", m.Libelle.Trim()), P("s", m.SrvId, NpgsqlDbType.Integer), P("o", m.Ordre), P("a", m.Actif) };
            if (m.Id is int id)
            {
                await db.Database.ExecuteSqlRawAsync("UPDATE motif SET mot_domaine = @d, mot_code = @c, mot_libelle = @l, mot_srv_id = @s, mot_ordre = @o, mot_actif = @a WHERE mot_id = @id",
                    [.. p, P("id", id)], ct);
            }
            else
            {
                await db.Database.ExecuteSqlRawAsync("""
                    INSERT INTO motif (mot_domaine, mot_code, mot_libelle, mot_srv_id, mot_ordre, mot_actif) VALUES (@d, @c, @l, @s, @o, @a)
                    ON CONFLICT (mot_domaine, mot_code) DO UPDATE SET mot_libelle = EXCLUDED.mot_libelle, mot_srv_id = EXCLUDED.mot_srv_id, mot_ordre = EXCLUDED.mot_ordre, mot_actif = EXCLUDED.mot_actif
                    """, p, ct);
            }
        }
        await tx.CommitAsync(ct);
    }
}
