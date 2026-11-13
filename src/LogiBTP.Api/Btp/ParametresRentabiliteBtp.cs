using LogiBTP.Domaine;
using LogiBTP.Rentabilite.Web;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using LogiBTP.Socle.Donnees;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Paramètres du module Rentabilité (db/258, page /parametres/rentabilite) : rôle de chaque type de pièce (§ 4.1), taux
/// horaire moyen par service (Q8, R2), coefficients de frais généraux par nature et par date (Q7), coût horaire par type de
/// matériel et nature des heures de matériel (db/261, lot 5, R9). Écriture réservée aux
/// administrateurs ; toute modification met les chantiers ouverts dans la file (les règles appliquées changent).
/// </summary>
public static class ParametresRentabiliteBtp
{
    public sealed record RoleType(string Type, string Libelle, string Famille, string? Role, string? RoleRelance = null);
    public sealed record TauxService(int SrvId, string Service, decimal? Taux);
    public sealed record CoefNature(int? NatId, DateOnly Depuis, decimal Coef);
    public sealed record ServiceLu(int Id, string Libelle);
    public sealed record NatureLue(int Id, string Code, string Libelle);
    public sealed record CoutTypeMateriel(string Type, string Libelle, string? Parent, decimal? Cout);
    public sealed record ParametresMateriel(int? Nature, List<CoutTypeMateriel> Couts);

    public static RouteGroupBuilder MapParametresRentabilite(this RouteGroupBuilder api)
    {
        api.MapGet("/rentabilite/parametres", async (LogiBtpContext db, CancellationToken ct) => new
        {
            roles = await db.Database.SqlQuery<RoleType>($"""
                SELECT t.tyd_code AS type, t.tyd_libelle AS libelle, t.tyd_famille AS famille, x.rrt_role AS role, t.tyd_role_relance AS role_relance
                FROM type_document t LEFT JOIN rentabilite_role_type x ON x.rrt_tyd_code = t.tyd_code
                WHERE t.tyd_actif ORDER BY t.tyd_famille, t.tyd_code
                """).ToListAsync(ct),
            taux = await db.Database.SqlQuery<TauxService>($"""
                SELECT s.srv_id, s.srv_libelle AS service, r.rts_taux AS taux
                FROM service s LEFT JOIN rentabilite_taux_service r ON r.rts_srv_id = s.srv_id
                WHERE s.srv_actif ORDER BY s.srv_libelle
                """).ToListAsync(ct),
            coefs = await db.Database.SqlQuery<CoefNature>($"""
                SELECT rcf_nat_id AS nat_id, rcf_depuis AS depuis, rcf_coef AS coef FROM rentabilite_coef_fg ORDER BY rcf_nat_id NULLS FIRST, rcf_depuis
                """).ToListAsync(ct),
            natures = await db.Database.SqlQuery<NatureLue>($"""
                SELECT nat_id AS id, nat_code AS code, nat_libelle AS libelle FROM nature_element WHERE nat_actif ORDER BY nat_code
                """).ToListAsync(ct),
            materiel = new ParametresMateriel(
                (await db.Database.SqlQuery<int?>($"SELECT rpa_nat_materiel AS \"Value\" FROM rentabilite_parametre WHERE rpa_id = 1").ToListAsync(ct)).FirstOrDefault(),
                await db.Database.SqlQuery<CoutTypeMateriel>($"""
                    SELECT v.lva_code AS type, v.lva_libelle AS libelle, v.lva_parent AS parent, r.rcm_cout AS cout
                    FROM liste_valeur v
                    LEFT JOIN liste_valeur p ON p.lva_liste = v.lva_liste AND p.lva_code = v.lva_parent
                    LEFT JOIN rentabilite_cout_materiel r ON r.rcm_type = v.lva_code
                    WHERE v.lva_liste = 'TYPE_MATERIEL' AND (v.lva_actif OR r.rcm_cout IS NOT NULL)
                    ORDER BY coalesce(p.lva_ordre, v.lva_ordre), coalesce(p.lva_code, v.lva_code), v.lva_parent NULLS FIRST, v.lva_ordre
                    """).ToListAsync(ct)),
        });

        api.MapPut("/rentabilite/parametres/roles", async (List<RoleType> roles, HttpContext http, LogiBtpContext db, ServiceRentabilite s, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            u.ExigerParametres();
            var connus = typeof(RolesRentabilite).GetFields().Select(f => (string)f.GetValue(null)!).ToHashSet();
            if (roles.FirstOrDefault(r => r.Role is { } x && !connus.Contains(x)) is { } inconnu)
                throw ExceptionMetier.Invalide("RENTABILITE_ROLE", $"Rôle inconnu : {inconnu.Role}");
            var relances = typeof(RolesRelance).GetFields().Select(f => (string)f.GetValue(null)!).ToHashSet();
            if (roles.FirstOrDefault(r => !string.IsNullOrEmpty(r.RoleRelance) && !relances.Contains(r.RoleRelance)) is { } mauvais)
                throw ExceptionMetier.Invalide("RELANCE_ROLE", $"Rôle de relance inconnu : {mauvais.RoleRelance}");
            await using var tx = await db.Unite().CommencerAsync(ct);
            foreach (var r in roles)
            {
                // Rôle dans le module Relances (db/283) : DEVIS, FACTURE ou aucun.
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE type_document SET tyd_role_relance = {(string.IsNullOrWhiteSpace(r.RoleRelance) ? null : r.RoleRelance)}
                    WHERE tyd_code = {r.Type} AND tyd_role_relance IS DISTINCT FROM {(string.IsNullOrWhiteSpace(r.RoleRelance) ? null : r.RoleRelance)}
                    """, ct);
                if (string.IsNullOrWhiteSpace(r.Role))
                    await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM rentabilite_role_type WHERE rrt_tyd_code = {r.Type}", ct);
                else
                    await db.Database.ExecuteSqlInterpolatedAsync($"""
                        INSERT INTO rentabilite_role_type (rrt_tyd_code, rrt_role, rrt_maj_par) VALUES ({r.Type}, {r.Role}, {u.Code})
                        ON CONFLICT (rrt_tyd_code) DO UPDATE SET rrt_role = EXCLUDED.rrt_role, rrt_maj_par = EXCLUDED.rrt_maj_par, rrt_maj_le = now()
                        WHERE rentabilite_role_type.rrt_role IS DISTINCT FROM EXCLUDED.rrt_role
                        """, ct);
            }
            await tx.CommitAsync(ct);
            await ToutRecalculerAsync(db, s, u, ct);
            return Results.NoContent();
        });

        api.MapPut("/rentabilite/parametres/taux", async (List<TauxService> taux, HttpContext http, LogiBtpContext db, ServiceRentabilite s, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            u.ExigerParametres();
            if (taux.Any(t => t.Taux < 0)) throw ExceptionMetier.Invalide("RENTABILITE_TAUX", "Un taux horaire est positif ou nul");
            await using var tx = await db.Unite().CommencerAsync(ct);
            await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM rentabilite_taux_service", ct);
            foreach (var t in taux.Where(t => t.Taux is not null))
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO rentabilite_taux_service (rts_srv_id, rts_taux, rts_maj_par) VALUES ({t.SrvId}, {t.Taux}, {u.Code})
                    """, ct);
            await tx.CommitAsync(ct);
            await ToutRecalculerAsync(db, s, u, ct);
            return Results.NoContent();
        });

        api.MapPut("/rentabilite/parametres/materiel", async (ParametresMateriel m, HttpContext http, LogiBtpContext db, ServiceRentabilite s, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            u.ExigerParametres();
            if (m.Couts.Any(c => c.Cout < 0)) throw ExceptionMetier.Invalide("RENTABILITE_COUT_MATERIEL", "Un coût horaire de matériel est positif ou nul");
            await using var tx = await db.Unite().CommencerAsync(ct);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO rentabilite_parametre (rpa_id, rpa_nat_materiel, rpa_maj_par) VALUES (1, {m.Nature}, {u.Code})
                ON CONFLICT (rpa_id) DO UPDATE SET rpa_nat_materiel = EXCLUDED.rpa_nat_materiel, rpa_maj_par = EXCLUDED.rpa_maj_par, rpa_maj_le = now()
                """, ct);
            await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM rentabilite_cout_materiel", ct);
            foreach (var c in m.Couts.Where(c => c.Cout is not null))
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO rentabilite_cout_materiel (rcm_type, rcm_cout, rcm_maj_par) VALUES ({c.Type}, {c.Cout}, {u.Code})
                    """, ct);
            await tx.CommitAsync(ct);
            await ToutRecalculerAsync(db, s, u, ct);
            return Results.NoContent();
        });

        api.MapPut("/rentabilite/parametres/coefs", async (List<CoefNature> coefs, HttpContext http, LogiBtpContext db, ServiceRentabilite s, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            u.ExigerParametres();
            if (coefs.Any(c => c.Coef <= 0)) throw ExceptionMetier.Invalide("RENTABILITE_COEF", "Un coefficient de frais généraux est strictement positif");
            if (coefs.GroupBy(c => (c.NatId, c.Depuis)).Any(g => g.Count() > 1))
                throw ExceptionMetier.Invalide("RENTABILITE_COEF_DOUBLON", "Deux coefficients pour la même nature à la même date");
            await using var tx = await db.Unite().CommencerAsync(ct);
            await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM rentabilite_coef_fg", ct);
            foreach (var c in coefs)
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO rentabilite_coef_fg (rcf_nat_id, rcf_depuis, rcf_coef, rcf_maj_par) VALUES ({c.NatId}, {c.Depuis}, {c.Coef}, {u.Code})
                    """, ct);
            await tx.CommitAsync(ct);
            await ToutRecalculerAsync(db, s, u, ct);
            return Results.NoContent();
        });
        return api;
    }

    private static async Task ToutRecalculerAsync(LogiBtpContext db, ServiceRentabilite s, Utilisateur u, CancellationToken ct)
    {
        var chantiers = await db.Database.SqlQuery<int>($"SELECT cha_id AS \"Value\" FROM chantier WHERE cha_statut = 'OUVERT'").ToListAsync(ct);
        await s.SignalerAsync(chantiers, $"Paramètres de la rentabilité modifiés par {u.Code}", false, ct);
    }
}
