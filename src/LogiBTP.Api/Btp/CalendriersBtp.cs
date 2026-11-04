using LogiBTP.Calendrier;
using LogiBTP.Calendrier.Web;
using LogiBTP.Domaine;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Api.Btp;

/// <summary>Calendrier d'un service (administrateur).</summary>
public sealed record CalendrierService(int SrvId, int? CalId);

/// <summary>Utilisations d'un calendrier par le cœur : services, salariés, matériels (suppression refusée).</summary>
public class SpecialisationCalendrierBtp : SpecialisationCalendrier
{
    public override Task<int> UtilisationsAsync(CalendrierDbContext db, int calendrier, CancellationToken ct) =>
        db.Database.SqlQueryRaw<int>("""
            SELECT ((SELECT count(*) FROM service WHERE srv_cal_id = @c) + (SELECT count(*) FROM salarie WHERE sal_cal_id = @c)
                  + (SELECT count(*) FROM materiel WHERE mat_cal_id = @c))::int AS "Value"
            """, new NpgsqlParameter("c", calendrier)).FirstAsync(ct);
}

/// <summary>
/// Calendrier effectif d'une ressource (db/196) : celui du salarié ou du matériel, sinon celui de son service (service
/// principal du salarié), sinon le calendrier par défaut ; jours fermés de la société, du calendrier et du service.
/// Fourni aux modules Planning et Pointage par leurs spécialisations.
/// </summary>
public static class CalendriersBtp
{
    private sealed record Ligne(int? CalId, int? SrvId);

    /// <summary>Calendrier et service d'un salarié (calendrier nul : par défaut).</summary>
    public static async Task<(int? CalId, int? SrvId)> SalarieAsync(LogiBtpContext db, int salarie, CancellationToken ct)
    {
        var l = await db.Database.SqlQueryRaw<Ligne>("""
            SELECT cal_id, srv_id FROM v_salarie_calendrier WHERE sal_id = @s
            """, new NpgsqlParameter("s", salarie)).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable($"Salarié {salarie}");
        return (l.CalId, l.SrvId);
    }

    /// <summary>Calendrier et service d'un matériel.</summary>
    public static async Task<(int? CalId, int? SrvId)> MaterielAsync(LogiBtpContext db, int materiel, CancellationToken ct)
    {
        var l = await db.Database.SqlQueryRaw<Ligne>("""
            SELECT coalesce(m.mat_cal_id, sv.srv_cal_id) AS cal_id, m.mat_srv_id AS srv_id
            FROM materiel m LEFT JOIN service sv ON sv.srv_id = m.mat_srv_id WHERE m.mat_id = @m
            """, new NpgsqlParameter("m", materiel)).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable($"Matériel {materiel}");
        return (l.CalId, l.SrvId);
    }

    /// <summary>Journées d'une ressource sur une période (calendrier effectif et fermetures de son service).</summary>
    public static async Task<List<Journee>> JourneesAsync(LogiBtpContext db, ServiceCalendrier calendriers, string type, int id, DateOnly du, DateOnly au, CancellationToken ct)
    {
        var (cal, srv) = type switch
        {
            TypesFiche.Salarie => await SalarieAsync(db, id, ct),
            TypesFiche.Materiel => await MaterielAsync(db, id, ct),
            _ => throw ExceptionMetier.Invalide("ELEMENT", $"Ressource inconnue : {type}"),
        };
        return await calendriers.JourneesAsync(cal, du, au, srv is int s ? [new Portee("service", s.ToString())] : [], ct);
    }

    public static IEndpointRouteBuilder MapCalendriersBtp(this IEndpointRouteBuilder api)
    {
        api.MapGet("/ressources/{type}/{id:int}/journees", (string type, int id, DateOnly du, DateOnly au, LogiBtpContext db, ServiceCalendrier c, CancellationToken ct) =>
            JourneesAsync(db, c, type, id, du, au, ct));
        api.MapGet("/ressources/calendriers-services", async (LogiBtpContext db, CancellationToken ct) => Results.Content(await db.Database.SqlQueryRaw<string>("""
            SELECT coalesce(json_agg(json_build_object('srv_id', srv_id, 'code', srv_code, 'libelle', srv_libelle, 'cal_id', srv_cal_id, 'actif', srv_actif)
              ORDER BY srv_ordre, srv_code), '[]') AS "Value" FROM service
            """).FirstAsync(ct), "application/json"));
        api.MapPut("/ressources/calendriers-services", async (List<CalendrierService> l, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            Utilisateur.Depuis(http).ExigerParametres();
            foreach (var x in l)
            {
                await db.Database.ExecuteSqlRawAsync("UPDATE service SET srv_cal_id = @c, srv_maj_le = now() WHERE srv_id = @s",
                    [SqlBtp.P("c", x.CalId, NpgsqlDbType.Integer), new NpgsqlParameter("s", x.SrvId)], ct);
            }
            return Results.NoContent();
        });
        return api;
    }
}
