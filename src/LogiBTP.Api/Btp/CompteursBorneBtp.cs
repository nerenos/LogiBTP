using LogiBTP.Pointage.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

public sealed record ReleveBorne(string Jeton, int? Materiel, string? Unite, decimal? Valeur, bool Remise, string? Commentaire);
public sealed record TraitementReleve(bool Accepter, string? Motif);
public sealed record HeureMaterielBorne(int Materiel, int ChaId, int Minutes);
public sealed record HeuresMaterielBorne(string Jeton, DateOnly Date, List<HeureMaterielBorne>? Lignes);

/// <summary>
/// Relevés de compteurs saisis à la borne (plan materiel-suites, lot 3, MO2) : le salarié identifié relève les matériels
/// qui lui sont affectés ce jour (liste rapide) ou tout autre matériel ; un relevé hors affectation est accepté (contrôle
/// de <see cref="CompteursMateriel.ControlerReleveAsync"/> inchangé, source BORNE) mais « à valider au bureau » (db/280) ;
/// traitement par un administrateur ou le responsable du service du salarié : le refus supprime le relevé. Borne d'essai : rien n'est écrit.
/// Heures de matériel (plan terrain-suites, lot 19, TS18 a) : durée sur les matériels affectés du jour, chantier de la
/// journée, dans <c>pointage_materiel</c> source BORNE (db/292), déboursé du chantier comme les heures du terrain.
/// </summary>
public static class CompteursBorneBtp
{
    public const string SourceBorne = "BORNE";

    /// <summary>Un relevé est à valider au bureau quand le matériel n'est pas affecté au salarié ce jour.</summary>
    public static bool AValider(IEnumerable<int> affectesAuJour, int materiel) => !affectesAuJour.Contains(materiel);

    /// <summary>
    /// Heures de matériel pointées à la borne (plan terrain-suites, lot 19, TS18 a) : refus d'une ligne, ou null.
    /// Matériel affecté au salarié ce jour seulement (pas celui d'un autre), chantier de sa journée, durée d'un jour au plus.
    /// </summary>
    public static (string Code, string Message)? RefusHeure(IEnumerable<int> affectesAuJour, IEnumerable<int> chantiersDuJour, HeureMaterielBorne l) =>
        !affectesAuJour.Contains(l.Materiel) ? ("BORNE_MATERIEL", $"Le matériel {l.Materiel} ne vous est pas affecté ce jour")
        : !chantiersDuJour.Contains(l.ChaId) ? ("BORNE_CHANTIER", "Chantier absent des heures de la journée")
        : l.Minutes is <= 0 or > 1440 ? ("BORNE_DUREE", "Durée du matériel invalide")
        : null;

    private sealed record MaterielSql(int Id, string Code, string Designation, string Compteurs, int Heures, int? Kilometres);
    private sealed record AValiderSql(int Id, int Materiel, string Code, string Designation, DateOnly Date, string Unite, decimal Valeur, bool Remise, int? Salarie, string? Nom, string? Commentaire);

    private const string SqlAffectes = """
        SELECT DISTINCT a.maf_mat_id AS "Value" FROM materiel_affectation a
        WHERE a.maf_type = 'SALARIE' AND a.maf_ressource = @s::text AND a.maf_du <= @d AND (a.maf_au IS NULL OR a.maf_au >= @d)
        """;

    private sealed record MaterielHeuresSql(int Id, string Code, string Designation);
    private sealed record PointeSql(int Materiel, int ChaId, int Minutes);

    private const string SqlChantiersDuJour = """
        SELECT DISTINCT poi_cha_id AS "Value" FROM poi_pointage WHERE poi_couche = 'SAISIE' AND poi_sal_id = @s AND poi_date = @d
        """;

    private static Task<List<int>> AffectesAsync(LogiBtpContext db, int salarie, DateOnly jour, CancellationToken ct) =>
        db.Database.SqlQueryRaw<int>(SqlAffectes, new NpgsqlParameter("s", salarie), new NpgsqlParameter("d", jour)).ToListAsync(ct);

    private static async Task<bool> PeutTraiterAsync(LogiBtpContext db, Utilisateur u, int? salarie, CancellationToken ct)
    {
        if (u.EstAdmin) return true;
        if (salarie is null) return false;
        return await db.Database.SqlQueryRaw<bool>($"""
            SELECT EXISTS (SELECT 1 FROM ({ComptesBtp.SqlChefs}) c WHERE c.sal_id = @s AND c.ind_utilisateur = @u) AS "Value"
            """, new NpgsqlParameter("s", salarie), new NpgsqlParameter("u", u.Code)).FirstAsync(ct);
    }

    public static IEndpointRouteBuilder MapCompteursBorne(this IEndpointRouteBuilder api)
    {
        // Borne (publique : X-Borne-Jeton + jeton de saisie du salarié identifié).
        var b = api.MapGroup("/pointage/borne/materiel");
        b.MapGet("", async (string jeton, HttpContext http, LogiBtpContext db, ServiceBorne borne, CancellationToken ct) =>
        {
            var (s, _, _) = await borne.SalarieIdentifieAsync(http, jeton, ct);
            var affectes = await AffectesAsync(db, s, DateOnly.FromDateTime(DateTime.Today), ct);
            var tous = await db.Database.SqlQueryRaw<MaterielSql>("""
                SELECT mat_id AS id, mat_code AS code, mat_designation AS designation, mat_compteurs AS compteurs, mat_heures AS heures, mat_kilometres AS kilometres
                FROM materiel WHERE mat_compteurs <> '' ORDER BY mat_code
                """).ToListAsync(ct);
            return new { affectes = tous.Where(m => affectes.Contains(m.Id)), autres = tous.Where(m => !affectes.Contains(m.Id)) };
        });
        b.MapPost("/releves", async (ReleveBorne x, HttpContext http, LogiBtpContext db, ServiceBorne borne, CancellationToken ct) =>
        {
            var (s, appareil, test) = await borne.SalarieIdentifieAsync(http, x.Jeton, ct);
            if (x.Materiel is not { } mat) throw ExceptionMetier.Invalide("REL_MATERIEL", "Matériel obligatoire");
            if (string.IsNullOrWhiteSpace(x.Unite) || x.Valeur is null) throw ExceptionMetier.Invalide("REL_VALEUR", "Unité et valeur obligatoires");
            var jour = DateOnly.FromDateTime(DateTime.Today);
            var releve = new ReleveSaisi(jour, x.Unite, x.Valeur, x.Remise, x.Commentaire);
            var aValider = AValider(await AffectesAsync(db, s, jour, ct), mat);
            await CompteursMateriel.ControlerReleveAsync(db, mat, releve, null, null, ct);
            if (test) return Results.Ok(new { essai = true, aValider });
            var auteur = await ComptesBtp.AuteurBorneAsync(db, s, appareil, ct);
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO materiel_releve (mre_mat_id, mre_date, mre_unite, mre_valeur, mre_remise, mre_source, mre_commentaire, mre_maj_par, mre_a_valider, mre_sal_id)
                VALUES (@m, @d, @u, @v, @r, 'BORNE', @c, @p, @a, @s)
                """,
                [new NpgsqlParameter("m", mat), new NpgsqlParameter("d", jour), new NpgsqlParameter("u", x.Unite!), new NpgsqlParameter("v", x.Valeur!.Value),
                 new NpgsqlParameter("r", x.Remise), SqlBtp.P("c", x.Commentaire?.Trim()), new NpgsqlParameter("p", auteur.Code),
                 new NpgsqlParameter("a", aValider), new NpgsqlParameter("s", s)], ct);
            return Results.Ok(new { essai = false, aValider });
        });

        // Heures de matériel de la journée (lot 19) : matériels affectés ce jour (compteurs suivis ou non), chantiers pointés, durées déjà saisies.
        b.MapGet("/heures", async (string jeton, DateOnly date, HttpContext http, LogiBtpContext db, ServiceBorne borne, CancellationToken ct) =>
        {
            var (s, _, _) = await borne.SalarieIdentifieAsync(http, jeton, ct);
            var affectes = await AffectesAsync(db, s, date, ct);
            var materiels = await db.Database.SqlQueryRaw<MaterielHeuresSql>("""
                SELECT mat_id AS id, mat_code AS code, mat_designation AS designation FROM materiel WHERE mat_id = ANY(@m) ORDER BY mat_code
                """, new NpgsqlParameter("m", affectes.ToArray())).ToListAsync(ct);
            var chantiers = await db.Database.SqlQueryRaw<int>(SqlChantiersDuJour, new NpgsqlParameter("s", s), new NpgsqlParameter("d", date)).ToListAsync(ct);
            var pointes = await db.Database.SqlQueryRaw<PointeSql>("""
                SELECT pma_mat_id AS materiel, pma_cha_id AS cha_id, pma_minutes AS minutes FROM pointage_materiel
                WHERE pma_source = 'BORNE' AND pma_sal_id = @s AND pma_date = @d AND pma_cha_id IS NOT NULL ORDER BY pma_id
                """, new NpgsqlParameter("s", s), new NpgsqlParameter("d", date)).ToListAsync(ct);
            return new { materiels, chantiers, pointes };
        });
        // Remplace les heures de matériel de la borne du salarié pour ce jour (source BORNE, sans tâche). Borne d'essai : rien n'est écrit.
        b.MapPut("/heures", async (HeuresMaterielBorne x, HttpContext http, LogiBtpContext db, ServiceBorne borne, CancellationToken ct) =>
        {
            var (s, appareil, test) = await borne.SalarieIdentifieAsync(http, x.Jeton, ct);
            if (x.Date > DateOnly.FromDateTime(DateTime.Today)) throw ExceptionMetier.Invalide("BORNE_DATE", "Pointage d'un jour à venir");
            var lignes = x.Lignes ?? [];
            var affectes = await AffectesAsync(db, s, x.Date, ct);
            var chantiers = test ? lignes.Select(l => l.ChaId).ToList()
                : await db.Database.SqlQueryRaw<int>(SqlChantiersDuJour, new NpgsqlParameter("s", s), new NpgsqlParameter("d", x.Date)).ToListAsync(ct);
            foreach (var l in lignes)
                if (RefusHeure(affectes, chantiers, l) is { } refus) throw ExceptionMetier.Invalide(refus.Code, refus.Message);
            if (test) return Results.Ok(new { essai = true });
            var auteur = await ComptesBtp.AuteurBorneAsync(db, s, appareil, ct);
            await using var tr = await db.Database.BeginTransactionAsync(ct);
            await db.Database.ExecuteSqlRawAsync("DELETE FROM pointage_materiel WHERE pma_source = 'BORNE' AND pma_sal_id = @s AND pma_date = @d",
                [new NpgsqlParameter("s", s), new NpgsqlParameter("d", x.Date)], ct);
            foreach (var l in lignes)
                await db.Database.ExecuteSqlRawAsync("""
                    INSERT INTO pointage_materiel (pma_mat_id, pma_cha_id, pma_sal_id, pma_date, pma_minutes, pma_par, pma_source)
                    VALUES (@m, @c, @s, @d, @n, @u, 'BORNE')
                    """, [new NpgsqlParameter("m", l.Materiel), new NpgsqlParameter("c", l.ChaId), new NpgsqlParameter("s", s),
                        new NpgsqlParameter("d", x.Date), new NpgsqlParameter("n", l.Minutes), new NpgsqlParameter("u", auteur.Code)], ct);
            await tr.CommitAsync(ct);
            return Results.Ok(new { essai = false });
        });

        // Relevés de la borne à valider (droits de l'écran Ressources) : ceux que l'utilisateur peut traiter.
        var g = api.MapGroup("/ressources/materiels/releves-a-valider");
        g.MapGet("", async (HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var l = await db.Database.SqlQueryRaw<AValiderSql>("""
                SELECT r.mre_id AS id, r.mre_mat_id AS materiel, m.mat_code AS code, m.mat_designation AS designation, r.mre_date AS date, r.mre_unite AS unite,
                       r.mre_valeur AS valeur, r.mre_remise AS remise, r.mre_sal_id AS salarie, s.sal_nom || ' ' || s.sal_prenom AS nom, r.mre_commentaire AS commentaire
                FROM materiel_releve r JOIN materiel m ON m.mat_id = r.mre_mat_id LEFT JOIN salarie s ON s.sal_id = r.mre_sal_id
                WHERE r.mre_a_valider ORDER BY r.mre_date, r.mre_id
                """).ToListAsync(ct);
            var r = new List<AValiderSql>();
            foreach (var x in l) if (await PeutTraiterAsync(db, u, x.Salarie, ct)) r.Add(x);
            return r;
        });
        g.MapPost("/{id:int}", async (int id, TraitementReleve t, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var salarie = await db.Database.SqlQueryRaw<int?>("SELECT mre_sal_id AS \"Value\" FROM materiel_releve WHERE mre_id = @i AND mre_a_valider", new NpgsqlParameter("i", id)).ToListAsync(ct);
            if (salarie.Count == 0) throw ExceptionMetier.Introuvable("Relevé à valider");
            if (!await PeutTraiterAsync(db, u, salarie[0], ct)) throw ExceptionMetier.AccesRefuse("VALIDER_RELEVE_BORNE");
            if (!t.Accepter && string.IsNullOrWhiteSpace(t.Motif)) throw ExceptionMetier.Invalide("REL_MOTIF", "Motif obligatoire pour refuser un relevé");
            if (t.Accepter)
                await db.Database.ExecuteSqlRawAsync("UPDATE materiel_releve SET mre_a_valider = FALSE, mre_traite_par = @u, mre_traite_le = now() WHERE mre_id = @i",
                    [new NpgsqlParameter("u", u.Code), new NpgsqlParameter("i", id)], ct);
            else
                await db.Database.ExecuteSqlRawAsync("DELETE FROM materiel_releve WHERE mre_id = @i AND mre_a_valider", [new NpgsqlParameter("i", id)], ct);
            return Results.NoContent();
        });
        return api;
    }
}
