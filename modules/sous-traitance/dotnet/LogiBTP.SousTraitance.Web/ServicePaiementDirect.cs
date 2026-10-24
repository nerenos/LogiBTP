using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.SousTraitance.Web;

public class PaiementDirectEntite
{
    public long SpdId { get; set; }
    public long SpdFactureId { get; set; }
    public long? SpdFactureClientId { get; set; }
    public int SpdMarcheId { get; set; }
    public string SpdMode { get; set; } = "DIRECT";
    public decimal SpdMontantDemande { get; set; }
    public decimal? SpdMontantAccepte { get; set; }
    public string SpdEtat { get; set; } = "RECUE";
    public DateOnly SpdRecueLe { get; set; }
    public string? SpdMotif { get; set; }
    public DateOnly? SpdAccepteLe { get; set; }
    public DateOnly? SpdTransmiseLe { get; set; }
    public DateOnly? SpdPayeeLe { get; set; }
    public string SpdMajPar { get; set; } = "";
    public DateTimeOffset SpdMajLe { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Facture de sous-traitance vue par le module : marché, numéros, montants, validée, annulée.</summary>
public sealed record FactureSousTraitance(long Id, int MarcheId, string? Numero, string? Reference, DateOnly? Date, decimal Ht, decimal Ttc, bool Valide, bool Annule);
/// <summary>Facture au client sur laquelle porter la déduction (marché de vente lié ou chantier).</summary>
public sealed record FactureClient(long Id, string? Numero, DateOnly? Date, decimal Ttc, bool Valide);

public sealed record DemandeSaisie(DateOnly? RecueLe, long? FactureClientId, decimal? Montant);
public sealed record AcceptationSaisie(decimal Montant, string? Motif, DateOnly? Le);
public sealed record TransmissionSaisie(DateOnly? Le, long? FactureClientId);
public sealed record PaiementSaisi(DateOnly? Le);

public sealed record DemandePaiement(long Id, long FactureId, long? FactureClientId, string Mode, decimal MontantDemande, decimal? MontantAccepte, string Etat,
    DateOnly RecueLe, DelaiAcceptation Delai, string? Motif, DateOnly? AccepteLe, DateOnly? TransmiseLe, DateOnly? PayeeLe, string MajPar);
public sealed record LigneFacturePaiement(FactureSousTraitance Facture, decimal MontantPropose, DemandePaiement? Demande);
public sealed record SuiviPaiementDirect(string? Mode, decimal? MontantAgree, decimal CumulAccepte, decimal? ResteAgree, decimal CumulPaye,
    List<LigneFacturePaiement> Factures, List<FactureClient> FacturesClients);

/// <summary>
/// Paiement direct (marché public) ou délégation de paiement (marché privé) d'un sous-traitant (ANALYSE § 5.5, ST14 à
/// ST16) : demande reçue d'une facture validée, acceptation dans les 15 jours (totale ou partielle motivée, cumul ≤
/// montant agréé : <see cref="ReglesPaiementDirect"/>), transmission au maître d'ouvrage avec la facture au client qui
/// porte la déduction (paiement direct seulement), paiement constaté.
/// </summary>
public sealed class ServicePaiementDirect(SousTraitanceDbContext db, SpecialisationSousTraitance specialisation)
{
    private static readonly string[] Acceptees = ["ACCEPTEE", "PARTIELLE", "TRANSMISE", "PAYEE"];
    private static DateOnly Aujourdhui => DateOnly.FromDateTime(DateTime.Today);

    private static string? Mode(MarcheSousTraitance m) => m.Garantie switch { "PAIEMENT_DIRECT" => "DIRECT", "DELEGATION" => "DELEGATION", _ => null };

    private static DemandePaiement Dto(PaiementDirectEntite e) => new(e.SpdId, e.SpdFactureId, e.SpdFactureClientId, e.SpdMode, e.SpdMontantDemande, e.SpdMontantAccepte,
        e.SpdEtat, e.SpdRecueLe, ReglesPaiementDirect.Delai(e.SpdRecueLe, Aujourdhui), e.SpdMotif, e.SpdAccepteLe, e.SpdTransmiseLe, e.SpdPayeeLe, e.SpdMajPar);

    private async Task<MarcheSousTraitance> MarcheAsync(int marche, CancellationToken ct) =>
        await specialisation.MarcheAsync(db, marche, ct) ?? throw ExceptionMetier.Introuvable($"Marché de sous-traitance {marche}");

    /// <summary>Factures du marché et leur demande, cumuls (accepté, payé, reste agréé), factures au client proposées.</summary>
    public async Task<SuiviPaiementDirect> SuiviAsync(int marche, CancellationToken ct)
    {
        var m = await MarcheAsync(marche, ct);
        var demandes = await db.PaiementsDirects.AsNoTracking().Where(x => x.SpdMarcheId == marche).ToListAsync(ct);
        var factures = await specialisation.FacturesAsync(db, marche, ct);
        var cumul = demandes.Where(d => Acceptees.Contains(d.SpdEtat)).Sum(d => d.SpdMontantAccepte ?? 0);
        var paye = demandes.Where(d => d.SpdEtat == "PAYEE").Sum(d => d.SpdMontantAccepte ?? 0);
        return new(Mode(m), m.MontantAgree, cumul, m.MontantAgree is decimal a ? Math.Max(0, a - cumul) : null, paye,
            factures.Select(f => new LigneFacturePaiement(f, ReglesPaiementDirect.Montant(f.Ht, f.Ttc, m.Autoliquidation),
                demandes.FirstOrDefault(d => d.SpdFactureId == f.Id) is { } d ? Dto(d) : null)).ToList(),
            Mode(m) == "DIRECT" ? await specialisation.FacturesClientsAsync(db, marche, ct) : []);
    }

    /// <summary>Demande de paiement reçue pour une facture validée du marché (montant proposé : TTC, HT en autoliquidation).</summary>
    public async Task<DemandePaiement> DeclarerAsync(long facture, DemandeSaisie s, Utilisateur u, CancellationToken ct)
    {
        var f = await specialisation.FactureAsync(db, facture, ct) ?? throw ExceptionMetier.Introuvable($"Facture de sous-traitance {facture}");
        var m = await MarcheAsync(f.MarcheId, ct);
        var mode = Mode(m) ?? throw ExceptionMetier.Invalide("PD_GARANTIE", "Le marché n'est ni en paiement direct ni en délégation de paiement");
        if (!f.Valide || f.Annule) throw ExceptionMetier.Invalide("PD_FACTURE", "Seule une facture validée du sous-traitant fait l'objet d'une demande de paiement");
        if (await db.PaiementsDirects.AnyAsync(x => x.SpdFactureId == facture, ct)) throw ExceptionMetier.Conflit("PD_EXISTE", "Une demande existe déjà pour cette facture");
        var montant = s.Montant ?? ReglesPaiementDirect.Montant(f.Ht, f.Ttc, m.Autoliquidation);
        if (montant <= 0) throw ExceptionMetier.Invalide("PD_NEGATIF", "Montant de la demande positif");
        var e = new PaiementDirectEntite
        {
            SpdFactureId = facture, SpdMarcheId = f.MarcheId, SpdMode = mode, SpdMontantDemande = montant, SpdRecueLe = s.RecueLe ?? Aujourdhui,
            SpdFactureClientId = mode == "DIRECT" ? s.FactureClientId : null, SpdMajPar = u.Code,
        };
        db.PaiementsDirects.Add(e);
        await db.SaveChangesAsync(ct);
        await specialisation.ApresDemandeAsync(db, Dto(e), f, u, ct);
        return Dto(e);
    }

    private async Task<PaiementDirectEntite> DemandeAsync(long id, CancellationToken ct) =>
        await db.PaiementsDirects.FirstOrDefaultAsync(x => x.SpdId == id, ct) ?? throw ExceptionMetier.Introuvable($"Demande de paiement {id}");

    /// <summary>Acceptation totale, partielle (motif) ou refus (montant 0, motif) ; cumul accepté plafonné par le montant agréé.</summary>
    public async Task<DemandePaiement> AccepterAsync(long id, AcceptationSaisie s, Utilisateur u, CancellationToken ct)
    {
        var e = await DemandeAsync(id, ct);
        if (e.SpdEtat is "TRANSMISE" or "PAYEE") throw ExceptionMetier.Invalide("PD_ETAT", "Demande déjà transmise au maître d'ouvrage");
        var m = await MarcheAsync(e.SpdMarcheId, ct);
        var precedent = await db.PaiementsDirects.Where(x => x.SpdMarcheId == e.SpdMarcheId && x.SpdId != id && Acceptees.Contains(x.SpdEtat))
            .SumAsync(x => x.SpdMontantAccepte ?? 0, ct);
        var r = ReglesPaiementDirect.Controler(e.SpdMontantDemande, s.Montant, precedent, e.SpdMode == "DIRECT" ? m.MontantAgree : null, s.Motif);
        if (r.Erreurs.Count > 0) throw ExceptionMetier.Invalide(r.Erreurs[0], string.Join(" ; ", r.Erreurs.Select(ReglesPaiementDirect.Message)));
        (e.SpdMontantAccepte, e.SpdEtat, e.SpdMotif, e.SpdAccepteLe, e.SpdMajPar, e.SpdMajLe) =
            (s.Montant, r.Etat, string.IsNullOrWhiteSpace(s.Motif) ? null : s.Motif.Trim(), s.Le ?? Aujourdhui, u.Code, DateTimeOffset.UtcNow);
        await db.SaveChangesAsync(ct);
        return Dto(e);
    }

    /// <summary>Transmission au maître d'ouvrage : paiement direct = facture au client qui porte la déduction (liée ici).</summary>
    public async Task<DemandePaiement> TransmettreAsync(long id, TransmissionSaisie s, Utilisateur u, CancellationToken ct)
    {
        var e = await DemandeAsync(id, ct);
        if (e.SpdEtat is not ("ACCEPTEE" or "PARTIELLE")) throw ExceptionMetier.Invalide("PD_ETAT", "Seule une demande acceptée se transmet");
        if (e.SpdMode == "DIRECT")
        {
            var client = s.FactureClientId ?? e.SpdFactureClientId ?? throw ExceptionMetier.Invalide("PD_FACTURE_CLIENT", "Choisir la facture au client qui porte le paiement direct");
            var proposees = await specialisation.FacturesClientsAsync(db, e.SpdMarcheId, ct);
            var fc = proposees.FirstOrDefault(x => x.Id == client) ?? throw ExceptionMetier.Invalide("PD_FACTURE_CLIENT", "Facture au client hors du marché de vente lié");
            if (fc.Valide && e.SpdFactureClientId != client) throw ExceptionMetier.Invalide("PD_FACTURE_VALIDEE", $"La facture {fc.Numero} est validée : la déduction ne peut plus y être portée");
            e.SpdFactureClientId = client;
        }
        (e.SpdEtat, e.SpdTransmiseLe, e.SpdMajPar, e.SpdMajLe) = ("TRANSMISE", s.Le ?? Aujourdhui, u.Code, DateTimeOffset.UtcNow);
        await db.SaveChangesAsync(ct);
        // Après l'enregistrement : la déduction posée sur notre facture lit les demandes transmises.
        if (e.SpdFactureClientId is long fc2 && e.SpdMode == "DIRECT") await specialisation.LierAsync(db, e.SpdFactureId, fc2, u, ct);
        return Dto(e);
    }

    /// <summary>Paiement constaté du sous-traitant par le maître d'ouvrage.</summary>
    public async Task<DemandePaiement> PayerAsync(long id, PaiementSaisi s, Utilisateur u, CancellationToken ct)
    {
        var e = await DemandeAsync(id, ct);
        if (e.SpdEtat != "TRANSMISE") throw ExceptionMetier.Invalide("PD_ETAT", "Seule une demande transmise est payée");
        (e.SpdEtat, e.SpdPayeeLe, e.SpdMajPar, e.SpdMajLe) = ("PAYEE", s.Le ?? Aujourdhui, u.Code, DateTimeOffset.UtcNow);
        await db.SaveChangesAsync(ct);
        return Dto(e);
    }

    /// <summary>Demande supprimée tant qu'elle n'est pas transmise (lien de paiement direct retiré).</summary>
    public async Task SupprimerAsync(long id, Utilisateur u, CancellationToken ct)
    {
        var e = await DemandeAsync(id, ct);
        if (e.SpdEtat is "TRANSMISE" or "PAYEE") throw ExceptionMetier.Invalide("PD_ETAT", "Demande déjà transmise au maître d'ouvrage");
        db.PaiementsDirects.Remove(e);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Demandes non traitées dont l'échéance d'acceptation approche (J-3) ou est dépassée.</summary>
    public async Task<List<DemandePaiement>> AEcheanceAsync(CancellationToken ct) =>
        (await db.PaiementsDirects.AsNoTracking().Where(x => x.SpdEtat == "RECUE").ToListAsync(ct)).Select(Dto).Where(d => d.Delai.Alerte).ToList();
}
