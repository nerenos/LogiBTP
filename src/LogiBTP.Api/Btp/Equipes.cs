using System.Globalization;
using LogiBTP.Domaine.Ressources;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Api.Btp;

public sealed record MembreSaisi(string Type, string Id, bool Chef);
public sealed record PeriodeSaisie(DateOnly? Du, DateOnly? Au, List<MembreSaisi> Membres);
public sealed record EquipeSaisie(string Code, string Libelle, int? SrvId, bool Actif, List<PeriodeSaisie> Periodes);

/// <summary>
/// Équipes du référentiel des ressources (db/204) : liste, composition par périodes souples (membres de tout type,
/// sous-équipes en renfort, chef par période), création et modification. Règles : <see cref="ReglesEquipes"/>
/// (↔ client/src/app/ressources/equipes.js). Droit : administrateur, ou responsable du service de l'équipe (avant ou
/// après la modification). Routes : <c>/api/ressources/equipes/*</c>.
/// </summary>
public static class Equipes
{
    /// <summary>Libellé de chaque membre possible (type, identifiant).</summary>
    private const string SqlMembres = """
        SELECT CASE WHEN s.sal_statut = 'INTERIM' THEN 'INTERIM' ELSE 'SALARIE' END AS type, s.sal_id::text AS id, s.sal_nom || ' ' || s.sal_prenom AS libelle FROM salarie s
        UNION ALL SELECT 'MATERIEL', m.mat_id::text, m.mat_code || ' ' || m.mat_designation FROM materiel m
        UNION ALL SELECT 'SOUS_TRAITANT', t.sst_id::text, t.sst_raison || ' (' || t.sst_metier || ')' FROM demo_sous_traitant t
        UNION ALL SELECT 'EQUIPE', e.equ_id::text, e.equ_libelle FROM equipe e
        """;

    private const string SqlListe = $$"""
        WITH lib AS ({{SqlMembres}})
        SELECT coalesce(json_agg(json_build_object('id', e.equ_id, 'code', e.equ_code, 'libelle', e.equ_libelle, 'srv_id', e.equ_srv_id, 'service', sv.srv_libelle,
          'actif', e.equ_active,
          'chef', (SELECT l.libelle FROM equipe_composition c JOIN lib l ON l.type = c.eqc_type AND l.id = c.eqc_ressource
                   WHERE c.eqc_equ_id = e.equ_id AND c.eqc_chef AND c.eqc_du <= current_date AND (c.eqc_au IS NULL OR c.eqc_au >= current_date) LIMIT 1),
          'effectif', (SELECT count(*) FROM f_membres_equipe(e.equ_id, current_date)),
          'sous_equipes', (SELECT count(DISTINCT c.eqc_ressource) FROM equipe_composition c WHERE c.eqc_equ_id = e.equ_id AND c.eqc_type = 'EQUIPE'),
          'periodes', (SELECT count(DISTINCT c.eqc_du) FROM equipe_composition c WHERE c.eqc_equ_id = e.equ_id))
          ORDER BY e.equ_active DESC, e.equ_code), '[]') AS "Value"
        FROM equipe e LEFT JOIN service sv ON sv.srv_id = e.equ_srv_id
        """;

    private const string SqlComposition = $$"""
        WITH lib AS ({{SqlMembres}})
        SELECT json_build_object('id', e.equ_id, 'code', e.equ_code, 'libelle', e.equ_libelle, 'srv_id', e.equ_srv_id, 'actif', e.equ_active,
          'lignes', (SELECT coalesce(json_agg(json_build_object('type', c.eqc_type, 'id', c.eqc_ressource, 'du', c.eqc_du, 'au', c.eqc_au, 'chef', c.eqc_chef,
                       'libelle', coalesce(l.libelle, c.eqc_type || ' ' || c.eqc_ressource)) ORDER BY c.eqc_du, c.eqc_type, c.eqc_ressource), '[]')
                     FROM equipe_composition c LEFT JOIN lib l ON l.type = c.eqc_type AND l.id = c.eqc_ressource WHERE c.eqc_equ_id = e.equ_id))::text AS "Value"
        FROM equipe e WHERE e.equ_id = @id
        """;

    public static IEndpointRouteBuilder MapEquipes(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/ressources/equipes");
        g.MapGet("/liste", async (LogiBtpContext db, CancellationToken ct) =>
            Results.Content(await db.Database.SqlQueryRaw<string>(SqlListe).FirstAsync(ct), "application/json"));
        g.MapGet("/{id:int}/composition", (int id, LogiBtpContext db, CancellationToken ct) => CompositionAsync(db, id, ct));
        g.MapPost("", async (EquipeSaisie s, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
            await CompositionAsync(db, await EnregistrerAsync(db, null, s, Utilisateur.Depuis(http), ct), ct));
        g.MapPut("/{id:int}", async (int id, EquipeSaisie s, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
            await CompositionAsync(db, await EnregistrerAsync(db, id, s, Utilisateur.Depuis(http), ct), ct));
        return api;
    }

    private static async Task<IResult> CompositionAsync(LogiBtpContext db, int id, CancellationToken ct) =>
        Results.Content(await db.Database.SqlQueryRaw<string>(SqlComposition, new NpgsqlParameter("id", id)).FirstOrDefaultAsync(ct)
            ?? throw ExceptionMetier.Introuvable($"Équipe {id}"), "application/json");

    private sealed record LienEquipe(int Equipe, int SousEquipe);

    /// <summary>Contrôle (règles partagées, boucles entre équipes, membres existants, droit), puis équipe et lignes de composition réécrites.</summary>
    public static async Task<int> EnregistrerAsync(LogiBtpContext db, int? id, EquipeSaisie s, Utilisateur u, CancellationToken ct)
    {
        var periodes = s.Periodes.Select(p => new PeriodeEquipe(p.Du, p.Au, p.Membres.Select(m => new MembreEquipe(m.Type, m.Id.Trim(), m.Chef)).ToList())).ToList();
        var erreurs = ReglesEquipes.Controler(id, s.Code, s.Libelle, periodes);
        if (erreurs.Count > 0) throw ExceptionMetier.Invalide(erreurs[0].Code, Message(erreurs[0].Code), erreurs);
        var avant = id is int x ? await db.Database.SqlQueryRaw<int?>("SELECT equ_srv_id AS \"Value\" FROM equipe WHERE equ_id = @id", new NpgsqlParameter("id", x)).FirstOrDefaultAsync(ct) : null;
        if (id is int e0 && !await db.Database.SqlQueryRaw<bool>("SELECT EXISTS (SELECT 1 FROM equipe WHERE equ_id = @id) AS \"Value\"", new NpgsqlParameter("id", e0)).FirstAsync(ct))
        {
            throw ExceptionMetier.Introuvable($"Équipe {e0}");
        }
        await DroitAsync(db, u, new[] { s.SrvId, avant }.OfType<int>().ToArray(), ct);
        if (await db.Database.SqlQueryRaw<bool>("SELECT EXISTS (SELECT 1 FROM equipe WHERE upper(equ_code) = upper(@c) AND equ_id <> coalesce(@id, 0)) AS \"Value\"",
                new NpgsqlParameter("c", s.Code.Trim()), new NpgsqlParameter("id", NpgsqlDbType.Integer) { Value = (object?)id ?? DBNull.Value }).FirstAsync(ct))
        {
            throw ExceptionMetier.Conflit("EQU_CODE_PRIS", $"Le code {s.Code.Trim()} est déjà pris par une autre équipe");
        }
        var lignes = ReglesEquipes.Lignes(periodes);
        // Membres existants (type et identifiant connus).
        var connus = (await db.Database.SqlQueryRaw<MembreConnu>($"SELECT type, id FROM ({SqlMembres}) x").ToListAsync(ct)).Select(m => $"{m.Type}:{m.Id}").ToHashSet();
        var inconnu = lignes.FirstOrDefault(l => !connus.Contains($"{l.Type}:{l.Id}"));
        if (inconnu is not null) throw ExceptionMetier.Invalide("EQU_MEMBRE", $"Membre inconnu : {inconnu.Type} {inconnu.Id}");
        // Boucles : une sous-équipe ne contient pas (même indirectement) l'équipe enregistrée.
        if (id is int e1)
        {
            var liens = await db.Database.SqlQueryRaw<LienEquipe>("""
                SELECT DISTINCT eqc_equ_id AS equipe, eqc_ressource::int AS sous_equipe FROM equipe_composition WHERE eqc_type = 'EQUIPE' AND eqc_equ_id <> @id
                """, new NpgsqlParameter("id", e1)).ToListAsync(ct);
            var graphe = liens.GroupBy(l => l.Equipe).ToDictionary(g => g.Key, g => g.Select(l => l.SousEquipe).ToHashSet());
            foreach (var sous in lignes.Where(l => l.Type == "EQUIPE").Select(l => int.Parse(l.Id, CultureInfo.InvariantCulture)).Distinct())
            {
                if (ReglesEquipes.Contient(graphe, sous, e1)) throw ExceptionMetier.Invalide("EQU_CYCLE", Message("EQU_CYCLE"));
            }
        }
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var p = new[]
        {
            new NpgsqlParameter("code", s.Code.Trim()), new NpgsqlParameter("lib", s.Libelle.Trim()),
            new NpgsqlParameter("srv", NpgsqlDbType.Integer) { Value = (object?)s.SrvId ?? DBNull.Value }, new NpgsqlParameter("actif", s.Actif),
            new NpgsqlParameter("id", NpgsqlDbType.Integer) { Value = (object?)id ?? DBNull.Value },
        };
        var equipe = id ?? (await db.Database.SqlQueryRaw<int>("""
            INSERT INTO equipe (equ_code, equ_libelle, equ_srv_id, equ_active) VALUES (@code, @lib, @srv, @actif) RETURNING equ_id AS "Value"
            """, p).ToListAsync(ct))[0];
        if (id is not null)
        {
            await db.Database.ExecuteSqlRawAsync("UPDATE equipe SET equ_code = @code, equ_libelle = @lib, equ_srv_id = @srv, equ_active = @actif WHERE equ_id = @id", p, ct);
        }
        await db.Database.ExecuteSqlRawAsync("DELETE FROM equipe_composition WHERE eqc_equ_id = @e", [new NpgsqlParameter("e", equipe)], ct);
        foreach (var l in lignes)
        {
            int? sal = l.Type is "SALARIE" or "INTERIM" ? int.Parse(l.Id, CultureInfo.InvariantCulture) : null;
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO equipe_composition (eqc_equ_id, eqc_type, eqc_ressource, eqc_sal_id, eqc_du, eqc_au, eqc_chef) VALUES (@e, @t, @r, @s, @du, @au, @chef)
                """, [new NpgsqlParameter("e", equipe), new NpgsqlParameter("t", l.Type), new NpgsqlParameter("r", l.Id),
                    new NpgsqlParameter("s", NpgsqlDbType.Integer) { Value = (object?)sal ?? DBNull.Value }, new NpgsqlParameter("du", l.Du),
                    new NpgsqlParameter("au", NpgsqlDbType.Date) { Value = (object?)l.Au ?? DBNull.Value }, new NpgsqlParameter("chef", l.Chef)], ct);
        }
        // Colonnes résumées de l'équipe (liste des ressources, communications) : chef et effectif du jour.
        await db.Database.ExecuteSqlRawAsync("""
            UPDATE equipe e SET
              equ_chef_sal_id = (SELECT c.eqc_sal_id FROM equipe_composition c WHERE c.eqc_equ_id = e.equ_id AND c.eqc_chef AND c.eqc_du <= current_date AND (c.eqc_au IS NULL OR c.eqc_au >= current_date) LIMIT 1),
              equ_chef = coalesce((SELECT s.sal_prenom || ' ' || s.sal_nom FROM equipe_composition c JOIN salarie s ON s.sal_id = c.eqc_sal_id
                                   WHERE c.eqc_equ_id = e.equ_id AND c.eqc_chef AND c.eqc_du <= current_date AND (c.eqc_au IS NULL OR c.eqc_au >= current_date) LIMIT 1), ''),
              equ_effectif = (SELECT count(*) FROM f_membres_equipe(e.equ_id, current_date))
            WHERE e.equ_id = @e
            """, [new NpgsqlParameter("e", equipe)], ct);
        await tx.CommitAsync(ct);
        return equipe;
    }

    private sealed record MembreConnu(string Type, string Id);

    /// <summary>Administrateur, ou responsable (par son compte) d'un des services de l'équipe.</summary>
    private static async Task DroitAsync(LogiBtpContext db, Utilisateur u, int[] services, CancellationToken ct)
    {
        if (u.EstAdmin) return;
        var responsable = services.Length > 0 && await db.Database.SqlQueryRaw<bool>("""
            SELECT EXISTS (SELECT 1 FROM service s JOIN individu i ON i.ind_id = s.srv_responsable_id WHERE i.ind_utilisateur = @u AND s.srv_id = ANY(@s)) AS "Value"
            """, new NpgsqlParameter("u", u.Code), new NpgsqlParameter("s", services)).FirstAsync(ct);
        if (!responsable) throw ExceptionMetier.AccesRefuse("EQUIPE");
    }

    private static string Message(string code) => code switch
    {
        "EQU_CODE" => "Code de l'équipe obligatoire",
        "EQU_LIBELLE" => "Libellé de l'équipe obligatoire",
        "EQU_PERIODE" => "Période : début obligatoire, fin après le début",
        "EQU_CHEVAUCHEMENT" => "Les périodes se chevauchent",
        "EQU_TYPE" => "Type de membre inconnu",
        "EQU_DOUBLON" => "Membre présent deux fois dans la période",
        "EQU_SOI" => "Une équipe ne peut pas se contenir elle-même",
        "EQU_CHEF_TYPE" => "Le chef d'équipe est un salarié ou un intérimaire",
        "EQU_CHEFS" => "Un seul chef d'équipe par période",
        "EQU_CYCLE" => "Une équipe ne peut pas contenir une équipe qui la contient",
        _ => code,
    };
}
