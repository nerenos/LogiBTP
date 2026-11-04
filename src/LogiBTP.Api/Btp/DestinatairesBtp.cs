using LogiBTP.Socle;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Destinataires des notifications, courriels et tâches : comptes administrateurs actifs, identifiants des membres d'un
/// service (par identifiant, code ou nature), codes des services d'un utilisateur.
/// </summary>
public static class DestinatairesBtp
{
    /// <summary>Comptes de personnes actifs au profil administrateur (colonne <c>"Value"</c>).</summary>
    public const string SqlAdministrateurs =
        $"SELECT cpt_code AS \"Value\" FROM compte WHERE cpt_type = 'PERSONNE' AND cpt_actif AND cpt_profil = '{Profils.Admin}'";

    /// <summary>Identifiants des membres des services de codes <c>@services</c> (colonne <c>"Value"</c>).</summary>
    public const string SqlMembresServices = """
        SELECT DISTINCT i.ind_utilisateur AS "Value" FROM service s JOIN service_membre m ON m.sme_srv_id = s.srv_id JOIN individu i ON i.ind_id = m.sme_ind_id
        WHERE s.srv_code = ANY(@services) AND i.ind_utilisateur IS NOT NULL
        """;

    public static Task<List<string>> AdministrateursAsync(DbContext db, CancellationToken ct) =>
        db.Database.SqlQueryRaw<string>(SqlAdministrateurs).ToListAsync(ct);

    /// <summary>Identifiants des membres d'un service.</summary>
    public static Task<List<string>> MembresAsync(DbContext db, long service, CancellationToken ct) =>
        db.Database.SqlQueryRaw<string>("""
            SELECT DISTINCT i.ind_utilisateur AS "Value" FROM service_membre m JOIN individu i ON i.ind_id = m.sme_ind_id
            WHERE m.sme_srv_id = @s AND i.ind_utilisateur IS NOT NULL
            """, new NpgsqlParameter("s", service)).ToListAsync(ct);

    /// <summary>Identifiants des membres des services de ces codes.</summary>
    public static Task<List<string>> MembresAsync(DbContext db, string[] services, CancellationToken ct) =>
        db.Database.SqlQueryRaw<string>(SqlMembresServices, new NpgsqlParameter("services", services)).ToListAsync(ct);

    /// <summary>Identifiants des membres des services d'une nature (LOGISTIQUE, ADMINISTRATIF…).</summary>
    public static Task<List<string>> MembresNatureAsync(DbContext db, string nature, CancellationToken ct) =>
        db.Database.SqlQueryRaw<string>("""
            SELECT DISTINCT i.ind_utilisateur AS "Value" FROM service s JOIN service_membre m ON m.sme_srv_id = s.srv_id JOIN individu i ON i.ind_id = m.sme_ind_id
            WHERE s.srv_nature = @n AND i.ind_utilisateur IS NOT NULL
            """, new NpgsqlParameter("n", nature)).ToListAsync(ct);

    /// <summary>Codes des services dont l'utilisateur (identifiant de son individu, sans casse) est membre.</summary>
    public static Task<List<string>> ServicesAsync(DbContext db, string utilisateur, CancellationToken ct) =>
        db.Database.SqlQueryRaw<string>("""
            SELECT DISTINCT s.srv_code AS "Value" FROM service s JOIN service_membre m ON m.sme_srv_id = s.srv_id
            JOIN individu i ON i.ind_id = m.sme_ind_id WHERE i.ind_utilisateur = lower(@u)
            """, new NpgsqlParameter("u", utilisateur)).ToListAsync(ct);
}
