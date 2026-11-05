using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Stock.Web;

/// <summary>Suivi d'un article (S24.1, S24.7) : aucun, par lot, par numéro de série ; périssable et durée théorique.</summary>
public class ArticleSuiviEntite
{
    public long SasEleId { get; set; }
    public string SasSuivi { get; set; } = SuiviArticle.Aucun;
    public bool SasPerissable { get; set; }
    public int? SasDuree { get; set; }
    public string SasUnite { get; set; } = UniteDuree.Mois;
    public string? SasMajPar { get; set; }
    public DateTimeOffset SasMajLe { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Lot ou numéro de série d'un article (S24) : numéro unique par article et fournisseur.</summary>
public class LotArticleEntite
{
    public long LotId { get; set; }
    public long LotEleId { get; set; }
    public string LotNumero { get; set; } = "";
    public long? LotTiersId { get; set; }
    public DateOnly? LotFabrication { get; set; }
    public DateOnly? LotLimite { get; set; }
    public string? LotCoulee { get; set; }
    public string? LotNorme { get; set; }
    public string? LotCommentaire { get; set; }
    public string LotCreePar { get; set; } = "";
    public DateTimeOffset LotCreeLe { get; set; } = DateTimeOffset.UtcNow;
    public string? LotMajPar { get; set; }
    public DateTimeOffset? LotMajLe { get; set; }
}

/// <summary>Répartition par lot d'un comptage (S24-b) ; le reste du comptage est sans lot.</summary>
public class ComptageLotEntite
{
    public long CplCptId { get; set; }
    public long CplLotId { get; set; }
    public decimal CplQuantite { get; set; }
}

public sealed record SuiviArticleDto(string Suivi, bool Perissable, int? Duree, string Unite);
public sealed record StockLieuLot(long Lieu, string? LieuCode, decimal Quantite);
public sealed record LotDtoArticle(long? Id, string? Numero, long? Tiers, string? TiersNom, string? Fabrication, string? Limite, string? Coulee, string? Norme,
    string? Commentaire, decimal Quantite, List<StockLieuLot> Lieux, string? Cree);
public sealed record LotsArticle(long Ele, string? Unite, int Precision, SuiviArticleDto Suivi, List<LotDtoArticle> Lots, decimal SansLot, List<StockLieuLot> SansLotLieux);
public sealed record LotModifie(string? Fabrication, string? Limite, string? Coulee, string? Norme, string? Commentaire);

/// <summary>
/// Lots et numéros de série (ANALYSE-MODULE-STOCK.md § 11, lot S24-a) : suivi des articles, lots d'un article avec leur
/// stock actuel par lieu (ReglesTracabilite.StockParLot ; le « sans lot » à part), fiche d'un lot. Les lots naissent à la
/// réception, créés par l'application avec les mouvements (S24.10) ; le module ne les crée jamais seul.
/// </summary>
public class ServiceTracabilite(StockDbContext db, SpecialisationStock specialisation)
{
    /// <summary>Numéro du lot créé à l'activation du suivi pour le stock déjà présent (S24.11), à éclater par un inventaire.</summary>
    public const string LotInitial = "INITIAL";

    private static string M(DateTimeOffset d) => ReglesStock.Minute(d);

    /// <summary>
    /// Lignes de comptage par lot d'un article (un lieu ou tous) : la répartition de chaque comptage, et son reste sans
    /// lot ; lieu de chaque ligne rendu à part.
    /// </summary>
    public async Task<List<(long Lieu, QuantiteLot Ligne)>> ComptagesParLotAsync(long ele, long? lieu, CancellationToken ct)
    {
        var cpts = await db.Comptages.AsNoTracking().Where(x => x.CptEleId == ele && (lieu == null || x.CptLieuId == lieu))
            .Select(x => new { x.CptId, x.CptLieuId, x.CptDate, x.CptQuantite }).ToListAsync(ct);
        var ids = cpts.Select(c => c.CptId).ToList();
        var lots = await db.ComptagesLots.AsNoTracking().Where(x => ids.Contains(x.CplCptId)).ToListAsync(ct);
        var res = new List<(long, QuantiteLot)>();
        foreach (var c in cpts)
        {
            var r = lots.Where(x => x.CplCptId == c.CptId).ToList();
            foreach (var x in r) res.Add((c.CptLieuId, new QuantiteLot(M(c.CptDate), x.CplQuantite, x.CplLotId)));
            var reste = c.CptQuantite - r.Sum(x => x.CplQuantite);
            if (reste != 0 || r.Count == 0) res.Add((c.CptLieuId, new QuantiteLot(M(c.CptDate), reste, null)));
        }
        return res;
    }

    /// <summary>Stock par lot d'un article dans un lieu à une date-heure (lots seulement : le sans lot est écarté), avec date limite et entrée du lot.</summary>
    public async Task<List<LotEnStock>> StockLotsAsync(long ele, long lieu, DateTimeOffset t, CancellationToken ct)
    {
        var mvts = await db.Mouvements.AsNoTracking().Where(m => m.MvtEleId == ele && m.MvtLieuId == lieu)
            .Select(m => new QuantiteLot(M(m.MvtDate), m.MvtQuantite, m.MvtLotId)).ToListAsync(ct);
        var cpts = (await ComptagesParLotAsync(ele, lieu, ct)).Select(x => x.Ligne).ToList();
        var stock = ReglesTracabilite.StockParLot(mvts, cpts, M(t)).Where(s => s.Lot is not null).ToList();
        var ids = stock.Select(s => s.Lot!.Value).ToList();
        var lots = await db.LotsArticle.AsNoTracking().Where(l => ids.Contains(l.LotId)).ToDictionaryAsync(l => l.LotId, ct);
        return stock.Where(s => lots.ContainsKey(s.Lot!.Value)).Select(s =>
        {
            var l = lots[s.Lot!.Value];
            return new LotEnStock(l.LotId, l.LotNumero, s.Quantite, l.LotLimite?.ToString("yyyy-MM-dd"), l.LotCreeLe.UtcDateTime.ToString("yyyy-MM-dd"));
        }).ToList();
    }

    /// <summary>Lot d'un article par son numéro (sans casse, tout fournisseur, le plus récent), sinon créé sans fournisseur.</summary>
    public async Task<long> LotParNumeroAsync(long ele, string numero, Utilisateur u, CancellationToken ct)
    {
        var n = ReglesTracabilite.Numero(numero) ?? throw ExceptionMetier.Invalide("TRA_NUMERO_VIDE", ReglesTracabilite.Messages["TRA_NUMERO_VIDE"]);
        var cle = n.ToUpperInvariant();
        var l = await db.LotsArticle.Where(x => x.LotEleId == ele && x.LotNumero.ToUpper() == cle).OrderByDescending(x => x.LotId).FirstOrDefaultAsync(ct);
        if (l is not null) return l.LotId;
        var suivi = await SuiviAsync(ele, ct);
        l = db.LotsArticle.Add(new LotArticleEntite
        {
            LotEleId = ele, LotNumero = n, LotCreePar = u.Code,
            LotLimite = ReglesTracabilite.DateLimite(new PeremptionArticle(suivi.Perissable, suivi.Duree, suivi.Unite), null, DateOnly.FromDateTime(DateTime.Today)),
        }).Entity;
        await db.SaveChangesAsync(ct);
        return l.LotId;
    }

    private async Task ExigerGestion(Utilisateur u, CancellationToken ct)
    {
        if (!await specialisation.PeutGererAsync(db, u, ct)) throw ExceptionMetier.AccesRefuse("GERER_STOCK");
    }

    public async Task<SuiviArticleDto> SuiviAsync(long ele, CancellationToken ct)
    {
        var s = await db.ArticlesSuivi.AsNoTracking().FirstOrDefaultAsync(x => x.SasEleId == ele, ct);
        return s is null ? new(SuiviArticle.Aucun, false, null, UniteDuree.Mois) : new(s.SasSuivi, s.SasPerissable, s.SasDuree, s.SasUnite);
    }

    /// <summary>Suivi d'un article : mode connu, durée positive (périssable seulement), unité J ou M ; un article sans suivi garde sa ligne.</summary>
    public async Task<SuiviArticleDto> DefinirSuiviAsync(long ele, SuiviArticleDto d, Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        if (!SuiviArticle.Tous.Contains(d.Suivi)) throw ExceptionMetier.Invalide("STK_SUIVI", "Suivi : aucun, par lot ou par numéro de série");
        if (d.Unite is not (UniteDuree.Jours or UniteDuree.Mois)) throw ExceptionMetier.Invalide("STK_DUREE", "Durée en jours ou en mois");
        if (d.Duree is <= 0) throw ExceptionMetier.Invalide("STK_DUREE", "Durée de péremption positive");
        var s = await db.ArticlesSuivi.FirstOrDefaultAsync(x => x.SasEleId == ele, ct);
        var activation = (s?.SasSuivi ?? SuiviArticle.Aucun) == SuiviArticle.Aucun && d.Suivi != SuiviArticle.Aucun;
        if (s is null) db.ArticlesSuivi.Add(s = new ArticleSuiviEntite { SasEleId = ele });
        s.SasSuivi = d.Suivi;
        s.SasPerissable = d.Perissable;
        s.SasDuree = d.Perissable ? d.Duree : null;
        s.SasUnite = d.Unite;
        s.SasMajPar = u.Code;
        s.SasMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        if (activation) await LotInitialAsync(ele, u, ct);
        return await SuiviAsync(ele, ct);
    }

    /// <summary>
    /// Activation du suivi (S24.11) : dans chaque lieu où l'article a du stock sans lot, comptage à maintenant de la quantité
    /// actuelle (stock et valeur inchangés) dont le sans lot passe au lot INITIAL — les lots déjà en stock gardent la leur.
    /// </summary>
    private async Task LotInitialAsync(long ele, Utilisateur u, CancellationToken ct)
    {
        var maintenant = DateTimeOffset.UtcNow;
        var instant = new DateTimeOffset(maintenant.Year, maintenant.Month, maintenant.Day, maintenant.Hour, maintenant.Minute, 0, TimeSpan.Zero);
        var mvts = await db.Mouvements.AsNoTracking().Where(m => m.MvtEleId == ele).Select(m => new { m.MvtLieuId, m.MvtDate, m.MvtQuantite, m.MvtLotId }).ToListAsync(ct);
        var cpts = await ComptagesParLotAsync(ele, null, ct);
        long? initial = null;
        foreach (var lieu in mvts.Select(m => m.MvtLieuId).Union(cpts.Select(c => c.Lieu)).Distinct().ToList())
        {
            var stock = ReglesTracabilite.StockParLot(mvts.Where(m => m.MvtLieuId == lieu).Select(m => new QuantiteLot(M(m.MvtDate), m.MvtQuantite, m.MvtLotId)).ToList(),
                cpts.Where(c => c.Lieu == lieu).Select(c => c.Ligne).ToList(), M(instant));
            var sans = stock.FirstOrDefault(x => x.Lot is null)?.Quantite ?? 0;
            if (sans <= 0) continue;
            initial ??= await LotParNumeroAsync(ele, LotInitial, u, ct);
            var c = db.Comptages.Add(new ComptageEntite
            {
                CptEleId = ele, CptLieuId = lieu, CptDate = instant, CptQuantite = stock.Sum(x => x.Quantite), CptPar = u.Code,
                CptCommentaire = "Activation du suivi : stock sans lot passé au lot INITIAL",
            }).Entity;
            await db.SaveChangesAsync(ct);
            foreach (var x in stock)
                if (x.Lot is long id) db.ComptagesLots.Add(new ComptageLotEntite { CplCptId = c.CptId, CplLotId = id, CplQuantite = x.Quantite });
            db.ComptagesLots.Add(new ComptageLotEntite { CplCptId = c.CptId, CplLotId = initial.Value, CplQuantite = sans });
            await db.SaveChangesAsync(ct);
        }
    }

    /// <summary>Lots d'un article : stock actuel par lieu et au total (lots épuisés compris), sans lot à part.</summary>
    public async Task<LotsArticle> LotsAsync(long ele, CancellationToken ct)
    {
        var suivi = await SuiviAsync(ele, ct);
        var lots = await db.LotsArticle.AsNoTracking().Where(x => x.LotEleId == ele).OrderByDescending(x => x.LotCreeLe).ThenByDescending(x => x.LotId).ToListAsync(ct);
        var mouvements = await db.Mouvements.AsNoTracking().Where(x => x.MvtEleId == ele).Select(x => new { x.MvtLieuId, x.MvtDate, x.MvtQuantite, x.MvtLotId }).ToListAsync(ct);
        var comptages = await ComptagesParLotAsync(ele, null, ct);
        var lieux = (await specialisation.LieuxAsync(db, ct)).ToDictionary(l => l.Id, l => l.Code);
        var maintenant = M(DateTimeOffset.UtcNow);
        var parLieu = new Dictionary<long, List<StockLot>>();
        foreach (var lieu in mouvements.Select(m => m.MvtLieuId).Union(comptages.Select(c => c.Lieu)))
            parLieu[lieu] = ReglesTracabilite.StockParLot(
                mouvements.Where(m => m.MvtLieuId == lieu).Select(m => new QuantiteLot(M(m.MvtDate), m.MvtQuantite, m.MvtLotId)).ToList(),
                comptages.Where(c => c.Lieu == lieu).Select(c => c.Ligne).ToList(), maintenant);
        List<StockLieuLot> Lieux(long? lot) => parLieu.SelectMany(p => p.Value.Where(s => s.Lot == lot).Select(s => new StockLieuLot(p.Key, lieux.GetValueOrDefault(p.Key), s.Quantite)))
            .OrderBy(x => x.LieuCode, StringComparer.OrdinalIgnoreCase).ToList();
        var tiers = await specialisation.NomsTiersAsync(db, lots.Where(l => l.LotTiersId is not null).Select(l => l.LotTiersId!.Value).Distinct().ToList(), ct);
        var dtos = lots.Select(l =>
        {
            var li = Lieux(l.LotId);
            return new LotDtoArticle(l.LotId, l.LotNumero, l.LotTiersId, l.LotTiersId is long t ? tiers.GetValueOrDefault(t) : null, l.LotFabrication?.ToString("yyyy-MM-dd"),
                l.LotLimite?.ToString("yyyy-MM-dd"), l.LotCoulee, l.LotNorme, l.LotCommentaire, li.Sum(x => x.Quantite), li, M(l.LotCreeLe));
        }).ToList();
        var sans = Lieux(null);
        var article = (await specialisation.ArticlesAsync(db, [ele], ct)).GetValueOrDefault(ele);
        return new(ele, article?.Unite, article?.Precision ?? 2, suivi, dtos, sans.Sum(x => x.Quantite), sans);
    }

    /// <summary>Informations d'un lot (le numéro, l'article et le fournisseur ne changent pas) ; dates « AAAA-MM-JJ ».</summary>
    public async Task<LotsArticle> ModifierLotAsync(long id, LotModifie m, Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        var l = await db.LotsArticle.FirstOrDefaultAsync(x => x.LotId == id, ct) ?? throw ExceptionMetier.Introuvable("Lot");
        static DateOnly? Date(string? s) => string.IsNullOrWhiteSpace(s) ? null
            : DateOnly.TryParse(s, System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : throw ExceptionMetier.Invalide("STK_LOT_DATE", $"Date illisible : {s}");
        static string? Texte(string? s, int max) => string.IsNullOrWhiteSpace(s) ? null : s.Trim()[..Math.Min(max, s.Trim().Length)];
        l.LotFabrication = Date(m.Fabrication);
        l.LotLimite = Date(m.Limite);
        l.LotCoulee = Texte(m.Coulee, 60);
        l.LotNorme = Texte(m.Norme, 60);
        l.LotCommentaire = Texte(m.Commentaire, 2000);
        l.LotMajPar = u.Code;
        l.LotMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return await LotsAsync(l.LotEleId, ct);
    }
}

public static class ExtensionsTracabilite
{
    public static RouteGroupBuilder MapTracabilite(this RouteGroupBuilder g)
    {
        g.MapGet("/articles/{id:long}/suivi", (long id, ServiceTracabilite s, CancellationToken ct) => s.SuiviAsync(id, ct));
        g.MapPut("/articles/{id:long}/suivi", (long id, SuiviArticleDto d, HttpContext http, ServiceTracabilite s, CancellationToken ct) =>
            s.DefinirSuiviAsync(id, d, Utilisateur.Depuis(http), ct));
        g.MapGet("/articles/{id:long}/lots", (long id, ServiceTracabilite s, CancellationToken ct) => s.LotsAsync(id, ct));
        // Lots en stock d'un lieu à une date (proposition d'une sortie, S24.2).
        g.MapGet("/articles/{id:long}/lots/{lieu:long}", (long id, long lieu, DateTimeOffset? date, ServiceTracabilite s, CancellationToken ct) =>
            s.StockLotsAsync(id, lieu, date ?? DateTimeOffset.UtcNow, ct));
        g.MapPut("/lots/{id:long}", (long id, LotModifie m, HttpContext http, ServiceTracabilite s, CancellationToken ct) => s.ModifierLotAsync(id, m, Utilisateur.Depuis(http), ct));
        return g;
    }
}
