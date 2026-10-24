using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.SousTraitance.Web;

public class PieceTypeEntite
{
    public string SptCode { get; set; } = "";
    public string SptLibelle { get; set; } = "";
    public string SptPortee { get; set; } = "TIERS";
    public string? SptCategorie { get; set; }
    public bool SptObligatoire { get; set; } = true;
    public int? SptDureeMois { get; set; }
    public int SptRappelJours { get; set; }
    public string[] SptBloquant { get; set; } = [];
    public bool? SptCondPublic { get; set; }
    public string? SptCondGarantie { get; set; }
    public decimal? SptCondMontantMin { get; set; }
    public string? SptModeleEdition { get; set; }
    public int SptOrdre { get; set; }
    public bool SptActif { get; set; } = true;
    public string? SptMajPar { get; set; }
    public DateTimeOffset SptMajLe { get; set; } = DateTimeOffset.UtcNow;
}

public class PieceElementEntite
{
    public string SpeTypeElement { get; set; } = "";
    public string SpeIdElement { get; set; } = "";
    public string SpeCode { get; set; } = "";
    public string SpeMode { get; set; } = "AJOUTEE";
    public string? SpeMotif { get; set; }
    public string SpePar { get; set; } = "";
    public DateTimeOffset SpeLe { get; set; } = DateTimeOffset.UtcNow;
}

public class SousTraitanceDbContext(DbContextOptions<SousTraitanceDbContext> options) : DbContext(options)
{
    public DbSet<PieceTypeEntite> PiecesTypes => Set<PieceTypeEntite>();
    public DbSet<PieceElementEntite> PiecesElements => Set<PieceElementEntite>();
    public DbSet<PaiementDirectEntite> PaiementsDirects => Set<PaiementDirectEntite>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<PieceTypeEntite>().ToTable("stt_piece_type").HasKey(x => x.SptCode);
        b.Entity<PieceElementEntite>().ToTable("stt_piece_element").HasKey(x => new { x.SpeTypeElement, x.SpeIdElement, x.SpeCode });
        b.Entity<PaiementDirectEntite>().ToTable("stt_paiement_direct").HasKey(x => x.SpdId);
    }
}

public sealed record PieceTypeDto(string Code, string Libelle, string Portee, string? Categorie, bool Obligatoire, int? DureeMois, int RappelJours,
    List<string> Bloquant, bool? CondPublic, string? CondGarantie, decimal? CondMontantMin, string? ModeleEdition, int Ordre, bool Actif);
public sealed record AjustementSaisi(string? Mode, string? Motif);
public sealed record ValiditeSaisie(DateOnly? ValideAu);

/// <summary>Marché de sous-traitance vu par le module : sous-traitant, public, garantie, montant HT, libellé, montant agréé, autoliquidation.</summary>
public sealed record MarcheSousTraitance(int Id, long? TiersId, bool Public, string? Garantie, decimal MontantHt, string? Libelle, decimal? MontantAgree = null,
    bool Autoliquidation = true);

/// <summary>
/// Spécialisation par l'application (méthode patron) : marchés de sous-traitance, pièces fournies (documents de la GED
/// du sous-traitant et du marché), validité d'une pièce ; factures du paiement direct et lien à la facture au client.
/// </summary>
public abstract class SpecialisationSousTraitance
{
    public abstract Task<MarcheSousTraitance?> MarcheAsync(SousTraitanceDbContext db, int id, CancellationToken ct);
    /// <summary>Pièces du sous-traitant (portée TIERS) et, si un marché est donné, du marché (portée MARCHE).</summary>
    public abstract Task<List<PieceFournie>> PiecesAsync(SousTraitanceDbContext db, long tiers, int? marche, CancellationToken ct);
    /// <summary>Fin de validité saisie d'une pièce (document de la GED).</summary>
    public abstract Task DefinirValiditeAsync(SousTraitanceDbContext db, long piece, DateOnly? valideAu, Utilisateur u, CancellationToken ct);
    /// <summary>Facture (ou avoir) de sous-traitance et son marché.</summary>
    public abstract Task<FactureSousTraitance?> FactureAsync(SousTraitanceDbContext db, long id, CancellationToken ct);
    /// <summary>Factures de sous-traitance du marché, dans l'ordre.</summary>
    public abstract Task<List<FactureSousTraitance>> FacturesAsync(SousTraitanceDbContext db, int marche, CancellationToken ct);
    /// <summary>Factures au client qui peuvent porter le paiement direct d'un marché (marché de vente lié, sinon chantier).</summary>
    public abstract Task<List<FactureClient>> FacturesClientsAsync(SousTraitanceDbContext db, int marche, CancellationToken ct);
    /// <summary>Lien entre la facture de sous-traitance et la facture au client qui porte la déduction (poste du sous-traitant).</summary>
    public abstract Task LierAsync(SousTraitanceDbContext db, long facture, long factureClient, Utilisateur u, CancellationToken ct);
    /// <summary>Après l'enregistrement d'une demande (suivi du délai d'acceptation : tâche, notification).</summary>
    public virtual Task ApresDemandeAsync(SousTraitanceDbContext db, DemandePaiement d, FactureSousTraitance f, Utilisateur u, CancellationToken ct) => Task.CompletedTask;
}

/// <summary>
/// Pièces exigées (liste paramétrable), ajustements par élément (ajoutée, dispensée), conformité d'un marché ou d'un
/// sous-traitant (<see cref="ReglesConformite"/>), pièces bloquantes d'une action.
/// </summary>
public sealed class ServiceSousTraitance(SousTraitanceDbContext db, SpecialisationSousTraitance specialisation)
{
    private static Exigence Regle(PieceTypeEntite e) => new(e.SptCode, e.SptLibelle, e.SptPortee, e.SptCategorie, e.SptObligatoire, e.SptDureeMois,
        e.SptRappelJours, e.SptBloquant, e.SptCondPublic, e.SptCondGarantie, e.SptCondMontantMin, e.SptOrdre, e.SptActif);

    public async Task<List<PieceTypeDto>> TypesAsync(CancellationToken ct) =>
        (await db.PiecesTypes.AsNoTracking().OrderBy(x => x.SptOrdre).ThenBy(x => x.SptCode).ToListAsync(ct))
        .Select(e => new PieceTypeDto(e.SptCode, e.SptLibelle, e.SptPortee, e.SptCategorie, e.SptObligatoire, e.SptDureeMois, e.SptRappelJours, [.. e.SptBloquant],
            e.SptCondPublic, e.SptCondGarantie, e.SptCondMontantMin, e.SptModeleEdition, e.SptOrdre, e.SptActif)).ToList();

    /// <summary>Liste complète des pièces exigées (administrateur) : une pièce retirée est supprimée avec ses ajustements.</summary>
    public async Task<List<PieceTypeDto>> EnregistrerTypesAsync(List<PieceTypeDto> l, Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
        foreach (var p in l)
        {
            if (string.IsNullOrWhiteSpace(p.Code) || string.IsNullOrWhiteSpace(p.Libelle)) throw ExceptionMetier.Invalide("STT_PIECE", "Code et libellé de la pièce obligatoires");
            if (p.Portee is not ("TIERS" or "MARCHE")) throw ExceptionMetier.Invalide("STT_PORTEE", $"{p.Libelle} : portée inconnue");
            if (p.Bloquant.Any(b => !ReglesConformite.Actions.Contains(b))) throw ExceptionMetier.Invalide("STT_BLOQUANT", $"{p.Libelle} : action bloquée inconnue");
            if (p.DureeMois is <= 0 || p.RappelJours < 0) throw ExceptionMetier.Invalide("STT_DUREE", $"{p.Libelle} : durée ou rappel invalide");
        }
        var codes = l.Select(p => p.Code.Trim().ToLowerInvariant()).ToList();
        if (codes.Distinct().Count() != codes.Count) throw ExceptionMetier.Invalide("STT_DOUBLON", "Même pièce deux fois");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.PiecesTypes.Where(x => !codes.Contains(x.SptCode)).ExecuteDeleteAsync(ct);
        var existants = await db.PiecesTypes.ToListAsync(ct);
        foreach (var (p, i) in l.Select((p, i) => (p, i)))
        {
            var code = p.Code.Trim().ToLowerInvariant();
            var x = existants.FirstOrDefault(e => e.SptCode == code);
            if (x is null) db.PiecesTypes.Add(x = new PieceTypeEntite { SptCode = code });
            (x.SptLibelle, x.SptPortee, x.SptCategorie, x.SptObligatoire, x.SptDureeMois, x.SptRappelJours) =
                (p.Libelle.Trim(), p.Portee, string.IsNullOrWhiteSpace(p.Categorie) ? code : p.Categorie.Trim(), p.Obligatoire, p.DureeMois, p.RappelJours);
            (x.SptBloquant, x.SptCondPublic, x.SptCondGarantie, x.SptCondMontantMin, x.SptModeleEdition) =
                (p.Bloquant.Distinct().ToArray(), p.CondPublic, string.IsNullOrWhiteSpace(p.CondGarantie) ? null : p.CondGarantie, p.CondMontantMin, p.ModeleEdition);
            (x.SptOrdre, x.SptActif, x.SptMajPar, x.SptMajLe) = (p.Ordre == 0 ? (i + 1) * 10 : p.Ordre, p.Actif, u.Code, DateTimeOffset.UtcNow);
        }
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await TypesAsync(ct);
    }

    private async Task<List<Ajustement>> AjustementsAsync(string type, string id, CancellationToken ct) =>
        (await db.PiecesElements.AsNoTracking().Where(x => x.SpeTypeElement == type && x.SpeIdElement == id).ToListAsync(ct))
        .Select(x => new Ajustement(x.SpeCode, x.SpeMode, x.SpeMotif)).ToList();

    /// <summary>Conformité d'un marché de sous-traitance : pièces du sous-traitant et du marché ; ajustements des deux.</summary>
    public async Task<Conformite> ConformiteMarcheAsync(int marche, CancellationToken ct)
    {
        var m = await specialisation.MarcheAsync(db, marche, ct) ?? throw ExceptionMetier.Introuvable($"Marché de sous-traitance {marche}");
        var exigences = (await db.PiecesTypes.AsNoTracking().ToListAsync(ct)).Select(Regle).ToList();
        var pieces = m.TiersId is long t ? await specialisation.PiecesAsync(db, t, marche, ct) : [];
        var ajustements = (m.TiersId is long t2 ? await AjustementsAsync("personne", t2.ToString(), ct) : [])
            .Concat(await AjustementsAsync("marche", marche.ToString(), ct)).ToList();
        return ReglesConformite.Calculer(exigences, pieces, ajustements, new ContexteMarche(m.Public, m.Garantie, m.MontantHt), DateOnly.FromDateTime(DateTime.Today));
    }

    /// <summary>Conformité d'un sous-traitant seul (pièces annexes de portée TIERS).</summary>
    public async Task<Conformite> ConformiteTiersAsync(long tiers, CancellationToken ct)
    {
        var exigences = (await db.PiecesTypes.AsNoTracking().ToListAsync(ct)).Select(Regle).ToList();
        return ReglesConformite.Calculer(exigences, await specialisation.PiecesAsync(db, tiers, null, ct), await AjustementsAsync("personne", tiers.ToString(), ct),
            new ContexteMarche(), DateOnly.FromDateTime(DateTime.Today), ["TIERS"]);
    }

    /// <summary>Pièces qui bloquent une action (COMMANDE, FACTURE, PAIEMENT) sur un marché : libellés (vide : rien ne bloque).</summary>
    public async Task<List<string>> BloquantsAsync(int marche, string action, CancellationToken ct)
    {
        var c = await ConformiteMarcheAsync(marche, ct);
        return c.Bloquants.TryGetValue(action, out var codes) ? c.Pieces.Where(p => codes.Contains(p.Code)).Select(p => $"{p.Libelle} ({(p.Etat == "EXPIREE" ? "expirée" : "manquante")})").ToList() : [];
    }

    /// <summary>Pièce ajoutée ou dispensée sur un marché ou un sous-traitant (mode vide : ajustement retiré) ; motif obligatoire pour dispenser.</summary>
    public async Task AjusterAsync(string type, string id, string code, AjustementSaisi s, Utilisateur u, CancellationToken ct)
    {
        if (type is not ("marche" or "personne")) throw ExceptionMetier.Invalide("STT_ELEMENT", $"Élément inconnu : {type}");
        if (!await db.PiecesTypes.AnyAsync(x => x.SptCode == code, ct)) throw ExceptionMetier.Introuvable($"Pièce {code}");
        var x = await db.PiecesElements.FirstOrDefaultAsync(e => e.SpeTypeElement == type && e.SpeIdElement == id && e.SpeCode == code, ct);
        if (string.IsNullOrEmpty(s.Mode))
        {
            if (x is not null) db.PiecesElements.Remove(x);
        }
        else
        {
            if (s.Mode is not ("AJOUTEE" or "DISPENSEE")) throw ExceptionMetier.Invalide("STT_MODE", $"Mode inconnu : {s.Mode}");
            if (s.Mode == "DISPENSEE" && string.IsNullOrWhiteSpace(s.Motif)) throw ExceptionMetier.Invalide("STT_MOTIF", "Motif obligatoire pour dispenser une pièce");
            if (x is null) db.PiecesElements.Add(x = new PieceElementEntite { SpeTypeElement = type, SpeIdElement = id, SpeCode = code });
            (x.SpeMode, x.SpeMotif, x.SpePar, x.SpeLe) = (s.Mode, s.Motif?.Trim(), u.Code, DateTimeOffset.UtcNow);
        }
        await db.SaveChangesAsync(ct);
    }

    public Task DefinirValiditeAsync(long piece, DateOnly? valideAu, Utilisateur u, CancellationToken ct) => specialisation.DefinirValiditeAsync(db, piece, valideAu, u, ct);
}

/// <summary>Branchement du module Sous-traitance (facultatif : activé par société).</summary>
public static class Extensions
{
    public static IServiceCollection AddModuleSousTraitance<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options)
        where TSpecialisation : SpecialisationSousTraitance
    {
        services.AddDbContext<SousTraitanceDbContext>(options);
        services.AddSingleton<SpecialisationSousTraitance, TSpecialisation>();
        services.AddScoped<ServiceSousTraitance>();
        services.AddScoped<ServicePaiementDirect>();
        return services;
    }

    /// <summary>Routes HTTP du module, sous /sous-traitance ; renvoie le groupe (filtre d'activation posé par l'application).</summary>
    public static RouteGroupBuilder MapModuleSousTraitance(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/sous-traitance");
        g.MapGet("/pieces-types", (ServiceSousTraitance s, CancellationToken ct) => s.TypesAsync(ct));
        g.MapPut("/pieces-types", (List<PieceTypeDto> l, HttpContext http, ServiceSousTraitance s, CancellationToken ct) => s.EnregistrerTypesAsync(l, Utilisateur.Depuis(http), ct));
        g.MapGet("/marches/{id:int}/conformite", (int id, ServiceSousTraitance s, CancellationToken ct) => s.ConformiteMarcheAsync(id, ct));
        g.MapGet("/tiers/{id:long}/conformite", (long id, ServiceSousTraitance s, CancellationToken ct) => s.ConformiteTiersAsync(id, ct));
        g.MapPut("/elements/{type}/{id}/pieces/{code}", async (string type, string id, string code, AjustementSaisi a, HttpContext http, ServiceSousTraitance s, CancellationToken ct) =>
        {
            await s.AjusterAsync(type, id, code, a, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapPut("/pieces/{dge:long}/validite", async (long dge, ValiditeSaisie v, HttpContext http, ServiceSousTraitance s, CancellationToken ct) =>
        {
            await s.DefinirValiditeAsync(dge, v.ValideAu, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        // Paiement direct (marché public) et délégation de paiement (marché privé).
        g.MapGet("/marches/{id:int}/paiements", (int id, ServicePaiementDirect s, CancellationToken ct) => s.SuiviAsync(id, ct));
        g.MapPost("/factures/{id:long}/paiement", (long id, DemandeSaisie d, HttpContext http, ServicePaiementDirect s, CancellationToken ct) => s.DeclarerAsync(id, d, Utilisateur.Depuis(http), ct));
        g.MapPost("/paiements/{id:long}/accepter", (long id, AcceptationSaisie a, HttpContext http, ServicePaiementDirect s, CancellationToken ct) => s.AccepterAsync(id, a, Utilisateur.Depuis(http), ct));
        g.MapPost("/paiements/{id:long}/transmettre", (long id, TransmissionSaisie t, HttpContext http, ServicePaiementDirect s, CancellationToken ct) => s.TransmettreAsync(id, t, Utilisateur.Depuis(http), ct));
        g.MapPost("/paiements/{id:long}/payer", (long id, PaiementSaisi p, HttpContext http, ServicePaiementDirect s, CancellationToken ct) => s.PayerAsync(id, p, Utilisateur.Depuis(http), ct));
        g.MapDelete("/paiements/{id:long}", async (long id, HttpContext http, ServicePaiementDirect s, CancellationToken ct) =>
        {
            await s.SupprimerAsync(id, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        return g;
    }
}
