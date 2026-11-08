using LogiBTP.Pointage.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

public sealed record ReleveBorne(string Jeton, int? Materiel, string? Unite, decimal? Valeur, bool Remise, string? Commentaire);
public sealed record TraitementReleve(bool Accepter, string? Motif);

/// <summary>
/// Relevés de compteurs saisis à la borne (plan materiel-suites, lot 3, MO2) : le salarié identifié relève les matériels
/// qui lui sont affectés ce jour (liste rapide) ou tout autre matériel ; un relevé hors affectation est accepté (contrôle
/// de <see cref="CompteursMateriel.ControlerReleveAsync"/> inchangé, source BORNE) mais « à valider au bureau » (db/280) ;
/// traitement par un administrateur ou le responsable du service du salarié : le refus supprime le relevé. Borne d'essai : rien n'est écrit.
/// </summary>
public static class CompteursBorneBtp
{
    public const string SourceBorne = "BORNE";

    /// <summary>Un relevé est à valider au bureau quand le matériel n'est pas affecté au salarié ce jour.</summary>
    public static bool AValider(IEnumerable<int> affectesAuJour, int materiel) => !affectesAuJour.Contains(materiel);

    private sealed record MaterielSql(int Id, string Code, string Designation, string Compteurs, int Heures, int? Kilometres);
    private sealed record AValiderSql(int Id, int Materiel, string Code, string Designation, DateOnly Date, string Unite, decimal Valeur, bool Remise, int? Salarie, string? Nom, string? Commentaire);

    private const string SqlAffectes = """
        SELECT DISTINCT a.maf_mat_id AS "Value" FROM materiel_affectation a
        WHERE a.maf_type = 'SALARIE' AND a.maf_ressource = @s::text AND a.maf_du <= @d AND (a.maf_au IS NULL OR a.maf_au >= @d)
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
