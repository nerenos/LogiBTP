using System.Globalization;
using LogiBTP.Domaine;
using LogiBTP.FactureElectronique;
using LogiBTP.FactureElectronique.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Statuts posés par la société sur une facture reçue (plans/facturation-electronique.md, lot 13) : Prise en charge (204)
/// à la création du brouillon (<see cref="ALaCreation"/>, posée par le module dans la transaction de la réception),
/// Approuvée (205) à la validation de la pièce (<see cref="SpecialisationBtp.ApresValidationAsync"/>), Paiement transmis
/// (211) au premier règlement émis qui la pointe (<see cref="SpecialisationReglementBtp.ApresPointageAsync"/>) ; En litige
/// (207) et Refusée (210) par les boutons de la page document (route du module POST /flux/{id}/statut). Chaque statut est
/// contrôlé par <c>ReglesCycleVie</c> (refus impossible après Approuvée), écrit en CDAR mis en file (sauf statut non
/// envoyé des paramètres) et inscrit au journal par <see cref="ServiceFactureElectronique.PoserAsync"/>. Un statut déjà
/// posé ou qui ne peut plus l'être (facture refusée…) est ignoré ; une erreur n'empêche jamais la validation ni le règlement.
/// </summary>
public sealed class StatutsReceptionBtp(IServiceProvider services, ILogger journal)
{
    /// <summary>Origine notée au journal des statuts posés par l'application.</summary>
    public const string OrigineCreation = "CREATION", OrigineValidation = "VALIDATION", OrigineReglement = "REGLEMENT";

    /// <summary>Statuts posés à la création (ou à la reprise) du brouillon d'une facture reçue : Prise en charge.</summary>
    public static IReadOnlyList<StatutAPoser> ALaCreation(long ent, bool reprise = false) =>
        [new(StatutCdv.PriseEnCharge) { Origine = new { evenement = OrigineCreation, ent_id = ent, reprise } }];

    private sealed record LigneFlux(long Id);

    /// <summary>
    /// Pièces payées par un règlement émis parmi des échéances touchées : pointages positifs d'un décaissement (sens D) qui
    /// n'est pas une imputation d'avoir. Lu dans la transaction du règlement (contexte du module Règlements).
    /// </summary>
    public static async Task<List<long>> PiecesPayeesAsync(DbContext db, IReadOnlyCollection<long> echeances, CancellationToken ct)
    {
        if (echeances.Count == 0) return [];
        return await db.Database.SqlQueryRaw<long>("""
            SELECT DISTINCT e.ech_ent_id AS "Value" FROM document_echeance e
            JOIN pointage p ON p.poi_echeance_id = e.ech_id JOIN reglement r ON r.reg_id = p.poi_reg_id
            WHERE e.ech_id = ANY(@ids) AND r.reg_sens = 'D' AND r.reg_mode <> @imputation AND p.poi_montant > 0
            """, new NpgsqlParameter("ids", echeances.Distinct().ToArray()),
            new NpgsqlParameter("imputation", LogiBTP.Reglements.ModeReglementSysteme.Imputation)).ToListAsync(ct);
    }

    /// <summary>Approuvée (205) posée sur la facture reçue d'une pièce validée ; vrai si posée.</summary>
    public Task<bool> ApprouverAsync(long ent, string? utilisateur, CancellationToken ct) =>
        PoserAsync(ent, StatutCdv.Approuvee, OrigineValidation, utilisateur, ct);

    /// <summary>Paiement transmis (211) posé sur la facture reçue de chaque pièce payée ; nombre de statuts posés.</summary>
    public async Task<int> PaiementTransmisAsync(IEnumerable<long> pieces, string? utilisateur, CancellationToken ct)
    {
        var n = 0;
        foreach (var ent in pieces.Distinct())
            if (await PoserAsync(ent, StatutCdv.PaiementTransmis, OrigineReglement, utilisateur, ct)) n++;
        return n;
    }

    /// <summary>
    /// Statut posé sur le dernier flux reçu rattaché à la pièce : module actif, facture connue, statut pas encore posé et
    /// encore posable (<c>ReglesCycleVie.StatutsPosables</c>). Refus du module : journalisé, faux.
    /// </summary>
    private async Task<bool> PoserAsync(long ent, string code, string origine, string? utilisateur, CancellationToken ct)
    {
        try
        {
            if (services.GetService<ModulesSociete>() is { } modules && !await modules.EstActifAsync(ModulesFacultatifs.FactureElectronique, ct)) return false;
            if (services.GetService<ServiceFactureElectronique>() is not { } fe) return false;
            var id = ent.ToString(CultureInfo.InvariantCulture);
            var flux = await fe.Db.Flux.Where(f => f.FflSens == SensFlux.Entrant && f.FflTypeElement == TypesElementFe.Document && f.FflIdElement == id
                    && (f.FflType == TypeFlux.FactureFournisseur || f.FflType == TypeFlux.FactureClient) && f.FflNumero != null)
                .OrderByDescending(f => f.FflId).FirstOrDefaultAsync(ct);
            if (flux is null) return false;
            var historique = await fe.HistoriqueAsync(flux.FflId, flux.FflNumero!, ct);
            if (historique.Contains(code) || !ReglesCycleVie.StatutsPosables(SensFacture.Recue, historique).Contains(code)) return false;
            await fe.PoserStatutApplicationAsync(flux.FflId, new StatutAPoser(code) { Origine = new { evenement = origine, ent_id = ent } }, utilisateur, ct);
            return true;
        }
        catch (Exception e) when (e is ExceptionMetier or DbUpdateException or PostgresException)
        {
            journal.LogWarning("Facturation électronique : statut {Statut} non posé pour la pièce {Piece} ({Erreur})", code, ent, Masquage.Texte(e.Message));
            return false;
        }
    }
}
