using LogiBTP.Reglements;
using LogiBTP.Socle.Web;
using LogiBTP.SousTraitance;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using LogiBTP.Socle.Donnees;

namespace LogiBTP.Api.Btp;

public sealed record LiberationSaisie(DateOnly? Le);

/// <summary>
/// Réception des travaux d'un marché et libération de la retenue de garantie (ANALYSE-MODULE-SOUS-TRAITANCE.md ST23,
/// db/214) : réception, réserves et leur levée saisies dans la fiche du marché ; échéance de libération par
/// <see cref="ReglesRetenue"/> (réception + 1 an, réserves) ; retenues = échéances RETENUE des pièces validées non annulées
/// du marché, datées à la libération (le module Règlements les propose alors au pointage) ; cautions du marché (module
/// Règlements, s'il est installé) et leur consommation (lot F : part cautionnée de chaque retenue, exigible avec la pièce,
/// par <see cref="ResteAPayer.ConsommerCautions"/> sur toutes les retenues du tiers). Routes :
/// <c>/api/structure/marches/{id}/retenue</c>.
/// </summary>
public static class RetenuesMarche
{
    private sealed record EtatMarche(DateOnly? Reception, bool Reserves, DateOnly? LeveesLe, DateOnly? LibereeLe);
    private sealed record Retenue(long EchId, long EntId, string? Numero, string Type, DateOnly? DateDocument, decimal Montant, DateOnly? Date);
    private sealed record Caution(long Id, string Organisme, decimal Montant, DateOnly Date, DateOnly? DateFin, string? Reference, DateOnly? Mainlevee, long? ObjetId);

    private sealed record RetenueTiers(long EchId, long? MarcheId, DateOnly? DateDocument, decimal Montant);

    private const string SqlRetenues = """
        SELECT e.ech_id, d.ent_id, d.ent_numero AS numero, t.tyd_libelle AS type, d.ent_date AS date_document, e.ech_montant AS montant, e.ech_date AS date
        FROM document_echeance e JOIN document d ON d.ent_id = e.ech_ent_id JOIN type_document t ON t.tyd_id = d.ent_tyd_id
        JOIN statut_document s ON s.std_id = d.ent_std_id
        WHERE d.ent_marche_id = @id AND e.ech_nature = 'RETENUE' AND f_document_valable(d.ent_id, FALSE)
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
        var module = await db.Database.SqlQueryRaw<bool>("SELECT to_regclass('caution') IS NOT NULL AS \"Value\"").FirstAsync(ct);
        var cautions = module
            ? await db.Database.SqlQueryRaw<Caution>("""
                SELECT cau_id AS id, cau_organisme AS organisme, cau_montant AS montant, cau_date AS date, cau_date_fin AS date_fin, cau_reference AS reference,
                       cau_mainlevee AS mainlevee, cau_objet_id AS objet_id
                FROM caution c JOIN marche m ON m.mar_id = @id
                WHERE c.cau_tiers_id = m.mar_tiers_id AND (c.cau_objet_id IS NULL OR (c.cau_objet = 'marche' AND c.cau_objet_id = @id))
                ORDER BY cau_date
                """, new NpgsqlParameter("id", id)).ToListAsync(ct)
            : [];
        var cautionne = new Dictionary<long, decimal>();
        var consomme = new Dictionary<long, decimal>();
        if (cautions.Count > 0)
        {
            // Toutes les retenues du tiers : une caution sans objet se consomme d'abord sur les plus anciennes.
            var duTiers = await db.Database.SqlQueryRaw<RetenueTiers>("""
                SELECT e.ech_id, d.ent_marche_id AS marche_id, d.ent_date AS date_document, e.ech_montant AS montant
                FROM document_echeance e JOIN document d ON d.ent_id = e.ech_ent_id JOIN statut_document s ON s.std_id = d.ent_std_id
                JOIN marche m ON m.mar_id = @id
                WHERE d.ent_tiers_id = m.mar_tiers_id AND e.ech_nature = 'RETENUE' AND f_document_valable(d.ent_id, FALSE)
                """, new NpgsqlParameter("id", id)).ToListAsync(ct);
            var conso = ResteAPayer.ConsommerCautions(
                [.. cautions.Select(c => new CautionRetenue(c.Id, c.ObjetId, c.Date, c.Montant, c.Mainlevee))],
                [.. duTiers.Select(r => new RetenueACouvrir(r.EchId, r.MarcheId, r.DateDocument, r.Montant))]);
            foreach (var r in conso.Retenues) cautionne[r.Id] = r.Cautionne;
            foreach (var c in conso.Cautions) consomme[c.Id] = c.Consomme;
        }
        return new
        {
            reception = m.Reception, reserves = m.Reserves, levees_le = m.LeveesLe, liberee_le = m.LibereeLe,
            liberation = ReglesRetenue.Calculer(m.Reception, m.Reserves, m.LeveesLe, DateOnly.FromDateTime(DateTime.Today)),
            total = retenues.Sum(r => r.Montant), cautionne = retenues.Sum(r => cautionne.GetValueOrDefault(r.EchId)),
            retenues = retenues.Select(r => new
            {
                ech_id = r.EchId, ent_id = r.EntId, numero = r.Numero, type = r.Type, date_document = r.DateDocument, montant = r.Montant, date = r.Date,
                cautionne = cautionne.GetValueOrDefault(r.EchId),
            }),
            cautions = cautions.Select(c => new
            {
                id = c.Id, organisme = c.Organisme, montant = c.Montant, date = c.Date, date_fin = c.DateFin, reference = c.Reference, mainlevee = c.Mainlevee,
                objet_id = c.ObjetId, consomme = consomme.GetValueOrDefault(c.Id),
            }),
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
        await using var tx = await db.Unite().CommencerAsync(ct);
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
