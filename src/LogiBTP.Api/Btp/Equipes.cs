using System.Globalization;
using LogiBTP.Domaine.Ressources;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Api.Btp;

public sealed record MembreSaisi(string Type, string Id, bool Chef);
public sealed record PeriodeSaisie(DateOnly? Du, string? Commentaire, List<MembreSaisi> Membres);

/// <summary>
/// Équipe saisie. Modification : <c>Version</c> lue, <c>Jeton</c> du verrou détenu, <c>Depuis</c> = début de la plus
/// ancienne composition chargée (les compositions antérieures sont gardées telles quelles ; nul : toutes chargées).
/// </summary>
public sealed record EquipeSaisie(string Code, string Libelle, int? SrvId, bool Actif, string? Commentaire, List<PeriodeSaisie> Periodes,
    int? Version = null, Guid? Jeton = null, DateOnly? Depuis = null);

public sealed record DemandeVerrouEquipe(Guid Jeton);

/// <summary>
/// Équipes du référentiel des ressources (db/204, db/205) : liste, compositions datées par leur début (plus récentes
/// d'abord, par lots), verrou de modification (table verrou_fiche du module Fiche, type « equipe » : battement, expiration
/// au bout de deux minutes), contrôle de version, création et modification. Règles : <see cref="ReglesEquipes"/>
/// (↔ client/src/app/ressources/equipes.js). Droit : administrateur, ou responsable du service de l'équipe.
/// Routes : <c>/api/ressources/equipes/*</c>.
/// </summary>
public static class Equipes
{
    private const string TypeVerrou = "equipe";
    private const int ExpirationVerrou = 120;

    /// <summary>Libellé de chaque membre possible (type, identifiant).</summary>
    private const string SqlMembres = """
        SELECT type, id, libelle FROM v_ressource
        """;

    private const string SqlListe = $$"""
        WITH lib AS ({{SqlMembres}})
        SELECT coalesce(json_agg(json_build_object('id', e.equ_id, 'code', e.equ_code, 'libelle', e.equ_libelle, 'srv_id', e.equ_srv_id, 'service', sv.srv_libelle,
          'actif', e.equ_active, 'commentaire', e.equ_commentaire,
          'chef', (SELECT l.libelle FROM equipe_composition c JOIN lib l ON l.type = c.eqc_type AND l.id = c.eqc_ressource
                   WHERE c.eqc_equ_id = e.equ_id AND c.eqc_chef AND c.eqc_du <= current_date AND (c.eqc_au IS NULL OR c.eqc_au >= current_date) LIMIT 1),
          'effectif', (SELECT count(*) FROM f_membres_equipe(e.equ_id, current_date)),
          'sous_equipes', (SELECT count(DISTINCT c.eqc_ressource) FROM equipe_composition c WHERE c.eqc_equ_id = e.equ_id AND c.eqc_type = 'EQUIPE'),
          'periodes', (SELECT count(*) FROM equipe_periode p WHERE p.eqp_equ_id = e.equ_id))
          ORDER BY e.equ_active DESC, e.equ_code), '[]') AS "Value"
        FROM equipe e LEFT JOIN service sv ON sv.srv_id = e.equ_srv_id
        """;

    public static IEndpointRouteBuilder MapEquipes(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/ressources/equipes");
        g.MapGet("/liste", async (LogiBtpContext db, CancellationToken ct) =>
            Results.Content(await db.Database.SqlQueryRaw<string>(SqlListe).FirstAsync(ct), "application/json"));
        g.MapGet("/{id:int}/composition", (int id, DateOnly? avant, int? nombre, LogiBtpContext db, CancellationToken ct) => CompositionAsync(db, id, avant, nombre ?? 10, ct));
        g.MapPost("/{id:int}/verrou", (int id, DemandeVerrouEquipe d, HttpContext http, LogiBtpContext db, CancellationToken ct) => VerrouillerAsync(db, id, d.Jeton, Utilisateur.Depuis(http), ct));
        g.MapDelete("/{id:int}/verrou", async (int id, Guid jeton, LogiBtpContext db, CancellationToken ct) =>
        {
            await db.Database.ExecuteSqlRawAsync("DELETE FROM verrou_fiche WHERE vef_type = @t AND vef_id = @id AND vef_jeton = @j",
                [new NpgsqlParameter("t", TypeVerrou), new NpgsqlParameter("id", id.ToString(CultureInfo.InvariantCulture)), new NpgsqlParameter("j", jeton)], ct);
            return Results.NoContent();
        });
        g.MapPost("", async (EquipeSaisie s, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
            await CompositionAsync(db, await EnregistrerAsync(db, null, s, Utilisateur.Depuis(http), ct), null, 10, ct));
        g.MapPut("/{id:int}", async (int id, EquipeSaisie s, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
            await CompositionAsync(db, await EnregistrerAsync(db, id, s, Utilisateur.Depuis(http), ct), null, 10, ct));
        return api;
    }

    private sealed record EquipeLue(int Id, string Code, string Libelle, int? SrvId, bool EquActive, string? EquCommentaire, int EquVersion);
    private sealed record PeriodeLue(DateOnly Du, string? Commentaire);
    private sealed record LigneLue(string Type, string Id, DateOnly Du, DateOnly? Au, bool Chef);
    private sealed record LibelleMembre(string Type, string Id, string Libelle);
    private sealed record VerrouLu(string Utilisateur, DateTimeOffset Depuis, bool Moi);
    private sealed record LienEquipe(int Equipe, int SousEquipe);
    private sealed record MembreConnu(string Type, string Id);

    private const string SqlEquipe = """
        SELECT equ_id AS id, equ_code AS code, equ_libelle AS libelle, equ_srv_id AS srv_id, equ_active, equ_commentaire, equ_version FROM equipe WHERE equ_id = @id
        """;

    private static async Task<(List<PeriodeLue> Periodes, List<LigneComposition> Lignes)> LireAsync(LogiBtpContext db, int id, CancellationToken ct)
    {
        var periodes = await db.Database.SqlQueryRaw<PeriodeLue>("SELECT eqp_du AS du, eqp_commentaire AS commentaire FROM equipe_periode WHERE eqp_equ_id = @id ORDER BY eqp_du",
            new NpgsqlParameter("id", id)).ToListAsync(ct);
        var lignes = (await db.Database.SqlQueryRaw<LigneLue>("""
            SELECT eqc_type AS type, eqc_ressource AS id, eqc_du AS du, eqc_au AS au, eqc_chef AS chef FROM equipe_composition WHERE eqc_equ_id = @id
            """, new NpgsqlParameter("id", id)).ToListAsync(ct)).Select(l => new LigneComposition(l.Type, l.Id, l.Du, l.Au, l.Chef)).ToList();
        return (periodes, lignes);
    }

    /// <summary>
    /// Équipe et compositions datées, de la plus récente à la plus ancienne : <paramref name="nombre"/> compositions au
    /// plus, commençant avant <paramref name="avant"/> s'il est donné (historique par lots) ; <c>plus_anciennes</c>.
    /// </summary>
    private static async Task<IResult> CompositionAsync(LogiBtpContext db, int id, DateOnly? avant, int nombre, CancellationToken ct)
    {
        var e = await db.Database.SqlQueryRaw<EquipeLue>(SqlEquipe, new NpgsqlParameter("id", id)).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable($"Équipe {id}");
        var (periodes, lignes) = await LireAsync(db, id, ct);
        var datees = ReglesEquipes.Periodes(lignes, periodes.Select(p => p.Du)).Where(p => avant is null || p.Du < avant).OrderByDescending(p => p.Du).ToList();
        var lot = datees.Take(Math.Clamp(nombre, 1, 100)).ToList();
        var cles = lot.SelectMany(p => p.Membres).Select(m => $"{m.Type}:{m.Id}").Distinct().ToArray();
        var lib = (await db.Database.SqlQueryRaw<LibelleMembre>($"SELECT type, id, libelle FROM ({SqlMembres}) x WHERE type || ':' || id = ANY(@c)",
            new NpgsqlParameter("c", cles)).ToListAsync(ct)).ToDictionary(x => $"{x.Type}:{x.Id}", x => x.Libelle);
        var commentaires = periodes.ToDictionary(p => p.Du, p => p.Commentaire);
        static string? Jour(DateOnly? d) => d?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        return Results.Ok(new
        {
            id = e.Id, code = e.Code, libelle = e.Libelle, srv_id = e.SrvId, actif = e.EquActive, commentaire = e.EquCommentaire, version = e.EquVersion,
            periodes = lot.Select(p => new
            {
                du = Jour(p.Du), au = Jour(p.Au), commentaire = commentaires.GetValueOrDefault(p.Du),
                membres = p.Membres.Select(m => new { type = m.Type, id = m.Id, chef = m.Chef, libelle = lib.GetValueOrDefault($"{m.Type}:{m.Id}") ?? $"{m.Type} {m.Id}" }),
            }),
            plus_anciennes = datees.Count > lot.Count,
        });
    }

    /// <summary>
    /// Prise ou renouvellement (battement) du verrou de modification : pris s'il est libre, expiré, détenu par ce jeton ou
    /// par le même utilisateur ; renvoie aussi la version de l'équipe (la page la compare avec celle qu'elle affiche).
    /// </summary>
    private static async Task<object> VerrouillerAsync(LogiBtpContext db, int id, Guid jeton, Utilisateur u, CancellationToken ct)
    {
        var e = await db.Database.SqlQueryRaw<EquipeLue>(SqlEquipe, new NpgsqlParameter("id", id)).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable($"Équipe {id}");
        await DroitAsync(db, u, e.SrvId is int s ? [s] : [], ct);
        var cle = id.ToString(CultureInfo.InvariantCulture);
        var pris = await db.Database.ExecuteSqlRawAsync($"""
            INSERT INTO verrou_fiche (vef_type, vef_id, vef_utilisateur, vef_jeton, vef_depuis, vef_renouvele)
            VALUES (@t, @id, @u, @j, now(), now())
            ON CONFLICT (vef_type, vef_id) DO UPDATE SET
                vef_utilisateur = EXCLUDED.vef_utilisateur, vef_jeton = EXCLUDED.vef_jeton, vef_renouvele = now(),
                vef_depuis = CASE WHEN verrou_fiche.vef_jeton = EXCLUDED.vef_jeton THEN verrou_fiche.vef_depuis ELSE now() END
            WHERE verrou_fiche.vef_jeton = EXCLUDED.vef_jeton
               OR verrou_fiche.vef_utilisateur = EXCLUDED.vef_utilisateur
               OR verrou_fiche.vef_renouvele < now() - make_interval(secs => @ExpirationVerrou)
            """, [new NpgsqlParameter("ExpirationVerrou", ExpirationVerrou), new NpgsqlParameter("t", TypeVerrou), new NpgsqlParameter("id", cle), new NpgsqlParameter("u", u.Code), new NpgsqlParameter("j", jeton)], ct);
        var v = await db.Database.SqlQueryRaw<VerrouLu>("""
            SELECT vef_utilisateur AS utilisateur, vef_depuis AS depuis, vef_jeton = @j AS moi FROM verrou_fiche WHERE vef_type = @t AND vef_id = @id
            """, new NpgsqlParameter("t", TypeVerrou), new NpgsqlParameter("id", cle), new NpgsqlParameter("j", jeton)).FirstOrDefaultAsync(ct);
        return new { ok = pris > 0, verrou = v is null ? null : new { utilisateur = v.Utilisateur, depuis = v.Depuis, moi = v.Moi }, version = e.EquVersion };
    }

    /// <summary>
    /// Contrôles (règles partagées, ordre avec les compositions non chargées, boucles entre équipes, membres existants,
    /// droit ; modification : verrou détenu et version inchangée), puis équipe, compositions et lignes réécrites ; le verrou
    /// est libéré et la version augmentée.
    /// </summary>
    public static async Task<int> EnregistrerAsync(LogiBtpContext db, int? id, EquipeSaisie s, Utilisateur u, CancellationToken ct)
    {
        var saisies = s.Periodes.Select(p => new PeriodeEquipe(p.Du, p.Membres.Select(m => new MembreEquipe(m.Type, m.Id.Trim(), m.Chef)).ToList())).ToList();
        var erreurs = ReglesEquipes.Controler(id, s.Code, s.Libelle, saisies);
        if (erreurs.Count > 0) throw ExceptionMetier.Invalide(erreurs[0].Code, Message(erreurs[0].Code), erreurs);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var gardees = new List<(PeriodeEquipe Periode, string? Commentaire)>();
        if (id is int e0)
        {   
            string? sSQL = SqlEquipe.Trim() + " FOR UPDATE";
            var lue = await db.Database.SqlQueryRaw<EquipeLue>(sSQL, new NpgsqlParameter("id", e0)).ToListAsync(ct);
            if (lue.Count == 0) throw ExceptionMetier.Introuvable($"Équipe {e0}");
            await DroitAsync(db, u, new[] { s.SrvId, lue[0].SrvId }.OfType<int>().ToArray(), ct);
            var verrou = await db.Database.SqlQueryRaw<bool>($"""
                SELECT EXISTS (SELECT 1 FROM verrou_fiche WHERE vef_type = @t AND vef_id = @id AND vef_jeton = @j AND vef_renouvele >= now() - make_interval(secs => @ExpirationVerrou)) AS "Value"
                """, new NpgsqlParameter("ExpirationVerrou", ExpirationVerrou),new NpgsqlParameter("t", TypeVerrou), new NpgsqlParameter("id", e0.ToString(CultureInfo.InvariantCulture)),
                new NpgsqlParameter("j", NpgsqlDbType.Uuid) { Value = (object?)s.Jeton ?? DBNull.Value }).FirstAsync(ct);
            if (!verrou) throw ExceptionMetier.Conflit("EQU_VERROU", "Le verrou de modification de l'équipe n'est plus détenu : elle est rechargée");
            if (s.Version != lue[0].EquVersion) throw ExceptionMetier.Conflit("EQU_VERSION", "L'équipe a été modifiée par ailleurs : elle est rechargée", new { version = lue[0].EquVersion });
            // Compositions plus anciennes que la plus ancienne chargée : gardées avec leurs membres et commentaires.
            if (s.Depuis is DateOnly depuis)
            {
                var (periodes, lignes) = await LireAsync(db, e0, ct);
                var datees = ReglesEquipes.Periodes(lignes, periodes.Select(p => p.Du));
                gardees = periodes.Where(p => p.Du < depuis).Select(a => (new PeriodeEquipe(a.Du, datees.First(d => d.Du == a.Du).Membres), a.Commentaire)).ToList();
                if (gardees.Count > 0 && saisies.Any(p => p.Du <= gardees.Max(g => g.Periode.Du))) throw ExceptionMetier.Invalide("EQU_ORDRE", Message("EQU_ORDRE"));
            }
        }
        else await DroitAsync(db, u, s.SrvId is int sv ? [sv] : [], ct);
        if (await db.Database.SqlQueryRaw<bool>("SELECT EXISTS (SELECT 1 FROM equipe WHERE upper(equ_code) = upper(@c) AND equ_id <> coalesce(@id, 0)) AS \"Value\"",
                new NpgsqlParameter("c", s.Code.Trim()), new NpgsqlParameter("id", NpgsqlDbType.Integer) { Value = (object?)id ?? DBNull.Value }).FirstAsync(ct))
        {
            throw ExceptionMetier.Conflit("EQU_CODE_PRIS", $"Le code {s.Code.Trim()} est déjà pris par une autre équipe");
        }
        var lignesNouvelles = ReglesEquipes.Lignes(gardees.Select(g => g.Periode).Concat(saisies));
        var connus = (await db.Database.SqlQueryRaw<MembreConnu>($"SELECT type, id FROM ({SqlMembres}) x").ToListAsync(ct)).Select(m => $"{m.Type}:{m.Id}").ToHashSet();
        var inconnu = lignesNouvelles.FirstOrDefault(l => !connus.Contains($"{l.Type}:{l.Id}"));
        if (inconnu is not null) throw ExceptionMetier.Invalide("EQU_MEMBRE", $"Membre inconnu : {inconnu.Type} {inconnu.Id}");
        if (id is int e1)
        {
            var liens = await db.Database.SqlQueryRaw<LienEquipe>("""
                SELECT DISTINCT eqc_equ_id AS equipe, eqc_ressource::int AS sous_equipe FROM equipe_composition WHERE eqc_type = 'EQUIPE' AND eqc_equ_id <> @id
                """, new NpgsqlParameter("id", e1)).ToListAsync(ct);
            var graphe = liens.GroupBy(l => l.Equipe).ToDictionary(g => g.Key, g => g.Select(l => l.SousEquipe).ToHashSet());
            if (lignesNouvelles.Where(l => l.Type == "EQUIPE").Select(l => int.Parse(l.Id, CultureInfo.InvariantCulture)).Distinct()
                .Any(sous => ReglesEquipes.Contient(graphe, sous, e1)))
                throw ExceptionMetier.Invalide("EQU_CYCLE", Message("EQU_CYCLE"));
        }
        var p = new[]
        {
            new NpgsqlParameter("code", s.Code.Trim()), new NpgsqlParameter("lib", s.Libelle.Trim()),
            new NpgsqlParameter("srv", NpgsqlDbType.Integer) { Value = (object?)s.SrvId ?? DBNull.Value }, new NpgsqlParameter("actif", s.Actif),
            new NpgsqlParameter("com", NpgsqlDbType.Text) { Value = string.IsNullOrWhiteSpace(s.Commentaire) ? DBNull.Value : s.Commentaire.Trim() },
            new NpgsqlParameter("id", NpgsqlDbType.Integer) { Value = (object?)id ?? DBNull.Value },
        };
        var equipe = id ?? (await db.Database.SqlQueryRaw<int>("""
            INSERT INTO equipe (equ_code, equ_libelle, equ_srv_id, equ_active, equ_commentaire) VALUES (@code, @lib, @srv, @actif, @com) RETURNING equ_id AS "Value"
            """, p).ToListAsync(ct))[0];
        if (id is not null)
        {
            await db.Database.ExecuteSqlRawAsync("""
                UPDATE equipe SET equ_code = @code, equ_libelle = @lib, equ_srv_id = @srv, equ_active = @actif, equ_commentaire = @com, equ_version = equ_version + 1 WHERE equ_id = @id
                """, p, ct);
        }
        await db.Database.ExecuteSqlRawAsync("DELETE FROM equipe_composition WHERE eqc_equ_id = @e", [new NpgsqlParameter("e", equipe)], ct);
        await db.Database.ExecuteSqlRawAsync("DELETE FROM equipe_periode WHERE eqp_equ_id = @e", [new NpgsqlParameter("e", equipe)], ct);
        foreach (var (du, commentaire) in gardees.Select(g => (g.Periode.Du, g.Commentaire)).Concat(s.Periodes.Select(x => (x.Du, x.Commentaire))))
        {
            await db.Database.ExecuteSqlRawAsync("INSERT INTO equipe_periode (eqp_equ_id, eqp_du, eqp_commentaire) VALUES (@e, @du, @c)",
                [new NpgsqlParameter("e", equipe), new NpgsqlParameter("du", du!.Value),
                    new NpgsqlParameter("c", NpgsqlDbType.Text) { Value = string.IsNullOrWhiteSpace(commentaire) ? DBNull.Value : commentaire.Trim() }], ct);
        }
        foreach (var l in lignesNouvelles)
        {
            int? sal = l.Type is "SALARIE" or "INTERIM" ? int.Parse(l.Id, CultureInfo.InvariantCulture) : null;
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO equipe_composition (eqc_equ_id, eqc_type, eqc_ressource, eqc_sal_id, eqc_du, eqc_au, eqc_chef) VALUES (@e, @t, @r, @s, @du, @au, @chef)
                """, [new NpgsqlParameter("e", equipe), new NpgsqlParameter("t", l.Type), new NpgsqlParameter("r", l.Id),
                    new NpgsqlParameter("s", NpgsqlDbType.Integer) { Value = (object?)sal ?? DBNull.Value }, new NpgsqlParameter("du", l.Du),
                    new NpgsqlParameter("au", NpgsqlDbType.Date) { Value = (object?)l.Au ?? DBNull.Value }, new NpgsqlParameter("chef", l.Chef)], ct);
        }
        // Colonnes résumées de l'équipe (liste des ressources, communications) : chef et effectif du jour ; verrou libéré.
        await db.Database.ExecuteSqlRawAsync("""
            UPDATE equipe e SET
              equ_chef_sal_id = (SELECT c.eqc_sal_id FROM equipe_composition c WHERE c.eqc_equ_id = e.equ_id AND c.eqc_chef AND c.eqc_du <= current_date AND (c.eqc_au IS NULL OR c.eqc_au >= current_date) LIMIT 1),
              equ_chef = coalesce((SELECT s.sal_prenom || ' ' || s.sal_nom FROM equipe_composition c JOIN salarie s ON s.sal_id = c.eqc_sal_id
                                   WHERE c.eqc_equ_id = e.equ_id AND c.eqc_chef AND c.eqc_du <= current_date AND (c.eqc_au IS NULL OR c.eqc_au >= current_date) LIMIT 1), ''),
              equ_effectif = (SELECT count(*) FROM f_membres_equipe(e.equ_id, current_date))
            WHERE e.equ_id = @e
            """, [new NpgsqlParameter("e", equipe)], ct);
        await db.Database.ExecuteSqlRawAsync("DELETE FROM verrou_fiche WHERE vef_type = @t AND vef_id = @id",
            [new NpgsqlParameter("t", TypeVerrou), new NpgsqlParameter("id", equipe.ToString(CultureInfo.InvariantCulture))], ct);
        await tx.CommitAsync(ct);
        return equipe;
    }

    /// <summary>Administrateur, ou responsable (par son compte) d'un des services de l'équipe.</summary>
    private static async Task DroitAsync(LogiBtpContext db, Utilisateur u, int[] services, CancellationToken ct)
    {
        if (u.EstAdmin) return;
        var responsable = await ComptesBtp.EstResponsableAsync(db, u.Code, services, ct);
        if (!responsable) throw ExceptionMetier.AccesRefuse("EQUIPE");
    }

    private static string Message(string code) => code switch
    {
        "EQU_CODE" => "Code de l'équipe obligatoire",
        "EQU_LIBELLE" => "Libellé de l'équipe obligatoire",
        "EQU_PERIODE" => "Date de début de la composition obligatoire",
        "EQU_DATE_DOUBLE" => "Deux compositions commencent le même jour",
        "EQU_TYPE" => "Type de membre inconnu",
        "EQU_DOUBLON" => "Membre présent deux fois dans la composition",
        "EQU_SOI" => "Une équipe ne peut pas se contenir elle-même",
        "EQU_CHEF_TYPE" => "Le chef d'équipe est un salarié ou un intérimaire",
        "EQU_CHEFS" => "Un seul chef d'équipe par composition",
        "EQU_CYCLE" => "Une équipe ne peut pas contenir une équipe qui la contient",
        "EQU_ORDRE" => "Une composition ne peut pas commencer avant une composition plus ancienne non chargée",
        _ => code,
    };
}
