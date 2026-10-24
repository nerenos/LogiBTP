using System.Globalization;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Builder;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Stock.Web;

public class SeuilEntite
{
    public long SseEleId { get; set; }
    public long SseLieuId { get; set; }
    public decimal? SseMini { get; set; }
    public decimal? SseMaxi { get; set; }
    public int? SseDelaiJours { get; set; }
}

public class LieuParametreEntite
{
    public long SlpLieuId { get; set; }
    public int SlpDelaiJours { get; set; } = 7;
    public int SlpFriseJours { get; set; } = 56;
}

/// <summary>Événement prévu fourni par l'application : SORTIE (reste d'une réservation) ou ENTREE (reste à recevoir d'une commande), en unité de stock.</summary>
public sealed record PrevisionStock(long Ele, string Type, DateOnly Date, decimal Quantite, long EntId, string? Numero, string TypePiece, string? Tiers, string? Chantier);

/// <summary>Approvisionnement d'un article : fournisseur principal, unité d'achat, conditionnement (quantité en unité de stock d'une unité d'achat), prix.</summary>
public sealed record ApproArticle(long Ele, long? FournisseurId, string? Fournisseur, string? UniteAchat, decimal Conditionnement, decimal? Prix);

public sealed record LigneACommander(long Ele, decimal UnitesAchat, long? FournisseurId);
public sealed record CommandeCreee(long EntId, string? Numero, string? Fournisseur, int Lignes);

public sealed record ParametresLieuDto(long Lieu, int DelaiJours, int FriseJours);
public sealed record SeuilDto(long Ele, string? Code, string? Libelle, string? Unite, decimal? Mini, decimal? Maxi, int? DelaiJours);
public sealed record EvenementDto(string Id, string Type, string Date, decimal Quantite, long EntId, string? Numero, string TypePiece, string? Tiers, string? Chantier, bool Retard);
public sealed record ProjectionArticle(long Lieu, long Ele, string Code, string Libelle, string Unite, int Precision, string Aujourdhui, decimal Stock,
    List<EvenementDto> Evenements, Projection Projection, SeuilDto? Seuil, string Horizon, decimal MinimumHorizon, Proposition? Proposition, ApproArticle? Appro);
public sealed record LigneSynthese(long Ele, string Code, string Libelle, string Unite, int Precision, decimal Stock, decimal Reserve, decimal Attendu,
    decimal Disponible, string? PremiereRupture, decimal Minimum, string? MinimumDate, decimal? Mini, decimal? Maxi, string Horizon, decimal MinimumHorizon,
    Proposition? Proposition, ApproArticle? Appro, int Retards);
public sealed record CommandeSaisie(List<LigneACommander>? Lignes);

/// <summary>
/// Approvisionnement (ANALYSE-MODULE-STOCK.md § 5.4, S13 à S15) : seuils mini / maxi et délai par article et lieu,
/// paramètres du lieu, projection d'un article (ReglesProjection : ruptures, réservations non honorées), synthèse des
/// articles d'un lieu (réservé, attendu, disponible, première rupture), propositions de commande sous le mini à
/// l'horizon (délai de l'article, sinon du lieu ; conditionnement de l'unité d'achat), création des commandes.
/// </summary>
public class ServiceApprovisionnement(StockDbContext db, SpecialisationStock specialisation, ServiceStock stock)
{
    private static string J(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private async Task ExigerGestion(Utilisateur u, CancellationToken ct)
    {
        if (!await specialisation.PeutGererAsync(db, u, ct)) throw ExceptionMetier.AccesRefuse("GERER_STOCK");
    }

    public async Task<ParametresLieuDto> ParametresLieuAsync(long lieu, CancellationToken ct)
    {
        var p = await db.LieuxParametres.AsNoTracking().FirstOrDefaultAsync(x => x.SlpLieuId == lieu, ct) ?? new LieuParametreEntite { SlpLieuId = lieu };
        return new(lieu, p.SlpDelaiJours, p.SlpFriseJours);
    }

    public async Task<ParametresLieuDto> EnregistrerParametresLieuAsync(long lieu, ParametresLieuDto s, Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        if (s.DelaiJours < 0 || s.FriseJours <= 0) throw ExceptionMetier.Invalide("STK_HORIZON", "Délai positif ou nul, frise positive");
        var p = await db.LieuxParametres.FirstOrDefaultAsync(x => x.SlpLieuId == lieu, ct) ?? db.LieuxParametres.Add(new LieuParametreEntite { SlpLieuId = lieu }).Entity;
        p.SlpDelaiJours = s.DelaiJours;
        p.SlpFriseJours = s.FriseJours;
        await db.SaveChangesAsync(ct);
        return await ParametresLieuAsync(lieu, ct);
    }

    public async Task<List<SeuilDto>> SeuilsAsync(long lieu, CancellationToken ct)
    {
        var l = await db.Seuils.AsNoTracking().Where(x => x.SseLieuId == lieu).ToListAsync(ct);
        var a = await specialisation.ArticlesAsync(db, l.Select(x => x.SseEleId).ToList(), ct);
        return l.Select(x => { var ar = a.GetValueOrDefault(x.SseEleId); return new SeuilDto(x.SseEleId, ar?.Code, ar?.Libelle, ar?.Unite, x.SseMini, x.SseMaxi, x.SseDelaiJours); })
            .OrderBy(x => x.Code, StringComparer.OrdinalIgnoreCase).ToList();
    }

    /// <summary>Remplace les seuils du lieu (une ligne par article ; sans mini ni maxi : retirée).</summary>
    public async Task<List<SeuilDto>> EnregistrerSeuilsAsync(long lieu, List<SeuilDto> l, Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        if (l.GroupBy(x => x.Ele).Any(g => g.Count() > 1)) throw ExceptionMetier.Invalide("STK_SEUIL_DOUBLON", "Un article en double dans les seuils");
        foreach (var x in l)
        {
            if (x.Mini is < 0 || x.Maxi is < 0 || x.DelaiJours is < 0) throw ExceptionMetier.Invalide("STK_SEUIL", "Mini, maxi et délai positifs ou nuls");
            if (x.Mini is { } mi && x.Maxi is { } ma && ma < mi) throw ExceptionMetier.Invalide("STK_SEUIL", $"Article {x.Code ?? x.Ele.ToString()} : maxi inférieur au mini");
        }
        db.Seuils.RemoveRange(await db.Seuils.Where(x => x.SseLieuId == lieu).ToListAsync(ct));
        foreach (var x in l.Where(x => x.Mini is not null || x.Maxi is not null))
            db.Seuils.Add(new SeuilEntite { SseEleId = x.Ele, SseLieuId = lieu, SseMini = x.Mini, SseMaxi = x.Maxi, SseDelaiJours = x.DelaiJours });
        await db.SaveChangesAsync(ct);
        return await SeuilsAsync(lieu, ct);
    }

    private sealed record Contexte(string Aujourdhui, Dictionary<long, LigneEtatStock> Stock, List<PrevisionStock> Previsions, Dictionary<long, SeuilEntite> Seuils, ParametresLieuDto Parametres);

    private async Task<Contexte> ContexteAsync(long lieu, CancellationToken ct)
    {
        var etat = await stock.EtatAsync(lieu, null, true, ct);
        var previsions = await specialisation.PrevisionsAsync(db, lieu, ct);
        var seuils = await db.Seuils.AsNoTracking().Where(x => x.SseLieuId == lieu).ToDictionaryAsync(x => x.SseEleId, ct);
        return new(J(DateOnly.FromDateTime(DateTime.Today)), etat.Lignes.ToDictionary(l => l.EleId), previsions, seuils, await ParametresLieuAsync(lieu, ct));
    }

    private static List<EvenementPrevu> Evenements(IEnumerable<PrevisionStock> p) =>
        p.Select((x, i) => new EvenementPrevu($"{x.Type[0]}{x.EntId}-{i}", x.Type, J(x.Date), x.Quantite)).ToList();

    private string Horizon(Contexte c, long ele) =>
        J(DateOnly.Parse(c.Aujourdhui, CultureInfo.InvariantCulture).AddDays(c.Seuils.GetValueOrDefault(ele)?.SseDelaiJours ?? c.Parametres.DelaiJours));

    /// <summary>Projection d'un article dans un lieu : événements datés, disponible jour par jour, réservations non honorées, proposition.</summary>
    public async Task<ProjectionArticle> ProjectionAsync(long lieu, long ele, CancellationToken ct)
    {
        var c = await ContexteAsync(lieu, ct);
        var a = (await specialisation.ArticlesAsync(db, [ele], ct)).GetValueOrDefault(ele) ?? throw ExceptionMetier.Introuvable("Article");
        var prev = c.Previsions.Where(p => p.Ele == ele).ToList();
        var evs = Evenements(prev);
        var q = c.Stock.GetValueOrDefault(ele)?.Quantite ?? 0;
        var proj = ReglesProjection.Projeter(q, c.Aujourdhui, evs);
        var horizon = Horizon(c, ele);
        var minH = ReglesProjection.MinimumJusqua(proj, q, horizon);
        var seuil = c.Seuils.GetValueOrDefault(ele);
        var appro = (await specialisation.ApprovisionnementsAsync(db, [ele], ct)).GetValueOrDefault(ele);
        var prop = ReglesProjection.Proposer(seuil?.SseMini, seuil?.SseMaxi, minH, appro?.Conditionnement ?? 1);
        return new ProjectionArticle(lieu, ele, a.Code, a.Libelle, a.Unite, a.Precision, c.Aujourdhui, q,
            prev.Select((p, i) => new EvenementDto(evs[i].Id, p.Type, J(p.Date), p.Quantite, p.EntId, p.Numero, p.TypePiece, p.Tiers, p.Chantier, proj.Retards.Contains(evs[i].Id))).ToList(),
            proj, seuil is null ? null : new SeuilDto(ele, a.Code, a.Libelle, a.Unite, seuil.SseMini, seuil.SseMaxi, seuil.SseDelaiJours), horizon, minH, prop, appro);
    }

    /// <summary>Synthèse d'un lieu : articles réservés, attendus ou à seuil ; ruptures à venir et propositions.</summary>
    public async Task<List<LigneSynthese>> SyntheseAsync(long lieu, CancellationToken ct)
    {
        var c = await ContexteAsync(lieu, ct);
        var ids = c.Previsions.Select(p => p.Ele).Union(c.Seuils.Keys).Distinct().ToList();
        var articles = await specialisation.ArticlesAsync(db, ids, ct);
        var appros = await specialisation.ApprovisionnementsAsync(db, ids, ct);
        var lignes = new List<LigneSynthese>();
        foreach (var id in ids)
        {
            var a = articles.GetValueOrDefault(id);
            if (a is null) continue;
            var prev = c.Previsions.Where(p => p.Ele == id).ToList();
            var q = c.Stock.GetValueOrDefault(id)?.Quantite ?? 0;
            var proj = ReglesProjection.Projeter(q, c.Aujourdhui, Evenements(prev));
            var horizon = Horizon(c, id);
            var minH = ReglesProjection.MinimumJusqua(proj, q, horizon);
            var seuil = c.Seuils.GetValueOrDefault(id);
            var appro = appros.GetValueOrDefault(id);
            var reserve = prev.Where(p => p.Type == "SORTIE").Sum(p => p.Quantite);
            var attendu = prev.Where(p => p.Type == "ENTREE").Sum(p => p.Quantite);
            lignes.Add(new LigneSynthese(id, a.Code, a.Libelle, a.Unite, a.Precision, q, reserve, attendu, q - reserve + attendu, proj.PremiereRupture,
                proj.Minimum.Disponible, proj.Minimum.Date, seuil?.SseMini, seuil?.SseMaxi, horizon, minH,
                ReglesProjection.Proposer(seuil?.SseMini, seuil?.SseMaxi, minH, appro?.Conditionnement ?? 1), appro, proj.Retards.Count));
        }
        return lignes.OrderBy(l => l.PremiereRupture is null).ThenBy(l => l.PremiereRupture, StringComparer.Ordinal).ThenBy(l => l.Code, StringComparer.OrdinalIgnoreCase).ToList();
    }

    /// <summary>Crée les commandes fournisseur en brouillon (une par fournisseur) livrées au lieu.</summary>
    public async Task<List<CommandeCreee>> CommanderAsync(long lieu, CommandeSaisie s, Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        var lignes = (s.Lignes ?? []).Where(l => l.UnitesAchat > 0).ToList();
        if (lignes.Count == 0) throw ExceptionMetier.Invalide("STK_COMMANDE_VIDE", "Aucune quantité à commander");
        if (lignes.Any(l => l.FournisseurId is null)) throw ExceptionMetier.Invalide("STK_FOURNISSEUR", "Fournisseur à choisir pour chaque article (tarif principal de la bibliothèque)");
        return await specialisation.CreerCommandesAsync(db, lieu, lignes, u, ct);
    }
}

public static class ExtensionsApprovisionnement
{
    /// <summary>Routes de l'approvisionnement (sous le groupe /stock du module).</summary>
    public static RouteGroupBuilder MapApprovisionnement(this RouteGroupBuilder g)
    {
        g.MapGet("/lieux/{id:long}/parametres", (long id, ServiceApprovisionnement s, CancellationToken ct) => s.ParametresLieuAsync(id, ct));
        g.MapPut("/lieux/{id:long}/parametres", (long id, ParametresLieuDto p, HttpContext http, ServiceApprovisionnement s, CancellationToken ct) => s.EnregistrerParametresLieuAsync(id, p, Utilisateur.Depuis(http), ct));
        g.MapGet("/lieux/{id:long}/seuils", (long id, ServiceApprovisionnement s, CancellationToken ct) => s.SeuilsAsync(id, ct));
        g.MapPut("/lieux/{id:long}/seuils", (long id, List<SeuilDto> l, HttpContext http, ServiceApprovisionnement s, CancellationToken ct) => s.EnregistrerSeuilsAsync(id, l, Utilisateur.Depuis(http), ct));
        g.MapGet("/lieux/{id:long}/approvisionnement", (long id, ServiceApprovisionnement s, CancellationToken ct) => s.SyntheseAsync(id, ct));
        g.MapGet("/lieux/{id:long}/projection/{ele:long}", (long id, long ele, ServiceApprovisionnement s, CancellationToken ct) => s.ProjectionAsync(id, ele, ct));
        g.MapPost("/lieux/{id:long}/commander", (long id, CommandeSaisie c, HttpContext http, ServiceApprovisionnement s, CancellationToken ct) => s.CommanderAsync(id, c, Utilisateur.Depuis(http), ct));
        return g;
    }
}
