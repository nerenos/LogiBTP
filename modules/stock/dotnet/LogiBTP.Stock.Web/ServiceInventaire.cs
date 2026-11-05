using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Builder;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Stock.Web;

public class LotInventaireEntite
{
    public long LinId { get; set; }
    public long LinLieuId { get; set; }
    public DateTimeOffset LinDate { get; set; }
    public string LinLibelle { get; set; } = "";
    public string LinEtat { get; set; } = "BROUILLON";
    public bool LinMicro { get; set; }
    public string? LinCommentaire { get; set; }
    public string LinCreePar { get; set; } = "";
    public DateTimeOffset LinCreeLe { get; set; } = DateTimeOffset.UtcNow;
    public string? LinValidePar { get; set; }
    public DateTimeOffset? LinValideLe { get; set; }
    /// <summary>Pièce des écarts du lot validé, fournie par l'application (pièce comptable) ; null sans écart valorisé.</summary>
    public long? LinEntId { get; set; }
    /// <summary>Pièce qui contre-passe celle des écarts à l'annulation d'un lot déjà transféré en comptabilité.</summary>
    public long? LinExtourneEntId { get; set; }
}

public class BordereauEntite
{
    public long BorId { get; set; }
    public long BorLinId { get; set; }
    public string BorLibelle { get; set; } = "";
    public string? BorCritere { get; set; }
    public string? BorCompteur { get; set; }
    public int BorOrdre { get; set; }
}

public class LigneBordereauEntite
{
    public long BliId { get; set; }
    public long BliBorId { get; set; }
    public long BliEleId { get; set; }
    public long? BliEmpId { get; set; }
    public decimal? BliQuantite { get; set; }
    public decimal? BliTheorique { get; set; }
    public decimal? BliPrix { get; set; }
    public bool BliAppliquerPmp { get; set; }
    public string? BliCommentaire { get; set; }
    public int BliOrdre { get; set; }
}

public class MarqueEntite
{
    public string MrqCode { get; set; } = "";
    public string MrqLibelle { get; set; } = "";
    public string? MrqCouleur { get; set; }
    public int MrqOrdre { get; set; }
    public bool MrqActif { get; set; } = true;
}

public class ArticleMarqueEntite
{
    public long SamEleId { get; set; }
    public string SamMrqCode { get; set; } = "";
}

/// <summary>Article de dotation (lot 4, S16, S27) : EPI ou outillage consommable, durée de vie en mois.</summary>
public class ArticleDotationEntite
{
    public long SadEleId { get; set; }
    public string SadType { get; set; } = "EPI";
    public int? SadDureeMois { get; set; }
}

public sealed record DotationArticleDto(string? Type, int? DureeMois);

/// <summary>Famille d'articles (génération des bordereaux par famille).</summary>
public sealed record FamilleStock(long Id, string Chemin);

public sealed record LotDto(long Id, long Lieu, string? LieuCode, string Date, string Libelle, string Etat, bool Micro, string? Commentaire, string CreePar,
    string? ValidePar, string? ValideLe, int Bordereaux, int Lignes, int Comptees, long? Piece = null, long? Extourne = null);
public sealed record LigneBordereauDto(long? Id, long Ele, string? Code, string? Libelle, string? Unite, int Precision, long? Emp, string? EmpCode,
    decimal? Quantite, decimal? Theorique, decimal? Prix, bool AppliquerPmp, string? Commentaire);
public sealed record BordereauDto(long Id, string Libelle, string? Critere, string? Compteur, int Ordre, List<LigneBordereauDto> Lignes);
public sealed record LotDetailDto(LotDto Lot, List<BordereauDto> Bordereaux, ControleLot Controle);
public sealed record LotSaisi(long? Lieu, DateTimeOffset? Date, string? Libelle, string? Commentaire);
public sealed record BordereauSaisi(string? Libelle, string? Compteur, List<LigneBordereauDto>? Lignes);
public sealed record GenerationSaisie(string? Par, List<string>? Valeurs, bool Separer = true);
public sealed record EcartArticle(long Ele, string Code, string Libelle, string Unite, int Precision, decimal Theorique, decimal Compte, decimal Ecart,
    decimal? ValeurUnitaire, string? Source, decimal? ValeurEcart, decimal? Prix, decimal? ValeurInventaire, bool AppliquerPmp, string? Commentaire);
public sealed record EcartsLot(long Lot, string Date, string Methode, List<EcartArticle> Articles, decimal ValeurEcarts, decimal ValeurInventaire);
public sealed record CorrectionSaisie(long? Lieu, decimal? Quantite, long? Emp, decimal? Prix, bool AppliquerPmp, string? Commentaire, DateTimeOffset? Date);
public sealed record MarqueDto(string Code, string Libelle, string? Couleur, int Ordre, bool Actif);
public sealed record MarquageSaisi(List<long>? Articles, List<string>? Ajouter, List<string>? Retirer);

/// <summary>
/// Inventaires (ANALYSE-MODULE-STOCK.md § 5.3, S5 à S8, S30) : lots à date-heure unique, bordereaux générés ou saisis,
/// contrôle partagé (ReglesInventaire), rapport d'écarts (ReglesStock.Ecart, valeur à la date), validation (un comptage
/// par article, réévaluation si « Appliquer au PMP »), annulation, micro-inventaire ; marques des articles (S20).
/// </summary>
public class ServiceInventaire(StockDbContext db, SpecialisationStock specialisation, ServiceStock stock)
{
    private static string M(DateTimeOffset d) => ReglesStock.Minute(d);

    private static DateTimeOffset Instant(DateTimeOffset? d)
    {
        var x = (d ?? DateTimeOffset.UtcNow).ToUniversalTime();
        return new DateTimeOffset(x.Year, x.Month, x.Day, x.Hour, x.Minute, 0, TimeSpan.Zero);
    }

    private async Task ExigerGestion(Utilisateur u, CancellationToken ct)
    {
        if (!await specialisation.PeutGererAsync(db, u, ct)) throw ExceptionMetier.AccesRefuse("GERER_STOCK");
    }

    private async Task<LotInventaireEntite> LotModifiable(long id, CancellationToken ct)
    {
        var lot = await db.LotsInventaire.FirstOrDefaultAsync(x => x.LinId == id, ct) ?? throw ExceptionMetier.Introuvable("Lot d'inventaire");
        if (lot.LinEtat != "BROUILLON") throw ExceptionMetier.Conflit("STK_LOT_VALIDE", "Lot d'inventaire déjà validé ou annulé");
        return lot;
    }

    // ------------------------------------------------------------------ lots

    public async Task<List<LotDto>> LotsAsync(long? lieu, CancellationToken ct)
    {
        var lots = await db.LotsInventaire.AsNoTracking().Where(x => lieu == null || x.LinLieuId == lieu).OrderByDescending(x => x.LinDate).ThenByDescending(x => x.LinId)
            .Take(300).ToListAsync(ct);
        return await DtosAsync(lots, ct);
    }

    private async Task<List<LotDto>> DtosAsync(List<LotInventaireEntite> lots, CancellationToken ct)
    {
        var ids = lots.Select(l => l.LinId).ToList();
        var bors = await db.Bordereaux.AsNoTracking().Where(b => ids.Contains(b.BorLinId)).Select(b => new { b.BorId, b.BorLinId }).ToListAsync(ct);
        var borIds = bors.Select(b => b.BorId).ToList();
        var lignes = await db.LignesBordereau.AsNoTracking().Where(l => borIds.Contains(l.BliBorId)).Select(l => new { l.BliBorId, l.BliQuantite }).ToListAsync(ct);
        var lieux = (await specialisation.LieuxAsync(db, ct)).ToDictionary(l => l.Id);
        return lots.Select(l =>
        {
            var b = bors.Where(x => x.BorLinId == l.LinId).Select(x => x.BorId).ToHashSet();
            var li = lignes.Where(x => b.Contains(x.BliBorId)).ToList();
            return new LotDto(l.LinId, l.LinLieuId, lieux.GetValueOrDefault(l.LinLieuId)?.Code, M(l.LinDate), l.LinLibelle, l.LinEtat, l.LinMicro, l.LinCommentaire,
                l.LinCreePar, l.LinValidePar, l.LinValideLe is { } v ? M(v) : null, b.Count, li.Count, li.Count(x => x.BliQuantite is not null), l.LinEntId, l.LinExtourneEntId);
        }).ToList();
    }

    /// <summary>Nouveau lot : un lieu, une date-heure (maintenant par défaut, jamais à venir) imposée à ses bordereaux.</summary>
    public async Task<LotDetailDto> CreerLotAsync(LotSaisi s, Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        if (s.Lieu is not { } lieu || !(await specialisation.LieuxAsync(db, ct)).Any(l => l.Id == lieu))
            throw ExceptionMetier.Invalide("STK_LIEU", "Lieu de stock obligatoire (dépôt ou chantier qui tient un stock)");
        var date = Instant(s.Date);
        if (date > Instant(null)) throw ExceptionMetier.Invalide("STK_DATE_FUTURE", "Date-heure du comptage à venir");
        var lot = db.LotsInventaire.Add(new LotInventaireEntite
        {
            LinLieuId = lieu, LinDate = date, LinLibelle = string.IsNullOrWhiteSpace(s.Libelle) ? $"Inventaire du {date.ToLocalTime():dd/MM/yyyy HH:mm}" : s.Libelle.Trim(),
            LinCommentaire = s.Commentaire, LinCreePar = u.Code,
        }).Entity;
        await db.SaveChangesAsync(ct);
        return await LotAsync(lot.LinId, ct);
    }

    public async Task<LotDetailDto> ModifierLotAsync(long id, LotSaisi s, Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        var lot = await LotModifiable(id, ct);
        if (s.Date is { } d)
        {
            var date = Instant(d);
            if (date > Instant(null)) throw ExceptionMetier.Invalide("STK_DATE_FUTURE", "Date-heure du comptage à venir");
            lot.LinDate = date;
        }
        if (!string.IsNullOrWhiteSpace(s.Libelle)) lot.LinLibelle = s.Libelle.Trim();
        lot.LinCommentaire = s.Commentaire;
        await db.SaveChangesAsync(ct);
        return await LotAsync(id, ct);
    }

    public async Task SupprimerLotAsync(long id, Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        db.LotsInventaire.Remove(await LotModifiable(id, ct));
        await db.SaveChangesAsync(ct);
    }

    public async Task<LotDetailDto> LotAsync(long id, CancellationToken ct)
    {
        var lot = await db.LotsInventaire.AsNoTracking().FirstOrDefaultAsync(x => x.LinId == id, ct) ?? throw ExceptionMetier.Introuvable("Lot d'inventaire");
        var bors = await db.Bordereaux.AsNoTracking().Where(b => b.BorLinId == id).OrderBy(b => b.BorOrdre).ThenBy(b => b.BorId).ToListAsync(ct);
        var borIds = bors.Select(b => b.BorId).ToList();
        var lignes = await db.LignesBordereau.AsNoTracking().Where(l => borIds.Contains(l.BliBorId)).OrderBy(l => l.BliOrdre).ThenBy(l => l.BliId).ToListAsync(ct);
        var articles = await specialisation.ArticlesAsync(db, lignes.Select(l => l.BliEleId).Distinct().ToList(), ct);
        var emps = await db.Emplacements.AsNoTracking().Where(e => e.EmpLieuId == lot.LinLieuId).ToDictionaryAsync(e => e.EmpId, e => e.EmpCode, ct);
        LigneBordereauDto Dto(LigneBordereauEntite l)
        {
            var a = articles.GetValueOrDefault(l.BliEleId);
            return new(l.BliId, l.BliEleId, a?.Code, a?.Libelle, a?.Unite, a?.Precision ?? 2, l.BliEmpId, l.BliEmpId is { } e ? emps.GetValueOrDefault(e) : null,
                l.BliQuantite, l.BliTheorique, l.BliPrix, l.BliAppliquerPmp, l.BliCommentaire);
        }
        var controle = ReglesInventaire.Controler(lignes.Select(l => new LigneInventaire(l.BliBorId, l.BliEleId, l.BliEmpId, l.BliQuantite, l.BliPrix, l.BliAppliquerPmp, l.BliCommentaire)).ToList());
        return new LotDetailDto((await DtosAsync([lot], ct))[0],
            bors.Select(b => new BordereauDto(b.BorId, b.BorLibelle, b.BorCritere, b.BorCompteur, b.BorOrdre, lignes.Where(l => l.BliBorId == b.BorId).Select(Dto).ToList())).ToList(),
            controle);
    }

    // ------------------------------------------------------------------ bordereaux

    public async Task<LotDetailDto> AjouterBordereauAsync(long lot, BordereauSaisi s, Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        await LotModifiable(lot, ct);
        var ordre = await db.Bordereaux.Where(b => b.BorLinId == lot).Select(b => (int?)b.BorOrdre).MaxAsync(ct) ?? 0;
        var b = db.Bordereaux.Add(new BordereauEntite { BorLinId = lot, BorLibelle = string.IsNullOrWhiteSpace(s.Libelle) ? "Bordereau" : s.Libelle.Trim(), BorCompteur = s.Compteur, BorOrdre = ordre + 1 }).Entity;
        await db.SaveChangesAsync(ct);
        if (s.Lignes is { Count: > 0 }) await EcrireLignesAsync(b, s.Lignes, ct);
        return await LotAsync(lot, ct);
    }

    /// <summary>Enregistre un bordereau (libellé, compteur, lignes remplacées) ; le lot doit être en brouillon.</summary>
    public async Task<LotDetailDto> EnregistrerBordereauAsync(long id, BordereauSaisi s, Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        var b = await db.Bordereaux.FirstOrDefaultAsync(x => x.BorId == id, ct) ?? throw ExceptionMetier.Introuvable("Bordereau");
        await LotModifiable(b.BorLinId, ct);
        if (!string.IsNullOrWhiteSpace(s.Libelle)) b.BorLibelle = s.Libelle.Trim();
        b.BorCompteur = s.Compteur;
        if (s.Lignes is not null) await EcrireLignesAsync(b, s.Lignes, ct);
        else await db.SaveChangesAsync(ct);
        return await LotAsync(b.BorLinId, ct);
    }

    private async Task EcrireLignesAsync(BordereauEntite b, List<LigneBordereauDto> lignes, CancellationToken ct)
    {
        if (lignes.Any(l => l.Quantite is < 0)) throw ExceptionMetier.Invalide("INV_QUANTITE_NEGATIVE", ReglesInventaire.Messages["INV_QUANTITE_NEGATIVE"]);
        var lot = await db.LotsInventaire.AsNoTracking().FirstAsync(x => x.LinId == b.BorLinId, ct);
        var empsLieu = await db.Emplacements.AsNoTracking().Where(e => e.EmpLieuId == lot.LinLieuId).Select(e => e.EmpId).ToListAsync(ct);
        if (lignes.Any(l => l.Emp is { } e && !empsLieu.Contains(e))) throw ExceptionMetier.Invalide("STK_EMPLACEMENT", "Emplacement d'un autre lieu");
        var existantes = await db.LignesBordereau.Where(l => l.BliBorId == b.BorId).ToListAsync(ct);
        db.LignesBordereau.RemoveRange(existantes.Where(e => !lignes.Any(l => l.Id == e.BliId)));
        foreach (var (l, i) in lignes.Select((l, i) => (l, i)))
        {
            var e = existantes.FirstOrDefault(x => x.BliId == l.Id) ?? db.LignesBordereau.Add(new LigneBordereauEntite { BliBorId = b.BorId, BliTheorique = l.Theorique }).Entity;
            e.BliEleId = l.Ele;
            e.BliEmpId = l.Emp;
            e.BliQuantite = l.Quantite;
            e.BliPrix = l.Prix;
            e.BliAppliquerPmp = l.AppliquerPmp;
            e.BliCommentaire = string.IsNullOrWhiteSpace(l.Commentaire) ? null : l.Commentaire.Trim();
            e.BliOrdre = i;
        }
        await db.SaveChangesAsync(ct);
    }

    public async Task<LotDetailDto> SupprimerBordereauAsync(long id, Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        var b = await db.Bordereaux.FirstOrDefaultAsync(x => x.BorId == id, ct) ?? throw ExceptionMetier.Introuvable("Bordereau");
        await LotModifiable(b.BorLinId, ct);
        db.Bordereaux.Remove(b);
        await db.SaveChangesAsync(ct);
        return await LotAsync(b.BorLinId, ct);
    }

    /// <summary>Stock calculé à la date du lot (articles du lieu), hors comptages du lot lui-même.</summary>
    private async Task<Dictionary<long, decimal>> TheoriquesAsync(LotInventaireEntite lot, IReadOnlyCollection<long> ids, CancellationToken ct)
    {
        var fin = M(lot.LinDate);
        var mvts = await db.Mouvements.AsNoTracking().Where(m => m.MvtLieuId == lot.LinLieuId && ids.Contains(m.MvtEleId) && m.MvtDate <= lot.LinDate)
            .Select(m => new { m.MvtEleId, m.MvtDate, m.MvtQuantite }).ToListAsync(ct);
        var cpts = await db.Comptages.AsNoTracking().Where(c => c.CptLieuId == lot.LinLieuId && ids.Contains(c.CptEleId) && c.CptDate <= lot.LinDate && c.CptLinId != lot.LinId)
            .OrderBy(c => c.CptId).Select(c => new { c.CptEleId, c.CptDate, c.CptQuantite }).ToListAsync(ct);
        return ids.ToDictionary(id => id, id =>
        {
            var k = cpts.Where(c => c.CptEleId == id && M(c.CptDate) != fin).Select(c => new ComptageQuantite(M(c.CptDate), c.CptQuantite)).ToList();
            return ReglesStock.StockA(mvts.Where(m => m.MvtEleId == id).Select(m => new MouvementQuantite(M(m.MvtDate), m.MvtQuantite)).ToList(), k, fin).Quantite;
        });
    }

    /// <summary>
    /// Génère des bordereaux : par EMPLACEMENT (articles dont un emplacement habituel est dans la zone choisie ou en
    /// dessous), FAMILLE, MARQUE (articles gérés en stock), ou STOCK (articles qui ont un stock ou un mouvement dans le
    /// lieu) ; un bordereau par valeur choisie (ou un seul) ; quantité théorique à la date du lot.
    /// </summary>
    public async Task<LotDetailDto> GenererAsync(long lotId, GenerationSaisie g, Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        var lot = await LotModifiable(lotId, ct);
        var par = g.Par ?? "STOCK";
        var valeurs = g.Valeurs ?? [];
        var emps = await db.Emplacements.AsNoTracking().Where(e => e.EmpLieuId == lot.LinLieuId).ToListAsync(ct);
        var habituels = await (from a in db.ArticlesEmplacements join e in db.Emplacements on a.SaeEmpId equals e.EmpId
                               where e.EmpLieuId == lot.LinLieuId orderby a.SaeOrdre select new { a.SaeEleId, a.SaeEmpId }).ToListAsync(ct);
        long? EmpDe(long ele) => habituels.FirstOrDefault(h => h.SaeEleId == ele)?.SaeEmpId;
        var groupes = new List<(string Libelle, List<(long Ele, long? Emp)> Lignes)>();
        switch (par)
        {
            case "EMPLACEMENT":
                foreach (var v in valeurs)
                {
                    if (emps.FirstOrDefault(e => e.EmpId.ToString() == v) is not { } racine) continue;
                    var sous = new HashSet<long> { racine.EmpId };
                    for (var ajout = true; ajout;)
                    {
                        ajout = false;
                        foreach (var e in emps.Where(e => e.EmpParentId is { } p && sous.Contains(p) && !sous.Contains(e.EmpId))) { sous.Add(e.EmpId); ajout = true; }
                    }
                    var codes = emps.ToDictionary(e => e.EmpId, e => e.EmpCode);
                    groupes.Add(($"Emplacement {racine.EmpCode}{(racine.EmpLibelle is null ? "" : $" – {racine.EmpLibelle}")}",
                        habituels.Where(h => sous.Contains(h.SaeEmpId)).Select(h => (h.SaeEleId, (long?)h.SaeEmpId)).Distinct()
                            .OrderBy(x => codes[x.Item2!.Value], StringComparer.OrdinalIgnoreCase).ToList()));
                }
                break;
            case "FAMILLE":
                var familles = (await specialisation.FamillesAsync(db, ct)).ToDictionary(f => f.Id.ToString());
                foreach (var v in valeurs)
                {
                    if (!familles.TryGetValue(v, out var f)) continue;
                    var ids = await specialisation.ArticlesDeFamillesAsync(db, [f.Id], ct);
                    groupes.Add(($"Famille {f.Chemin}", ids.Select(i => (i, EmpDe(i))).ToList()));
                }
                break;
            case "MARQUE":
                var marques = await db.Marques.AsNoTracking().ToDictionaryAsync(m => m.MrqCode, ct);
                foreach (var v in valeurs)
                {
                    if (!marques.TryGetValue(v, out var m)) continue;
                    var ids = await db.ArticlesMarques.AsNoTracking().Where(x => x.SamMrqCode == v).Select(x => x.SamEleId).ToListAsync(ct);
                    groupes.Add(($"Marque {m.MrqLibelle}", ids.Select(i => (i, EmpDe(i))).ToList()));
                }
                break;
            case "STOCK":
                var presents = await db.Mouvements.AsNoTracking().Where(x => x.MvtLieuId == lot.LinLieuId).Select(x => x.MvtEleId)
                    .Union(db.Comptages.Where(x => x.CptLieuId == lot.LinLieuId).Select(x => x.CptEleId)).ToListAsync(ct);
                groupes.Add(("Articles du lieu", presents.Select(i => (i, EmpDe(i))).ToList()));
                break;
            default:
                throw ExceptionMetier.Invalide("STK_GENERATION", "Génération par EMPLACEMENT, FAMILLE, MARQUE ou STOCK");
        }
        if (!g.Separer && groupes.Count > 1) groupes = [(string.Join(", ", groupes.Select(x => x.Libelle)), groupes.SelectMany(x => x.Lignes).Distinct().ToList())];
        groupes = groupes.Where(x => x.Lignes.Count > 0).ToList();
        if (groupes.Count == 0) throw ExceptionMetier.Invalide("STK_GENERATION_VIDE", "Aucun article pour ces critères");
        var tous = groupes.SelectMany(x => x.Lignes.Select(l => l.Ele)).Distinct().ToList();
        var articles = await specialisation.ArticlesAsync(db, tous, ct);
        var theoriques = await TheoriquesAsync(lot, tous, ct);
        var ordre = await db.Bordereaux.Where(b => b.BorLinId == lotId).Select(b => (int?)b.BorOrdre).MaxAsync(ct) ?? 0;
        foreach (var (libelle, lignes) in groupes)
        {
            var b = db.Bordereaux.Add(new BordereauEntite
            {
                BorLinId = lotId, BorLibelle = libelle, BorOrdre = ++ordre,
                BorCritere = System.Text.Json.JsonSerializer.Serialize(new { par, valeurs }),
            }).Entity;
            await db.SaveChangesAsync(ct);
            var tri = par == "EMPLACEMENT" ? lignes : lignes.OrderBy(l => articles.GetValueOrDefault(l.Ele)?.Code ?? "", StringComparer.OrdinalIgnoreCase).ToList();
            foreach (var (l, i) in tri.Select((l, i) => (l, i)))
                db.LignesBordereau.Add(new LigneBordereauEntite { BliBorId = b.BorId, BliEleId = l.Ele, BliEmpId = l.Emp, BliTheorique = theoriques.GetValueOrDefault(l.Ele), BliOrdre = i });
            await db.SaveChangesAsync(ct);
        }
        return await LotAsync(lotId, ct);
    }

    // ------------------------------------------------------------------ écarts, validation

    /// <summary>Rapport d'écarts : par article compté, stock juste avant, compté, écart et valeurs à la date du lot.</summary>
    public async Task<EcartsLot> EcartsAsync(long id, CancellationToken ct)
    {
        await stock.ValoriserEnAttenteAsync(ct);
        var detail = await LotAsync(id, ct);
        var lot = await db.LotsInventaire.AsNoTracking().FirstAsync(x => x.LinId == id, ct);
        var methode = await stock.MethodeAsync(ct);
        var ids = detail.Controle.Comptages.Select(c => c.Ele).ToList();
        var articles = await specialisation.ArticlesAsync(db, ids, ct);
        var theoriques = await TheoriquesAsync(lot, ids, ct);
        var fin = M(lot.LinDate);
        var lignes = new List<EcartArticle>();
        foreach (var c in detail.Controle.Comptages)
        {
            var a = articles.GetValueOrDefault(c.Ele);
            var mv = await db.Mouvements.AsNoTracking().Where(x => x.MvtEleId == c.Ele).OrderBy(x => x.MvtId).ToListAsync(ct);
            var ck = await db.Comptages.AsNoTracking().Where(x => x.CptEleId == c.Ele && x.CptLinId != id).OrderBy(x => x.CptId).ToListAsync(ct);
            var rv = await db.Reevaluations.AsNoTracking().Where(x => x.RevEleId == c.Ele && x.RevLinId != id).OrderBy(x => x.RevId).ToListAsync(ct);
            var v = ReglesValorisation.Valoriser(mv.Select(x => new MouvementValorise(x.MvtId, x.MvtLieuId, M(x.MvtDate), x.MvtQuantite, x.MvtPrix, x.MvtProvisoire)).ToList(),
                ck.Select(x => new ComptageLieu(x.CptLieuId, M(x.CptDate), x.CptQuantite)).ToList(), rv.Select(x => new Reevaluation(M(x.RevDate), x.RevPmp)).ToList(), fin);
            var u = ReglesValorisation.Valeur(v, methode, a?.PaRepli);
            var theo = theoriques.GetValueOrDefault(c.Ele);
            var ecart = c.Quantite - theo;
            lignes.Add(new EcartArticle(c.Ele, a?.Code ?? c.Ele.ToString(), a?.Libelle ?? "", a?.Unite ?? "", a?.Precision ?? 2, theo, c.Quantite, ecart, u.Valeur, u.Source,
                u.Valeur is { } pu ? Math.Round(ecart * pu, 2, MidpointRounding.AwayFromZero) : null, c.Prix,
                (c.Prix ?? u.Valeur) is { } pi ? Math.Round(c.Quantite * pi, 2, MidpointRounding.AwayFromZero) : null, c.AppliquerPmp, c.Commentaire));
        }
        return new EcartsLot(id, fin, methode, lignes, lignes.Sum(l => l.ValeurEcart ?? 0), lignes.Sum(l => l.ValeurInventaire ?? 0));
    }

    /// <summary>
    /// Validation du lot : contrôle partagé (erreurs refusées), un comptage par article à la date du lot (refusé si un
    /// autre lot a déjà compté l'article dans ce lieu à la même minute, S6), réévaluation du PMP si demandée (S30).
    /// </summary>
    public async Task<LotDetailDto> ValiderLotAsync(long id, Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        var lot = await LotModifiable(id, ct);
        if (lot.LinDate > Instant(null)) throw ExceptionMetier.Invalide("STK_DATE_FUTURE", "Date-heure du comptage à venir");
        var detail = await LotAsync(id, ct);
        var c = detail.Controle;
        if (c.Erreurs.Count > 0)
            throw ExceptionMetier.Invalide("STK_INVENTAIRE", "Le lot comporte des erreurs", c.Erreurs.Select(e => new { e.Code, e.Ele, message = ReglesInventaire.Messages[e.Code] }));
        if (c.Comptages.Count == 0) throw ExceptionMetier.Invalide("STK_INVENTAIRE_VIDE", "Aucune quantité comptée dans le lot");
        var ids = c.Comptages.Select(x => x.Ele).ToList();
        var deja = await db.Comptages.AsNoTracking().Where(x => x.CptLieuId == lot.LinLieuId && ids.Contains(x.CptEleId) && x.CptDate == lot.LinDate).Select(x => x.CptEleId).ToListAsync(ct);
        if (deja.Count > 0) throw ExceptionMetier.Conflit("STK_COMPTAGE_EXISTANT", "Article déjà compté dans ce lieu à la même date-heure par un autre lot", deja);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        foreach (var x in c.Comptages)
        {
            db.Comptages.Add(new ComptageEntite
            {
                CptEleId = x.Ele, CptLieuId = lot.LinLieuId, CptDate = lot.LinDate, CptQuantite = x.Quantite, CptPrix = x.Prix, CptCommentaire = x.Commentaire,
                CptLinId = id, CptPar = u.Code,
            });
            if (x.AppliquerPmp && x.Prix is { } prix)
                db.Reevaluations.Add(new ReevaluationEntite
                {
                    RevEleId = x.Ele, RevDate = lot.LinDate, RevPmp = Math.Round(prix, 6, MidpointRounding.AwayFromZero), RevLinId = id, RevPar = u.Code,
                    RevCommentaire = $"Inventaire « {lot.LinLibelle} »{(x.Commentaire is null ? "" : $" : {x.Commentaire}")}",
                });
        }
        lot.LinEtat = "VALIDE";
        lot.LinValidePar = u.Code;
        lot.LinValideLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        await stock.ValoriserEnAttenteAsync(ct);
        // Pièce des écarts valorisés (pièce comptable de l'application), écarts lus avant les comptages du lot.
        if (await specialisation.ApresValidationLotAsync(db, lot, await EcartsAsync(id, ct), u, ct) is { } piece)
        {
            lot.LinEntId = piece;
            await db.SaveChangesAsync(ct);
        }
        return await LotAsync(id, ct);
    }

    /// <summary>Annule un lot validé : ses comptages et réévaluations sont retirés (le stock se recalcule sans eux).</summary>
    public async Task<LotDetailDto> AnnulerLotAsync(long id, Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        var lot = await db.LotsInventaire.FirstOrDefaultAsync(x => x.LinId == id, ct) ?? throw ExceptionMetier.Introuvable("Lot d'inventaire");
        if (lot.LinEtat != "VALIDE") throw ExceptionMetier.Conflit("STK_LOT_NON_VALIDE", "Seul un lot validé s'annule (un brouillon se supprime)");
        await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM stk_comptage WHERE cpt_lin_id = {id}", ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM stk_reevaluation WHERE rev_lin_id = {id}", ct);
        lot.LinEtat = "ANNULE";
        await db.SaveChangesAsync(ct);
        await stock.ValoriserEnAttenteAsync(ct);
        // Pièce des écarts annulée, ou contre-passée si elle a déjà été transférée en comptabilité.
        if (await specialisation.ApresAnnulationLotAsync(db, lot, u, ct) is { } extourne)
        {
            lot.LinExtourneEntId = extourne;
            await db.SaveChangesAsync(ct);
        }
        return await LotAsync(id, ct);
    }

    /// <summary>Micro-inventaire (S8) : un lot d'un article et d'une ligne, validé d'office (maintenant par défaut).</summary>
    public async Task<FicheStockArticle> CorrigerAsync(long ele, CorrectionSaisie s, Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        if (s.Quantite is not { } q || q < 0) throw ExceptionMetier.Invalide("INV_QUANTITE", "Quantité comptée positive ou nulle obligatoire");
        var article = (await specialisation.ArticlesAsync(db, [ele], ct)).GetValueOrDefault(ele) ?? throw ExceptionMetier.Introuvable("Article");
        var detail = await CreerLotAsync(new LotSaisi(s.Lieu, s.Date, $"Correction {article.Code}", s.Commentaire), u, ct);
        var lot = await db.LotsInventaire.FirstAsync(x => x.LinId == detail.Lot.Id, ct);
        lot.LinMicro = true;
        await db.SaveChangesAsync(ct);
        var theo = (await TheoriquesAsync(lot, [ele], ct)).GetValueOrDefault(ele);
        await AjouterBordereauAsync(lot.LinId, new BordereauSaisi($"Correction {article.Code}", u.Code,
            [new LigneBordereauDto(null, ele, null, null, null, 0, s.Emp, null, q, theo, s.Prix, s.AppliquerPmp, s.Commentaire)]), u, ct);
        await ValiderLotAsync(lot.LinId, u, ct);
        return await stock.FicheArticleAsync(ele, ct);
    }

    // ------------------------------------------------------------------ marques

    public async Task<List<MarqueDto>> MarquesAsync(CancellationToken ct) =>
        await db.Marques.AsNoTracking().OrderBy(m => m.MrqOrdre).ThenBy(m => m.MrqCode)
            .Select(m => new MarqueDto(m.MrqCode, m.MrqLibelle, m.MrqCouleur, m.MrqOrdre, m.MrqActif)).ToListAsync(ct);

    /// <summary>Remplace la liste des marques ; une marque retirée encore portée par des articles est désactivée.</summary>
    public async Task<List<MarqueDto>> EnregistrerMarquesAsync(List<MarqueDto> l, Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        var codes = l.Select(m => m.Code.Trim().ToUpperInvariant()).ToList();
        if (codes.Any(string.IsNullOrEmpty) || codes.Distinct().Count() != codes.Count) throw ExceptionMetier.Invalide("STK_MARQUE_CODE", "Code de marque obligatoire et unique");
        var existantes = await db.Marques.ToListAsync(ct);
        var portees = await db.ArticlesMarques.Select(x => x.SamMrqCode).Distinct().ToListAsync(ct);
        foreach (var m in existantes.Where(m => !codes.Contains(m.MrqCode)))
        {
            if (portees.Contains(m.MrqCode)) m.MrqActif = false;
            else db.Marques.Remove(m);
        }
        foreach (var (m, i) in l.Select((m, i) => (m, i)))
        {
            var e = existantes.FirstOrDefault(x => x.MrqCode == codes[i]) ?? db.Marques.Add(new MarqueEntite { MrqCode = codes[i] }).Entity;
            e.MrqLibelle = string.IsNullOrWhiteSpace(m.Libelle) ? codes[i] : m.Libelle.Trim();
            e.MrqCouleur = m.Couleur;
            e.MrqOrdre = i;
            e.MrqActif = m.Actif;
        }
        await db.SaveChangesAsync(ct);
        return await MarquesAsync(ct);
    }

    public async Task<List<string>> MarquesArticleAsync(long ele, CancellationToken ct) =>
        await db.ArticlesMarques.AsNoTracking().Where(x => x.SamEleId == ele).OrderBy(x => x.SamMrqCode).Select(x => x.SamMrqCode).ToListAsync(ct);

    /// <summary>Marquage d'un ou plusieurs articles : marques ajoutées et retirées (saisie en masse depuis les listes).</summary>
    public async Task<int> MarquerAsync(MarquageSaisi s, Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        var articles = (s.Articles ?? []).Distinct().ToList();
        var connues = await db.Marques.Select(m => m.MrqCode).ToListAsync(ct);
        var ajouter = (s.Ajouter ?? []).Where(connues.Contains).ToList();
        var retirer = (s.Retirer ?? []).ToList();
        var existants = await db.ArticlesMarques.Where(x => articles.Contains(x.SamEleId)).ToListAsync(ct);
        db.ArticlesMarques.RemoveRange(existants.Where(x => retirer.Contains(x.SamMrqCode)));
        foreach (var a in articles)
            foreach (var m in ajouter.Where(m => !existants.Any(x => x.SamEleId == a && x.SamMrqCode == m)))
                db.ArticlesMarques.Add(new ArticleMarqueEntite { SamEleId = a, SamMrqCode = m });
        await db.SaveChangesAsync(ct);
        return articles.Count;
    }

    /// <summary>Articles gérés en stock (bordereaux, magasin, borne), avec leurs marques et leur type de dotation.</summary>
    public async Task<object> ArticlesAsync(CancellationToken ct)
    {
        var l = await specialisation.ArticlesGeresAsync(db, ct);
        var marques = await db.ArticlesMarques.AsNoTracking().ToListAsync(ct);
        var dotations = await db.ArticlesDotation.AsNoTracking().ToDictionaryAsync(d => d.SadEleId, ct);
        return l.Select(a => new
        {
            a.Id, a.Code, a.Libelle, a.Unite, a.Precision, marques = marques.Where(m => m.SamEleId == a.Id).Select(m => m.SamMrqCode).ToList(),
            dotation = dotations.GetValueOrDefault(a.Id)?.SadType, duree_mois = dotations.GetValueOrDefault(a.Id)?.SadDureeMois,
        });
    }

    public async Task<DotationArticleDto> DotationArticleAsync(long ele, CancellationToken ct)
    {
        var d = await db.ArticlesDotation.AsNoTracking().FirstOrDefaultAsync(x => x.SadEleId == ele, ct);
        return new(d?.SadType, d?.SadDureeMois);
    }

    /// <summary>Type de dotation d'un article (EPI, OUTILLAGE ; vide : pas de dotation) et durée de vie en mois.</summary>
    public async Task<DotationArticleDto> DefinirDotationAsync(long ele, DotationArticleDto s, Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        if (s.Type is not (null or "" or "EPI" or "OUTILLAGE")) throw ExceptionMetier.Invalide("STK_DOTATION", "Dotation EPI ou OUTILLAGE");
        if (s.DureeMois is <= 0) throw ExceptionMetier.Invalide("STK_DOTATION", "Durée de vie positive (mois)");
        var d = await db.ArticlesDotation.FirstOrDefaultAsync(x => x.SadEleId == ele, ct);
        if (string.IsNullOrEmpty(s.Type)) { if (d is not null) db.ArticlesDotation.Remove(d); }
        else
        {
            d ??= db.ArticlesDotation.Add(new ArticleDotationEntite { SadEleId = ele }).Entity;
            d.SadType = s.Type;
            d.SadDureeMois = s.DureeMois;
        }
        await db.SaveChangesAsync(ct);
        return await DotationArticleAsync(ele, ct);
    }

    public Task<List<FamilleStock>> FamillesAsync(CancellationToken ct) => specialisation.FamillesAsync(db, ct);
}

public static class ExtensionsInventaire
{
    /// <summary>Routes des inventaires et des marques (sous le groupe /stock du module).</summary>
    public static RouteGroupBuilder MapInventaires(this RouteGroupBuilder g)
    {
        g.MapGet("/inventaires", (long? lieu, ServiceInventaire s, CancellationToken ct) => s.LotsAsync(lieu, ct));
        g.MapPost("/inventaires", (LotSaisi l, HttpContext http, ServiceInventaire s, CancellationToken ct) => s.CreerLotAsync(l, Utilisateur.Depuis(http), ct));
        g.MapGet("/inventaires/{id:long}", (long id, ServiceInventaire s, CancellationToken ct) => s.LotAsync(id, ct));
        g.MapPut("/inventaires/{id:long}", (long id, LotSaisi l, HttpContext http, ServiceInventaire s, CancellationToken ct) => s.ModifierLotAsync(id, l, Utilisateur.Depuis(http), ct));
        g.MapDelete("/inventaires/{id:long}", async (long id, HttpContext http, ServiceInventaire s, CancellationToken ct) =>
        {
            await s.SupprimerLotAsync(id, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapPost("/inventaires/{id:long}/bordereaux", (long id, BordereauSaisi b, HttpContext http, ServiceInventaire s, CancellationToken ct) => s.AjouterBordereauAsync(id, b, Utilisateur.Depuis(http), ct));
        g.MapPost("/inventaires/{id:long}/generer", (long id, GenerationSaisie x, HttpContext http, ServiceInventaire s, CancellationToken ct) => s.GenererAsync(id, x, Utilisateur.Depuis(http), ct));
        g.MapGet("/inventaires/{id:long}/ecarts", (long id, ServiceInventaire s, CancellationToken ct) => s.EcartsAsync(id, ct));
        g.MapPost("/inventaires/{id:long}/valider", (long id, HttpContext http, ServiceInventaire s, CancellationToken ct) => s.ValiderLotAsync(id, Utilisateur.Depuis(http), ct));
        g.MapPost("/inventaires/{id:long}/annuler", (long id, HttpContext http, ServiceInventaire s, CancellationToken ct) => s.AnnulerLotAsync(id, Utilisateur.Depuis(http), ct));
        g.MapPut("/bordereaux/{id:long}", (long id, BordereauSaisi b, HttpContext http, ServiceInventaire s, CancellationToken ct) => s.EnregistrerBordereauAsync(id, b, Utilisateur.Depuis(http), ct));
        g.MapDelete("/bordereaux/{id:long}", (long id, HttpContext http, ServiceInventaire s, CancellationToken ct) => s.SupprimerBordereauAsync(id, Utilisateur.Depuis(http), ct));
        g.MapPost("/articles/{id:long}/corriger", (long id, CorrectionSaisie c, HttpContext http, ServiceInventaire s, CancellationToken ct) => s.CorrigerAsync(id, c, Utilisateur.Depuis(http), ct));
        g.MapGet("/articles/{id:long}/marques", (long id, ServiceInventaire s, CancellationToken ct) => s.MarquesArticleAsync(id, ct));
        g.MapGet("/articles", (ServiceInventaire s, CancellationToken ct) => s.ArticlesAsync(ct));
        g.MapGet("/articles/{id:long}/dotation", (long id, ServiceInventaire s, CancellationToken ct) => s.DotationArticleAsync(id, ct));
        g.MapPut("/articles/{id:long}/dotation", (long id, DotationArticleDto d, HttpContext http, ServiceInventaire s, CancellationToken ct) => s.DefinirDotationAsync(id, d, Utilisateur.Depuis(http), ct));
        g.MapGet("/familles", (ServiceInventaire s, CancellationToken ct) => s.FamillesAsync(ct));
        g.MapGet("/marques", (ServiceInventaire s, CancellationToken ct) => s.MarquesAsync(ct));
        g.MapPut("/marques", (List<MarqueDto> l, HttpContext http, ServiceInventaire s, CancellationToken ct) => s.EnregistrerMarquesAsync(l, Utilisateur.Depuis(http), ct));
        g.MapPost("/marquer", async (MarquageSaisi m, HttpContext http, ServiceInventaire s, CancellationToken ct) => Results.Ok(new { articles = await s.MarquerAsync(m, Utilisateur.Depuis(http), ct) }));
        return g;
    }
}
