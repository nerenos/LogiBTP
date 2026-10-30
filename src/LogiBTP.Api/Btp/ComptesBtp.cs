using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Compte de l'utilisateur et individus de l'annuaire : individu et salarié du compte (par <c>ind_utilisateur</c>),
/// auteur d'une saisie à la borne, responsables de service.
/// </summary>
public static class ComptesBtp
{
    /// <summary>
    /// Chefs de chaque salarié : responsable de son service principal ou du service parent (colonnes <c>sal_id</c>,
    /// <c>ind_id</c>, <c>ind_utilisateur</c> du responsable).
    /// </summary>
    public const string SqlChefs = """
        SELECT s.sal_id, i.ind_id, i.ind_utilisateur FROM salarie s JOIN service_membre m ON m.sme_ind_id = s.sal_ind_id AND m.sme_principal
        JOIN service v ON v.srv_id = m.sme_srv_id LEFT JOIN service p ON p.srv_id = v.srv_parent_id
        JOIN individu i ON i.ind_id IN (v.srv_responsable_id, p.srv_responsable_id)
        """;

    /// <summary>Individu du compte.</summary>
    public static Task<long?> IndividuAsync(DbContext db, string utilisateur, CancellationToken ct) =>
        db.Database.SqlQueryRaw<long?>("SELECT ind_id AS \"Value\" FROM individu WHERE ind_utilisateur = @u ORDER BY ind_id LIMIT 1",
            new NpgsqlParameter("u", utilisateur)).FirstOrDefaultAsync(ct);

    /// <summary>Salarié actif de l'individu du compte.</summary>
    /// <summary>
    /// Salariés et intérimaires des équipes dont le compte @u est le chef à la date @jour (composition du jour,
    /// sous-équipes développées : <c>f_membres_equipe</c>) ; colonne <c>Value</c>.
    /// </summary>
    public const string SqlEquipiers = """
        SELECT m.ressource::int AS "Value" FROM equipe e
        CROSS JOIN LATERAL f_membres_equipe(e.equ_id, @jour) m
        WHERE m.type IN ('SALARIE', 'INTERIM') AND EXISTS (
          SELECT 1 FROM f_membres_equipe(e.equ_id, @jour) c JOIN salarie cs ON cs.sal_id::text = c.ressource JOIN individu ci ON ci.ind_id = cs.sal_ind_id
          WHERE c.chef AND c.type IN ('SALARIE', 'INTERIM') AND ci.ind_utilisateur = @u)
        """;

    public static Task<int?> SalarieAsync(DbContext db, string utilisateur, CancellationToken ct) =>
        db.Database.SqlQueryRaw<int?>("""
            SELECT s.sal_id AS "Value" FROM salarie s JOIN individu i ON i.ind_id = s.sal_ind_id WHERE i.ind_utilisateur = @u AND s.sal_actif ORDER BY s.sal_id LIMIT 1
            """, new NpgsqlParameter("u", utilisateur)).FirstOrDefaultAsync(ct);

    /// <summary>
    /// Utilisateur inscrit comme auteur d'une saisie à la borne : compte du salarié, sinon <c>salarie:&lt;id&gt;</c>,
    /// sinon la borne ; profil BORNE (droits de création portés par l'appareil enregistré).
    /// </summary>
    public static async Task<Utilisateur> AuteurBorneAsync(DbContext db, int salarie, int appareil, CancellationToken ct)
    {
        var code = await db.Database.SqlQueryRaw<string?>("""
            SELECT coalesce(i.ind_utilisateur, 'salarie:' || s.sal_id) AS "Value" FROM salarie s LEFT JOIN individu i ON i.ind_id = s.sal_ind_id WHERE s.sal_id = @s
            """, new NpgsqlParameter("s", salarie)).FirstOrDefaultAsync(ct);
        return new Utilisateur(code ?? $"borne:{appareil}", Profils.Borne, null);
    }

    /// <summary>L'utilisateur est responsable (par l'individu de son compte) d'un de ces services.</summary>
    public static async Task<bool> EstResponsableAsync(DbContext db, string utilisateur, int[] services, CancellationToken ct) =>
        services.Length > 0 && await db.Database.SqlQueryRaw<bool>("""
            SELECT EXISTS (SELECT 1 FROM service s JOIN individu i ON i.ind_id = s.srv_responsable_id WHERE i.ind_utilisateur = @u AND s.srv_id = ANY(@s)) AS "Value"
            """, new NpgsqlParameter("u", utilisateur), new NpgsqlParameter("s", services)).FirstAsync(ct);
}
