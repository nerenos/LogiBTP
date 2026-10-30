using LogiBTP.Domaine;
using LogiBTP.Execution.Web;
using LogiBTP.Pointage.Web;
using LogiBTP.Socle.Web;
using LogiBTP.Socle;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Module Exécution, lot 2e (ANALYSE-MODULE-EXECUTION.md E50 à E53) : étapes validées depuis l'atelier. Ordres
/// proposés à un salarié (E51) : ordres non terminés à étape non validée dont il est la ressource principale (lui ou une
/// de ses équipes, sur l'ordre ou une étape), ou ordres de son service (ou du service parent) sur ses chantiers du jour
/// (tâches du planning) ; un ordre se cherche aussi par son numéro. Validation par la même règle que E46 appliquée au
/// salarié ; jamais de contrôle du N+1 depuis l'atelier. Routes : page tablette <c>/api/execution/atelier</c> (session) et
/// borne <c>/api/pointage/borne/etapes</c> (publique : jeton d'appareil et jeton de saisie ; essai : rien n'est écrit).
/// </summary>
public static class AtelierBtp
{
    internal sealed record OrdreAtelier(long EntId, string? Numero, string? Objet, string? Chantier);
    public sealed record ValidationAtelier(long EntId, string Code);
    public sealed record ValidationBorne(string Jeton, long EntId, string Code);

    /// <summary>Ordre lisible par le salarié (ressource, équipe, membre du service ou du service parent, responsable).</summary>
    private const string Droit = """
        (coalesce(d.ent_ressource ->> 'type', '') = 'SALARIE' AND d.ent_ressource ->> 'id' = @s::text
         OR EXISTS (SELECT 1 FROM exe_ordre_etape x WHERE x.ore_ordre_id = d.ent_id AND x.ore_ressource ->> 'type' = 'SALARIE' AND x.ore_ressource ->> 'id' = @s::text)
         OR EXISTS (SELECT 1 FROM exe_ordre_etape x
                    CROSS JOIN LATERAL f_membres_equipe((coalesce(x.ore_ressource, d.ent_ressource) ->> 'id')::int, current_date) m
                    WHERE x.ore_ordre_id = d.ent_id AND coalesce(x.ore_ressource, d.ent_ressource) ->> 'type' = 'EQUIPE'
                      AND m.type IN ('SALARIE', 'INTERIM') AND m.ressource = @s::text)
         OR EXISTS (SELECT 1 FROM salarie sa JOIN service_membre sm ON sm.sme_ind_id = sa.sal_ind_id JOIN service sv ON sv.srv_id = d.ent_srv_id
                    WHERE sa.sal_id = @s AND sm.sme_srv_id IN (sv.srv_id, sv.srv_parent_id))
         OR EXISTS (SELECT 1 FROM salarie sa WHERE sa.sal_id = @s AND sa.sal_ind_id = d.ent_responsable_id))
        """;

    private const string Ouverts = """
        FROM v_ordres_ouverts o JOIN document d ON d.ent_id = o.ent_id LEFT JOIN chantier c ON c.cha_id = d.ent_chantier_id
        WHERE TRUE
        """;

    /// <summary>Ordres proposés au salarié (E51), ou l'ordre de ce numéro s'il en a le droit.</summary>
    internal static Task<List<OrdreAtelier>> OrdresAsync(LogiBtpContext db, int salarie, string? numero, CancellationToken ct) =>
        db.Database.SqlQueryRaw<OrdreAtelier>(numero is null
            ? $"""
                SELECT d.ent_id, d.ent_numero AS numero, d.ent_objet AS objet, c.cha_code || ' – ' || c.cha_libelle AS chantier
                {Ouverts}
                  AND EXISTS (SELECT 1 FROM exe_ordre_etape x WHERE x.ore_ordre_id = d.ent_id AND x.ore_valide_le IS NULL)
                  AND ((coalesce(d.ent_ressource ->> 'type', '') = 'SALARIE' AND d.ent_ressource ->> 'id' = @s::text)
                    OR EXISTS (SELECT 1 FROM exe_ordre_etape x WHERE x.ore_ordre_id = d.ent_id AND x.ore_valide_le IS NULL
                               AND x.ore_ressource ->> 'type' = 'SALARIE' AND x.ore_ressource ->> 'id' = @s::text)
                    OR EXISTS (SELECT 1 FROM exe_ordre_etape x
                               CROSS JOIN LATERAL f_membres_equipe((coalesce(x.ore_ressource, d.ent_ressource) ->> 'id')::int, current_date) m
                               WHERE x.ore_ordre_id = d.ent_id AND x.ore_valide_le IS NULL AND coalesce(x.ore_ressource, d.ent_ressource) ->> 'type' = 'EQUIPE'
                                 AND m.type IN ('SALARIE', 'INTERIM') AND m.ressource = @s::text)
                    OR (EXISTS (SELECT 1 FROM salarie sa JOIN service_membre sm ON sm.sme_ind_id = sa.sal_ind_id JOIN service sv ON sv.srv_id = d.ent_srv_id
                                WHERE sa.sal_id = @s AND sm.sme_srv_id IN (sv.srv_id, sv.srv_parent_id))
                        AND d.ent_chantier_id IN ({LiaisonsBtp.SqlChantiersDuJour("current_date")})))
                ORDER BY d.ent_fin_prevue NULLS LAST, d.ent_id
                LIMIT 50
                """
            : $"""
                SELECT d.ent_id, d.ent_numero AS numero, d.ent_objet AS objet, c.cha_code || ' – ' || c.cha_libelle AS chantier
                {Ouverts}
                  AND upper(d.ent_numero) = upper(@n) AND {Droit}
                """,
            new NpgsqlParameter("s", salarie), new NpgsqlParameter("n", (object?)numero ?? DBNull.Value)).ToListAsync(ct);

    /// <summary>Ordres ouverts de ces identifiants que le salarié peut lire (étape proposée après un pointage, E52).</summary>
    internal static Task<List<OrdreAtelier>> OrdresParIdsAsync(LogiBtpContext db, int salarie, long[] ids, CancellationToken ct) =>
        db.Database.SqlQueryRaw<OrdreAtelier>($"""
            SELECT d.ent_id, d.ent_numero AS numero, d.ent_objet AS objet, c.cha_code || ' – ' || c.cha_libelle AS chantier
            {Ouverts}
              AND d.ent_id = ANY(@ids) AND {Droit}
            """, new NpgsqlParameter("s", salarie), new NpgsqlParameter("ids", ids)).ToListAsync(ct);

    internal static async Task<bool> PeutAsync(LogiBtpContext db, int salarie, long ent, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<bool>($"SELECT EXISTS (SELECT 1 {Ouverts} AND d.ent_id = @e AND {Droit}) AS \"Value\"",
            new NpgsqlParameter("s", salarie), new NpgsqlParameter("e", ent)).FirstAsync(ct);

    internal static async Task<object> ReponseAsync(ServiceEtapes etapes, List<OrdreAtelier> ordres, CancellationToken ct)
    {
        var res = new List<object>();
        foreach (var o in ordres)
        {
            if (await etapes.AtelierAsync(o.EntId, ct) is not { } e) continue;
            var j = System.Text.Json.JsonSerializer.SerializeToNode(e, System.Text.Json.JsonSerializerOptions.Web)!.AsObject();
            j["ent_id"] = o.EntId;
            j["numero"] = o.Numero;
            j["objet"] = o.Objet;
            j["chantier"] = o.Chantier;
            res.Add(j);
        }
        return new { ordres = res };
    }

    /// <summary>Salarié du compte connecté (individu du compte), sinon refus.</summary>
    private static async Task<int> SalarieAsync(LogiBtpContext db, Utilisateur u, CancellationToken ct) =>
        await ComptesBtp.SalarieAsync(db, u.Code, ct)
        ?? throw ExceptionMetier.Invalide("ATELIER_SALARIE", "Votre compte n'est lié à aucun salarié : l'écran de l'atelier propose les étapes d'un salarié");

    public static RouteGroupBuilder MapAtelier(this RouteGroupBuilder api)
    {
        // Page tablette (session ordinaire).
        var g = api.MapGroup("/execution/atelier");
        g.MapGet("", async (string? numero, HttpContext http, LogiBtpContext db, ServiceEtapes etapes, CancellationToken ct) =>
        {
            var s = await SalarieAsync(db, Utilisateur.Depuis(http), ct);
            return await ReponseAsync(etapes, await OrdresAsync(db, s, string.IsNullOrWhiteSpace(numero) ? null : numero.Trim(), ct), ct);
        });
        g.MapPost("/valider", async (ValidationAtelier v, HttpContext http, ServiceEtapes etapes, CancellationToken ct) =>
            await etapes.ActionAsync(v.EntId, v.Code, new ActionEtape("VALIDER"), Utilisateur.Depuis(http), ct));

        // Borne (publique : X-Borne-Jeton + jeton de saisie du salarié identifié).
        var b = api.MapGroup("/pointage/borne/etapes");
        b.MapGet("", async (string jeton, string? numero, long? ordre, HttpContext http, LogiBtpContext db, ServiceBorne borne, ServiceEtapes etapes, CancellationToken ct) =>
        {
            var (s, _, _) = await borne.SalarieIdentifieAsync(http, jeton, ct);
            var ordres = await OrdresAsync(db, s, string.IsNullOrWhiteSpace(numero) ? null : numero.Trim(), ct);
            if (ordre is long id)
            {
                ordres = await PeutAsync(db, s, id, ct)
                    ? await db.Database.SqlQueryRaw<OrdreAtelier>($"SELECT d.ent_id, d.ent_numero AS numero, d.ent_objet AS objet, c.cha_code || ' – ' || c.cha_libelle AS chantier {Ouverts} AND d.ent_id = @e",
                        new NpgsqlParameter("e", id)).ToListAsync(ct)
                    : [];
            }
            return await ReponseAsync(etapes, ordres, ct);
        });
        b.MapPost("", async (ValidationBorne v, HttpContext http, LogiBtpContext db, ServiceBorne borne, ServiceEtapes etapes, CancellationToken ct) =>
        {
            var (s, appareil, test) = await borne.SalarieIdentifieAsync(http, v.Jeton, ct);
            if (!await PeutAsync(db, s, v.EntId, ct)) throw ExceptionMetier.AccesRefuse("VALIDER_ETAPE");
            // Borne d'essai : rien n'est enregistré, l'écran affiche la réponse actuelle.
            if (test) return await etapes.AtelierAsync(v.EntId, ct) ?? new { };
            return await etapes.ActionAsync(v.EntId, v.Code, new ActionEtape("VALIDER"), await ComptesBtp.AuteurBorneAsync(db, s, appareil, ct), ct, droitVerifie: true);
        });
        b.ExigeModule(ModulesFacultatifs.Execution, "Exécution");
        return g;
    }
}
