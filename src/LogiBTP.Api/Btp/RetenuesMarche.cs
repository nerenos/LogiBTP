using LogiBTP.Socle.Web;
using LogiBTP.SousTraitance;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

public sealed record LiberationSaisie(DateOnly? Le);

/// <summary>
/// Réception des travaux d'un marché et libération de la retenue de garantie (ANALYSE-MODULE-SOUS-TRAITANCE.md ST23,
/// db/214) : réception, réserves et leur levée saisies dans la fiche du marché ; échéance de libération par
/// <see cref="ReglesRetenue"/> (réception + 1 an, réserves) ; retenues = échéances RETENUE des pièces validées non annulées
/// du marché, datées à la libération (le module Règlements les propose alors au pointage) ; cautions du marché (module
/// Règlements, s'il est installé). Routes : <c>/api/structure/marches/{id}/retenue</c>.
/// </summary>
public static class RetenuesMarche
{
    private sealed record EtatMarche(DateOnly? Reception, bool Reserves, DateOnly? LeveesLe, DateOnly? LibereeLe);
    private sealed record Retenue(long EchId, long EntId, string? Numero, string Type, DateOnly? DateDocument, decimal Montant, DateOnly? Date);
    private sealed record Caution(long Id, string Organisme, decimal Montant, DateOnly Date, DateOnly? DateFin, string? Reference, DateOnly? Mainlevee);

    private const string SqlRetenues = """
        SELECT e.ech_id, d.ent_id, d.ent_numero AS numero, t.tyd_libelle AS type, d.ent_date AS date_document, e.ech_montant AS montant, e.ech_date AS date
        FROM document_echeance e JOIN document d ON d.ent_id = e.ech_ent_id JOIN type_document t ON t.tyd_id = d.ent_tyd_id
        JOIN statut_document s ON s.std_id = d.ent_std_id
        WHERE d.ent_marche_id = @id AND e.ech_nature = 'RETENUE' AND d.ent_verrouille AND s.std_code <> 'ANNULE'
        ORDER BY d.ent_date, d.ent_id
        """;

    private static async Task<EtatMarche> EtatAsync(LogiBtpContext db, int id, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<EtatMarche>("""
            SELECT mar_date_reception AS reception, mar_reserves AS reserves, mar_reserves_levees_le AS levees_le, mar_retenue_liberee_le AS liberee_le
            FROM marche WHERE mar_id = @id
            """, new NpgsqlParameter("id", id)).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable($"Marché {id}");

    public static async Task<object> LireAsync(LogiBtpContext db, int id, CancellationToken ct)
    {
        var m = await EtatAsync(db, id, ct);
        var retenues = await db.Database.SqlQueryRaw<Retenue>(SqlRetenues, new NpgsqlParameter("id", id)).ToListAsync(ct);
        var cautions = await db.Database.SqlQueryRaw<bool>("SELECT to_regclass('caution') IS NOT NULL AS \"Value\"").FirstAsync(ct)
            ? await db.Database.SqlQueryRaw<Caution>("""
                SELECT cau_id AS id, cau_organisme AS organisme, cau_montant AS montant, cau_date AS date, cau_date_fin AS date_fin, cau_reference AS reference,
                       cau_mainlevee AS mainlevee
                FROM caution WHERE cau_objet = 'marche' AND cau_objet_id = @id ORDER BY cau_date
                """, new NpgsqlParameter("id", id)).ToListAsync(ct)
            : [];
        return new
        {
            reception = m.Reception, reserves = m.Reserves, levees_le = m.LeveesLe, liberee_le = m.LibereeLe,
            liberation = ReglesRetenue.Calculer(m.Reception, m.Reserves, m.LeveesLe, DateOnly.FromDateTime(DateTime.Today)),
            total = retenues.Sum(r => r.Montant), retenues, cautions,
        };
    }

    /// <summary>Libération : échéances RETENUE non datées du marché datées au jour donné (au plus tôt l'échéance de libération).</summary>
    public static async Task<object> LibererAsync(LogiBtpContext db, int id, LiberationSaisie s, Utilisateur u, CancellationToken ct)
    {
        var m = await EtatAsync(db, id, ct);
        var le = s.Le ?? DateOnly.FromDateTime(DateTime.Today);
        var r = ReglesRetenue.Calculer(m.Reception, m.Reserves, m.LeveesLe, le);
        if (r.Bloquee) throw ExceptionMetier.Invalide(r.Motif!, r.Motif == "RET_RESERVES" ? "Réserves non levées : la retenue reste bloquée" : "Travaux non réceptionnés : pas d'échéance de libération");
        if (!r.Liberable) throw ExceptionMetier.Invalide("RET_ECHEANCE", $"Retenue libérable à partir du {r.Date:dd/MM/yyyy}");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlRawAsync($"""
            UPDATE document_echeance e SET ech_date = @le
            WHERE e.ech_date IS NULL AND e.ech_id IN (SELECT x.ech_id FROM ({SqlRetenues}) x)
            """, [new NpgsqlParameter("id", id), new NpgsqlParameter("le", le)], ct);
        await db.Database.ExecuteSqlRawAsync("UPDATE marche SET mar_retenue_liberee_le = @le WHERE mar_id = @id", [new NpgsqlParameter("id", id), new NpgsqlParameter("le", le)], ct);
        await tx.CommitAsync(ct);
        return await LireAsync(db, id, ct);
    }

    public static RouteGroupBuilder MapRetenuesMarche(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/structure/marches/{id:int}/retenue");
        g.MapGet("", (int id, LogiBtpContext db, CancellationToken ct) => LireAsync(db, id, ct));
        g.MapPost("/liberer", (int id, LiberationSaisie s, HttpContext http, LogiBtpContext db, CancellationToken ct) => LibererAsync(db, id, s, Utilisateur.Depuis(http), ct));
        return api;
    }
}
