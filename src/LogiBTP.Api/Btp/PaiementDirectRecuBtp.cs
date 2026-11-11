using System.Globalization;
using LogiBTP.Documents;
using LogiBTP.Domaine;
using LogiBTP.FactureElectronique;
using LogiBTP.FactureElectronique.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using LogiBTP.SousTraitance;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>Suite donnée à une demande de paiement direct reçue (statut 224) : demande enregistrée, en attente de la validation, ou sans suite.</summary>
public sealed record SuitePaiementDirect(long? Demande, bool EnAttente, string Message);

/// <summary>
/// Demande de paiement direct (statut CDAR 224) reçue d'un sous-traitant (plans/facturation-electronique.md, lot 15). Le
/// module la lit, l'enregistre (fe_statut) et la trace au journal fe_evenement (étape STATUT_RECU) sur le flux de la
/// facture du sous-traitant, donc sur sa pièce (chronologie). Le cœur enregistre la demande de paiement du module
/// Sous-traitance (stt_paiement_direct, état RECUE, reçue le jour du statut : point de départ du délai d'acceptation) pour
/// la facture de sous-traitance T_FACTURE_AVT validée d'un marché en paiement direct ou en délégation de paiement ;
/// facture encore en brouillon : la demande est enregistrée à sa validation (<see cref="ApresValidationAsync"/>), jamais
/// de validation automatique. Montant demandé : TTC, HT en autoliquidation (<see cref="ReglesPaiementDirect.Montant"/>).
/// </summary>
public sealed class PaiementDirectRecuBtp(IServiceProvider services, ILogger journal)
{
    /// <summary>Compte inscrit sur la demande enregistrée depuis un statut reçu.</summary>
    public const string Auteur = "facture_electronique";

    private sealed record FactureSt(decimal Ht, decimal Ttc, bool Valide, bool Annule, int? Marche, string? Garantie, bool Autoliquidation);

    /// <summary>Statut 224 reçu sur le flux d'une pièce : demande enregistrée ou en attente ; message de la notification. Null : autre statut.</summary>
    public async Task<SuitePaiementDirect?> StatutRecuAsync(StatutSignaleFe s, CancellationToken ct)
    {
        if (s.Statut.FstCode != StatutCdv.DemandePaiementDirect) return null;
        if (s.Facture is null || SpecialisationFactureElectroniqueBtp.PieceDu(s.Facture) is not long ent)
            return new(null, false, "Facture du sous-traitant inconnue : demande à rattacher à sa facture");
        try
        {
            if (!await services.GetRequiredService<ModulesSociete>().EstActifAsync(ModulesFacultatifs.SousTraitance, ct))
                return new(null, false, "Module Sous-traitance inactif : demande à suivre hors LogiBTP");
            var recueLe = DateOnly.FromDateTime(s.Statut.FstDate.UtcDateTime);
            return await DeclarerAsync(services.GetRequiredService<LogiBtpContext>(), ent, recueLe, Auteur, ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            // La demande reçue reste tracée au journal du module : son enregistrement ne doit jamais faire échouer la relève.
            journal.LogWarning("Facturation électronique : demande de paiement direct de la pièce {Ent} non enregistrée ({Erreur})", ent, Masquage.Texte(e.Message));
            return new(null, false, "Demande non enregistrée : à saisir dans le suivi du paiement direct");
        }
    }

    /// <summary>
    /// Demande de paiement de la facture de sous-traitance <paramref name="ent"/> enregistrée (état RECUE) si elle est
    /// validée, non annulée, sur un marché de sous-traitance en paiement direct ou en délégation, et sans demande ; facture
    /// en brouillon : en attente de la validation. Dans la transaction en cours du contexte.
    /// </summary>
    public static async Task<SuitePaiementDirect> DeclarerAsync(DbContext db, long ent, DateOnly recueLe, string par, CancellationToken ct)
    {
        var f = (await db.Database.SqlQueryRaw<FactureSt>($"""
            SELECT coalesce(d.ent_st_recu_ht, d.ent_total_ht, 0) AS ht, coalesce(d.ent_st_recu_ttc, d.ent_total_ttc, 0) AS ttc, d.ent_verrouille AS valide,
                   s.std_code = '{StatutsDocument.Annule}' AS annule, m.mar_id AS marche, m.mar_garantie AS garantie, coalesce(m.mar_autoliquidation, FALSE) AS autoliquidation
            FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document s ON s.std_id = d.ent_std_id
            LEFT JOIN marche m ON m.mar_id = d.ent_marche_id AND m.mar_sens = 'ST'
            WHERE d.ent_id = @e AND t.tyd_code = @type
            """, new NpgsqlParameter("e", ent), new NpgsqlParameter("type", TypesDocument.TFactureAvt)).ToListAsync(ct)).FirstOrDefault();
        if (f is null) return new(null, false, "La pièce n'est pas une facture de sous-traitance : demande à suivre à part");
        if (f.Marche is not int marche) return new(null, false, "Facture de sous-traitance sans marché : demande à rattacher au marché");
        var mode = ReceptionFactureBtp.ModePaiement(f.Garantie);
        if (mode is null) return new(null, false, "Le marché de sous-traitance n'est ni en paiement direct ni en délégation de paiement");
        if (f.Annule) return new(null, false, "Facture du sous-traitant annulée");
        if (!f.Valide) return new(null, true, "Demande enregistrée à la validation de la facture du sous-traitant");
        var montant = ReglesPaiementDirect.Montant(f.Ht, f.Ttc, f.Autoliquidation);
        if (montant <= 0) return new(null, false, "Montant de la demande nul");
        var id = (await db.Database.SqlQueryRaw<long>("""
            INSERT INTO stt_paiement_direct (spd_facture_id, spd_marche_id, spd_mode, spd_montant_demande, spd_recue_le, spd_maj_par)
            VALUES (@e, @m, @mode, @montant, @le, @par)
            ON CONFLICT (spd_facture_id) DO NOTHING RETURNING spd_id AS "Value"
            """, new NpgsqlParameter("e", ent), new NpgsqlParameter("m", marche), new NpgsqlParameter("mode", mode), new NpgsqlParameter("montant", montant),
            new NpgsqlParameter("le", recueLe), new NpgsqlParameter("par", par)).ToListAsync(ct)).Select(x => (long?)x).FirstOrDefault();
        return id is long d
            ? new(d, false, $"Demande de paiement de {montant.ToString("0.00", CultureInfo.InvariantCulture)} € enregistrée : à accepter sous 15 jours")
            : new(null, false, "Une demande existe déjà pour cette facture");
    }

    /// <summary>
    /// Validation d'une facture de sous-traitance : demande de paiement direct (224) déjà reçue sur un flux de la pièce →
    /// demande enregistrée, reçue le jour du premier statut 224 (dans la transaction de la validation) ; sinon rien.
    /// </summary>
    public static async Task ApresValidationAsync(DbContext db, long ent, string par, CancellationToken ct)
    {
        // Base sans le module Facturation électronique (099f) : aucune requête en erreur dans la transaction de la validation.
        if (!await db.Database.SqlQueryRaw<bool>("SELECT to_regclass('fe_statut') IS NOT NULL AND to_regclass('stt_paiement_direct') IS NOT NULL AS \"Value\"").FirstAsync(ct)) return;
        var recue = (await db.Database.SqlQueryRaw<DateTime>("""
            SELECT min(s.fst_date) AS "Value" FROM fe_statut s JOIN fe_flux f ON f.ffl_id = s.fst_ffl_id
            WHERE f.ffl_type_element = @t AND f.ffl_id_element = @e AND s.fst_code = @code AND s.fst_sens = @sens
            HAVING min(s.fst_date) IS NOT NULL
            """, new NpgsqlParameter("t", TypesElementFe.Document), new NpgsqlParameter("e", ent.ToString(CultureInfo.InvariantCulture)),
            new NpgsqlParameter("code", StatutCdv.DemandePaiementDirect), new NpgsqlParameter("sens", SensStatut.Recu)).ToListAsync(ct)).Select(x => (DateTime?)x).FirstOrDefault();
        if (recue is DateTime d) await DeclarerAsync(db, ent, DateOnly.FromDateTime(d.ToUniversalTime()), par, ct);
    }
}
