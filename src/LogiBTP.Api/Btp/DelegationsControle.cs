using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using LogiBTP.Socle.Donnees;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Délégation du contrôle N+1 des étapes d'ordres (module Exécution, E30, `db/268`) : le responsable d'un service (ou un
/// administrateur, ou le droit Modifier du paramétrage) désigne des membres du service — ou de ses sous-services — qui
/// contrôlent comme lui, pour une période ou sans fin. Lu par `f_controleurs_service` (droit de contrôle, tâche du CRM,
/// rappels du contrôle en attente).
/// </summary>
public static class DelegationsControle
{
    public sealed record DelegationSaisie(long IndId, DateOnly? Du, DateOnly? Au, string? Commentaire);

    private const string SqlServices = """
        SELECT coalesce(json_agg(json_build_object('srv_id', s.srv_id, 'code', s.srv_code, 'libelle', s.srv_libelle, 'parent_id', s.srv_parent_id,
            'responsable', (SELECT concat_ws(' ', r.ind_prenom, r.ind_nom) FROM individu r WHERE r.ind_id = coalesce(s.srv_responsable_id, p.srv_responsable_id)),
            'modifiable', @tous OR @ind IN (s.srv_responsable_id, p.srv_responsable_id),
            'membres', (SELECT coalesce(json_agg(json_build_object('valeur', i.ind_id, 'libelle', concat_ws(' ', i.ind_prenom, i.ind_nom)) ORDER BY lower(i.ind_nom), lower(i.ind_prenom)), '[]')
                        FROM individu i WHERE i.ind_actif AND EXISTS (SELECT 1 FROM service_membre m JOIN service x ON x.srv_id = m.sme_srv_id
                                                                     WHERE m.sme_ind_id = i.ind_id AND s.srv_id IN (x.srv_id, x.srv_parent_id))),
            'delegations', (SELECT coalesce(json_agg(json_build_object('ind_id', d.dlc_ind_id, 'individu', concat_ws(' ', i.ind_prenom, i.ind_nom),
                                'du', d.dlc_du, 'au', d.dlc_au, 'commentaire', d.dlc_commentaire, 'par', d.dlc_par, 'le', d.dlc_le,
                                'en_vigueur', (d.dlc_du IS NULL OR d.dlc_du <= current_date) AND (d.dlc_au IS NULL OR d.dlc_au >= current_date))
                                ORDER BY d.dlc_du NULLS FIRST, d.dlc_id), '[]')
                            FROM delegation_controle d JOIN individu i ON i.ind_id = d.dlc_ind_id WHERE d.dlc_srv_id = s.srv_id))
          ORDER BY coalesce(p.srv_ordre, s.srv_ordre), coalesce(p.srv_code, s.srv_code), s.srv_parent_id NULLS FIRST, s.srv_ordre, s.srv_code), '[]') AS "Value"
        FROM service s LEFT JOIN service p ON p.srv_id = s.srv_parent_id WHERE s.srv_actif
        """;

    public static IEndpointRouteBuilder MapDelegationsControle(this IEndpointRouteBuilder execution)
    {
        execution.MapGet("/delegations", async (HttpContext http, LogiBtpContext db, CancellationToken ct) =>
            await ServicesAsync(db, Utilisateur.Depuis(http), ct));
        execution.MapPut("/delegations/{srv:int}", async (int srv, List<DelegationSaisie> l, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            await EnregistrerAsync(db, srv, l, u, ct);
            return await ServicesAsync(db, u, ct);
        });
        return execution;
    }

    private static async Task<IResult> ServicesAsync(LogiBtpContext db, Utilisateur u, CancellationToken ct)
    {
        var ind = await ComptesBtp.IndividuAsync(db, u.Code, ct);
        return await db.JsonAsync(SqlServices, ct, new NpgsqlParameter("tous", u.EstAdmin || u.PeutModifierParametres),
            SqlBtp.P("ind", ind, NpgsqlDbType.Bigint));
    }

    /// <summary>
    /// Remplace les délégations d'un service : administrateur, droit de modifier le paramétrage ou responsable du service
    /// (ou de son parent) ; délégués = membres actifs du service ou d'un sous-service, jamais le responsable lui-même ;
    /// période cohérente ; une personne une seule fois par période qui se chevauche.
    /// </summary>
    public static async Task EnregistrerAsync(LogiBtpContext db, int srv, List<DelegationSaisie> l, Utilisateur u, CancellationToken ct)
    {
        var ind = await ComptesBtp.IndividuAsync(db, u.Code, ct);
        var responsables = await db.Database.SqlQueryRaw<long?>("""
            SELECT unnest(ARRAY[s.srv_responsable_id, p.srv_responsable_id]) AS "Value" FROM service s LEFT JOIN service p ON p.srv_id = s.srv_parent_id WHERE s.srv_id = @s
            """, new NpgsqlParameter("s", srv)).ToListAsync(ct);
        if (responsables.Count == 0) throw ExceptionMetier.Introuvable($"Service {srv}");
        if (!u.EstAdmin && !u.PeutModifierParametres && (ind is null || !responsables.Contains(ind)))
            throw ExceptionMetier.AccesRefuse("DELEGUER");
        foreach (var d in l)
        {
            if (d.Du is { } du && d.Au is { } au && au < du) throw ExceptionMetier.Invalide("DELEGATION_PERIODE", "La fin de la délégation précède son début");
            if (responsables.Contains(d.IndId)) throw ExceptionMetier.Invalide("DELEGATION_RESPONSABLE", "Le responsable du service contrôle déjà");
        }
        foreach (var g in l.GroupBy(d => d.IndId))
        {
            var p = g.ToList();
            for (var i = 0; i < p.Count; i++)
                for (var j = i + 1; j < p.Count; j++)
                    if ((p[i].Du ?? DateOnly.MinValue) <= (p[j].Au ?? DateOnly.MaxValue) && (p[j].Du ?? DateOnly.MinValue) <= (p[i].Au ?? DateOnly.MaxValue))
                        throw ExceptionMetier.Invalide("DELEGATION_DOUBLE", "Une même personne a deux délégations qui se chevauchent");
        }
        var ids = l.Select(d => d.IndId).Distinct().ToArray();
        var membres = await db.Database.SqlQueryRaw<long>("""
            SELECT DISTINCT m.sme_ind_id AS "Value" FROM service_membre m JOIN service x ON x.srv_id = m.sme_srv_id JOIN individu i ON i.ind_id = m.sme_ind_id
            WHERE i.ind_actif AND m.sme_ind_id = ANY(@ids) AND @s IN (x.srv_id, x.srv_parent_id)
            """, new NpgsqlParameter("ids", ids), new NpgsqlParameter("s", srv)).ToListAsync(ct);
        if (ids.Except(membres).Any()) throw ExceptionMetier.Invalide("DELEGATION_MEMBRE", "Le délégué doit être un membre actif du service");

        await using var tx = await db.Unite().CommencerAsync(ct);
        await db.Database.ExecuteSqlRawAsync("DELETE FROM delegation_controle WHERE dlc_srv_id = @s", [new NpgsqlParameter("s", srv)], ct);
        foreach (var d in l)
        {
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO delegation_controle (dlc_srv_id, dlc_ind_id, dlc_du, dlc_au, dlc_commentaire, dlc_par)
                VALUES (@s, @i, @du, @au, left(@c, 200), @u)
                """,
                [
                    new NpgsqlParameter("s", srv), new NpgsqlParameter("i", d.IndId), SqlBtp.P("du", d.Du, NpgsqlDbType.Date),
                    SqlBtp.P("au", d.Au, NpgsqlDbType.Date), SqlBtp.P("c", string.IsNullOrWhiteSpace(d.Commentaire) ? null : d.Commentaire.Trim(), NpgsqlDbType.Varchar),
                    new NpgsqlParameter("u", u.Code),
                ], ct);
        }
        await tx.CommitAsync(ct);
    }
}
