using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Stock.Web;

public class ParametreStockEntite
{
    public short SpaId { get; set; } = 1;
    public string SpaMethode { get; set; } = "PMP";
    public string? SpaMajPar { get; set; }
    public DateTimeOffset SpaMajLe { get; set; } = DateTimeOffset.UtcNow;
}

public class EmplacementEntite
{
    public long EmpId { get; set; }
    public long EmpLieuId { get; set; }
    public long? EmpParentId { get; set; }
    public string EmpCode { get; set; } = "";
    public string? EmpLibelle { get; set; }
    public string EmpNiveau { get; set; } = "ZONE";
    public int EmpOrdre { get; set; }
    public bool EmpActif { get; set; } = true;
}

public class ArticleEmplacementEntite
{
    public long SaeEleId { get; set; }
    public long SaeEmpId { get; set; }
    public int SaeOrdre { get; set; }
}

public class MouvementEntite
{
    public long MvtId { get; set; }
    public long MvtEleId { get; set; }
    public long MvtLieuId { get; set; }
    public long? MvtEmpId { get; set; }
    public DateTimeOffset MvtDate { get; set; }
    public decimal MvtQuantite { get; set; }
    public decimal? MvtPrix { get; set; }
    public bool MvtProvisoire { get; set; }
    public long? MvtPrixEntId { get; set; }
    public decimal? MvtPmp { get; set; }
    public string MvtOrigine { get; set; } = "DOCUMENT";
    public long? MvtEntId { get; set; }
    public long? MvtLigId { get; set; }
    public long? MvtTiersId { get; set; }
    public long? MvtIndId { get; set; }
    public string? MvtTracabilite { get; set; }
    public DateTimeOffset MvtCreeLe { get; set; } = DateTimeOffset.UtcNow;
}

public class ComptageEntite
{
    public long CptId { get; set; }
    public long CptEleId { get; set; }
    public long CptLieuId { get; set; }
    public DateTimeOffset CptDate { get; set; }
    public decimal CptQuantite { get; set; }
    public decimal? CptPrix { get; set; }
    public string? CptCommentaire { get; set; }
    public long? CptEntId { get; set; }
    public long? CptLinId { get; set; }
    public string? CptPar { get; set; }
    public DateTimeOffset CptLe { get; set; } = DateTimeOffset.UtcNow;
}

public class ReevaluationEntite
{
    public long RevId { get; set; }
    public long RevEleId { get; set; }
    public DateTimeOffset RevDate { get; set; }
    public decimal RevPmp { get; set; }
    public decimal? RevAncienPmp { get; set; }
    public string? RevCommentaire { get; set; }
    public string RevPar { get; set; } = "";
    public long? RevLinId { get; set; }
    public DateTimeOffset RevLe { get; set; } = DateTimeOffset.UtcNow;
}

public class ValeurEntite
{
    public long SvaEleId { get; set; }
    public decimal? SvaPmp { get; set; }
    public decimal? SvaDernierPa { get; set; }
    public long? SvaDernierPaMvtId { get; set; }
    public DateTimeOffset? SvaDernierPaDate { get; set; }
    public bool SvaProvisoire { get; set; }
    public DateTimeOffset SvaCalculeLe { get; set; } = DateTimeOffset.UtcNow;
}

public class AValoriserEntite
{
    public long SavEleId { get; set; }
    public DateTimeOffset SavLe { get; set; }
}

public class StockDbContext(DbContextOptions<StockDbContext> options) : DbContext(options)
{
    public DbSet<ParametreStockEntite> Parametres => Set<ParametreStockEntite>();
    public DbSet<EmplacementEntite> Emplacements => Set<EmplacementEntite>();
    public DbSet<ArticleEmplacementEntite> ArticlesEmplacements => Set<ArticleEmplacementEntite>();
    public DbSet<MouvementEntite> Mouvements => Set<MouvementEntite>();
    public DbSet<ComptageEntite> Comptages => Set<ComptageEntite>();
    public DbSet<ReevaluationEntite> Reevaluations => Set<ReevaluationEntite>();
    public DbSet<ValeurEntite> Valeurs => Set<ValeurEntite>();
    public DbSet<AValoriserEntite> AValoriser => Set<AValoriserEntite>();
    public DbSet<LotInventaireEntite> LotsInventaire => Set<LotInventaireEntite>();
    public DbSet<BordereauEntite> Bordereaux => Set<BordereauEntite>();
    public DbSet<LigneBordereauEntite> LignesBordereau => Set<LigneBordereauEntite>();
    public DbSet<MarqueEntite> Marques => Set<MarqueEntite>();
    public DbSet<ArticleMarqueEntite> ArticlesMarques => Set<ArticleMarqueEntite>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<ParametreStockEntite>().ToTable("stk_parametre").HasKey(x => x.SpaId);
        b.Entity<EmplacementEntite>().ToTable("stk_emplacement").HasKey(x => x.EmpId);
        b.Entity<ArticleEmplacementEntite>().ToTable("stk_article_emplacement").HasKey(x => new { x.SaeEleId, x.SaeEmpId });
        b.Entity<MouvementEntite>().ToTable("stk_mouvement").HasKey(x => x.MvtId);
        b.Entity<ComptageEntite>().ToTable("stk_comptage").HasKey(x => x.CptId);
        b.Entity<ReevaluationEntite>().ToTable("stk_reevaluation").HasKey(x => x.RevId);
        b.Entity<ValeurEntite>().ToTable("stk_valeur").HasKey(x => x.SvaEleId);
        b.Entity<AValoriserEntite>().ToTable("stk_a_valoriser").HasKey(x => x.SavEleId);
        b.Entity<LotInventaireEntite>().ToTable("stk_lot_inventaire").HasKey(x => x.LinId);
        b.Entity<BordereauEntite>().ToTable("stk_bordereau").HasKey(x => x.BorId);
        b.Entity<BordereauEntite>().Property(x => x.BorCritere).HasColumnType("jsonb");
        b.Entity<LigneBordereauEntite>().ToTable("stk_bordereau_ligne").HasKey(x => x.BliId);
        b.Entity<MarqueEntite>().ToTable("stk_marque").HasKey(x => x.MrqCode);
        b.Entity<ArticleMarqueEntite>().ToTable("stk_article_marque").HasKey(x => new { x.SamEleId, x.SamMrqCode });
    }
}

/// <summary>Lieu de stock vu par le module (chantier pour le cœur) : dépôt géré ou lieu qui tient un stock.</summary>
public sealed record LieuStock(long Id, string Code, string Libelle, bool Depot);

/// <summary>Article géré en stock : unité de stock, précision des quantités (S22), PA de repli (bibliothèque).</summary>
public sealed record ArticleStock(long Id, string Code, string Libelle, string Unite, int Precision, decimal? PaRepli);

/// <summary>Pièce à l'origine d'un mouvement : numéro, type, tiers.</summary>
public sealed record PieceStock(long Id, string Numero, string Type, string? Tiers);

public sealed record ParametresStockDto(string Methode);
public sealed record EmplacementDto(long? Id, string Code, string? Libelle, string Niveau, string? Parent, int Ordre, bool Actif);
public sealed record LigneEtatStock(long EleId, string Code, string Libelle, string Unite, int Precision, decimal Quantite, decimal? ValeurUnitaire,
    string? Source, bool Provisoire, decimal? Valeur, string? DernierMouvement, List<string> Emplacements);
public sealed record EtatStock(long Lieu, string Date, string Methode, decimal Valeur, List<LigneEtatStock> Lignes);
public sealed record QuantiteLieu(long Lieu, string Code, string Libelle, bool Depot, decimal Quantite, string? DernierComptage);
public sealed record MouvementDto(long Id, string Date, long Lieu, string? LieuCode, decimal Quantite, decimal? Prix, bool Provisoire, decimal? Pmp,
    string Origine, long? EntId, string? Piece, string? TypePiece, string? Tiers);
public sealed record ReevaluationDto(long Id, string Date, decimal Pmp, decimal? AncienPmp, string? Commentaire, string Par);
public sealed record FicheStockArticle(long EleId, string Unite, int Precision, string Methode, decimal? Pmp, decimal? DernierPa, string? DernierPaDate,
    bool Provisoire, PieceStock? DernierPaPiece, decimal? ValeurUnitaire, string? Source, decimal Quantite, List<QuantiteLieu> Lieux,
    List<MouvementDto> Mouvements, List<ReevaluationDto> Reevaluations, List<long> Emplacements);
public sealed record ReevaluationSaisie(decimal? Pmp, string? Commentaire, DateTimeOffset? Date);

/// <summary>
/// Spécialisation par l'application (méthode patron) : lieux de stock, articles, pièces d'origine des mouvements, suite
/// d'une revalorisation (prix de l'article), droit de gérer le stock. Les mouvements sont écrits par l'application à la
/// validation de ses pièces (même transaction), jamais par le module.
/// </summary>
public abstract class SpecialisationStock
{
    public abstract Task<List<LieuStock>> LieuxAsync(StockDbContext db, CancellationToken ct);
    public abstract Task<Dictionary<long, ArticleStock>> ArticlesAsync(StockDbContext db, IReadOnlyCollection<long> ids, CancellationToken ct);
    public abstract Task<Dictionary<long, PieceStock>> PiecesAsync(StockDbContext db, IReadOnlyCollection<long> ids, CancellationToken ct);
    /// <summary>Articles gérés en stock (lignes des bordereaux, magasin).</summary>
    public abstract Task<List<ArticleStock>> ArticlesGeresAsync(StockDbContext db, CancellationToken ct);
    /// <summary>Familles d'articles (génération des bordereaux par famille) et articles gérés en stock de familles (sous-familles comprises).</summary>
    public abstract Task<List<FamilleStock>> FamillesAsync(StockDbContext db, CancellationToken ct);
    public abstract Task<List<long>> ArticlesDeFamillesAsync(StockDbContext db, IReadOnlyCollection<long> familles, CancellationToken ct);
    /// <summary>Après la revalorisation d'un article (PMP, dernier prix d'achat de l'article).</summary>
    public virtual Task ApresValorisationAsync(StockDbContext db, long ele, Valorisation v, CancellationToken ct) => Task.CompletedTask;
    /// <summary>Paramètres, emplacements et réévaluations : administrateur par défaut.</summary>
    public virtual Task<bool> PeutGererAsync(StockDbContext db, Utilisateur u, CancellationToken ct) => Task.FromResult(u.EstAdmin);
}

public class ServiceStock(StockDbContext db, SpecialisationStock specialisation)
{
    private static string M(DateTimeOffset d) => ReglesStock.Minute(d);

    /// <summary>Date-heure demandée ramenée à la minute (maintenant par défaut).</summary>
    private static DateTimeOffset Instant(DateTimeOffset? d)
    {
        var x = (d ?? DateTimeOffset.UtcNow).ToUniversalTime();
        return new DateTimeOffset(x.Year, x.Month, x.Day, x.Hour, x.Minute, 0, TimeSpan.Zero);
    }

    private async Task ExigerGestion(Utilisateur u, CancellationToken ct)
    {
        if (!await specialisation.PeutGererAsync(db, u, ct)) throw ExceptionMetier.AccesRefuse("GERER_STOCK");
    }

    public async Task<string> MethodeAsync(CancellationToken ct) =>
        (await db.Parametres.AsNoTracking().FirstOrDefaultAsync(ct))?.SpaMethode ?? "PMP";

    public async Task<ParametresStockDto> ParametresAsync(CancellationToken ct) => new(await MethodeAsync(ct));

    public async Task<ParametresStockDto> EnregistrerParametresAsync(ParametresStockDto p, Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        if (!ReglesValorisation.Methodes.Contains(p.Methode)) throw ExceptionMetier.Invalide("STK_METHODE", "Méthode de valorisation inconnue (PMP ou DERNIER_PA)");
        var x = await db.Parametres.FirstOrDefaultAsync(ct) ?? db.Parametres.Add(new ParametreStockEntite()).Entity;
        x.SpaMethode = p.Methode;
        x.SpaMajPar = u.Code;
        x.SpaMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return new(x.SpaMethode);
    }

    public Task<List<LieuStock>> LieuxAsync(CancellationToken ct) => specialisation.LieuxAsync(db, ct);

    // ------------------------------------------------------------------ emplacements

    public async Task<List<EmplacementDto>> EmplacementsAsync(long lieu, CancellationToken ct)
    {
        var l = await db.Emplacements.AsNoTracking().Where(e => e.EmpLieuId == lieu).OrderBy(e => e.EmpOrdre).ThenBy(e => e.EmpCode).ToListAsync(ct);
        var codes = l.ToDictionary(e => e.EmpId, e => e.EmpCode);
        return l.Select(e => new EmplacementDto(e.EmpId, e.EmpCode, e.EmpLibelle, e.EmpNiveau, e.EmpParentId is { } p ? codes.GetValueOrDefault(p) : null, e.EmpOrdre, e.EmpActif)).ToList();
    }

    /// <summary>Remplace les emplacements du lieu : parent désigné par son code ; un emplacement retiré est supprimé.</summary>
    public async Task<List<EmplacementDto>> EnregistrerEmplacementsAsync(long lieu, List<EmplacementDto> saisis, Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        var codes = saisis.Select(s => s.Code.Trim().ToUpperInvariant()).ToList();
        if (codes.Any(string.IsNullOrEmpty)) throw ExceptionMetier.Invalide("STK_EMPLACEMENT_CODE", "Code d'emplacement obligatoire");
        if (codes.Distinct().Count() != codes.Count) throw ExceptionMetier.Invalide("STK_EMPLACEMENT_DOUBLON", "Deux emplacements ont le même code");
        foreach (var s in saisis)
            if (s.Parent is { } p && !string.IsNullOrWhiteSpace(p) && (!codes.Contains(p.Trim().ToUpperInvariant()) || p.Trim().ToUpperInvariant() == s.Code.Trim().ToUpperInvariant()))
                throw ExceptionMetier.Invalide("STK_EMPLACEMENT_PARENT", $"Emplacement {s.Code} : parent {p} inconnu");
        var existants = await db.Emplacements.Where(e => e.EmpLieuId == lieu).ToListAsync(ct);
        var gardes = saisis.Where(s => s.Id is not null).Select(s => s.Id!.Value).ToHashSet();
        db.Emplacements.RemoveRange(existants.Where(e => !gardes.Contains(e.EmpId)));
        var parCode = new Dictionary<string, EmplacementEntite>();
        foreach (var (s, i) in saisis.Select((s, i) => (s, i)))
        {
            var e = existants.FirstOrDefault(x => x.EmpId == s.Id) ?? db.Emplacements.Add(new EmplacementEntite { EmpLieuId = lieu }).Entity;
            e.EmpCode = codes[i];
            e.EmpLibelle = string.IsNullOrWhiteSpace(s.Libelle) ? null : s.Libelle.Trim();
            e.EmpNiveau = s.Niveau;
            e.EmpOrdre = s.Ordre;
            e.EmpActif = s.Actif;
            e.EmpParentId = null;
            parCode[e.EmpCode] = e;
        }
        await db.SaveChangesAsync(ct);
        foreach (var s in saisis.Where(s => !string.IsNullOrWhiteSpace(s.Parent)))
            parCode[s.Code.Trim().ToUpperInvariant()].EmpParentId = parCode[s.Parent!.Trim().ToUpperInvariant()].EmpId;
        await db.SaveChangesAsync(ct);
        return await EmplacementsAsync(lieu, ct);
    }

    public async Task DefinirEmplacementsArticleAsync(long ele, List<long> emplacements, Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        db.ArticlesEmplacements.RemoveRange(await db.ArticlesEmplacements.Where(x => x.SaeEleId == ele).ToListAsync(ct));
        foreach (var (e, i) in emplacements.Distinct().Select((e, i) => (e, i))) db.ArticlesEmplacements.Add(new ArticleEmplacementEntite { SaeEleId = ele, SaeEmpId = e, SaeOrdre = i });
        await db.SaveChangesAsync(ct);
    }

    // ------------------------------------------------------------------ valorisation

    /// <summary>Événements d'un article (tous lieux) dans l'ordre de leurs identifiants (à minute égale : le dernier écrit).</summary>
    private async Task<(List<MouvementValorise> M, List<ComptageLieu> C, List<Reevaluation> R)> EvenementsAsync(long ele, CancellationToken ct)
    {
        var m = await db.Mouvements.AsNoTracking().Where(x => x.MvtEleId == ele).OrderBy(x => x.MvtId)
            .Select(x => new { x.MvtId, x.MvtLieuId, x.MvtDate, x.MvtQuantite, x.MvtPrix, x.MvtProvisoire }).ToListAsync(ct);
        var c = await db.Comptages.AsNoTracking().Where(x => x.CptEleId == ele).OrderBy(x => x.CptId).Select(x => new { x.CptLieuId, x.CptDate, x.CptQuantite }).ToListAsync(ct);
        var r = await db.Reevaluations.AsNoTracking().Where(x => x.RevEleId == ele).OrderBy(x => x.RevId).Select(x => new { x.RevDate, x.RevPmp }).ToListAsync(ct);
        return (m.Select(x => new MouvementValorise(x.MvtId, x.MvtLieuId, M(x.MvtDate), x.MvtQuantite, x.MvtPrix, x.MvtProvisoire)).ToList(),
            c.Select(x => new ComptageLieu(x.CptLieuId, M(x.CptDate), x.CptQuantite)).ToList(),
            r.Select(x => new Reevaluation(M(x.RevDate), x.RevPmp)).ToList());
    }

    /// <summary>Revalorise un article : rejeu de ses événements, PMP de chaque mouvement, valeur courante, suite de l'application.</summary>
    public async Task<Valorisation> ValoriserAsync(long ele, CancellationToken ct)
    {
        var (m, c, r) = await EvenementsAsync(ele, ct);
        var v = ReglesValorisation.Valoriser(m, c, r);
        var actuels = await db.Mouvements.Where(x => x.MvtEleId == ele).ToDictionaryAsync(x => x.MvtId, ct);
        foreach (var h in v.Historique) if (actuels.TryGetValue(h.Id, out var x) && x.MvtPmp != h.Pmp) x.MvtPmp = h.Pmp;
        var valeur = await db.Valeurs.FirstOrDefaultAsync(x => x.SvaEleId == ele, ct) ?? db.Valeurs.Add(new ValeurEntite { SvaEleId = ele }).Entity;
        valeur.SvaPmp = v.Pmp;
        valeur.SvaDernierPa = v.DernierPa;
        valeur.SvaDernierPaMvtId = v.DernierPaId;
        valeur.SvaDernierPaDate = v.DernierPaId is { } id && actuels.TryGetValue(id, out var dm) ? dm.MvtDate : null;
        valeur.SvaProvisoire = v.Provisoire;
        valeur.SvaCalculeLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        await specialisation.ApresValorisationAsync(db, ele, v, ct);
        return v;
    }

    /// <summary>Articles marqués par les triggers (événement ajouté, modifié, retiré) : revalorisés avant toute lecture.</summary>
    public async Task ValoriserEnAttenteAsync(CancellationToken ct)
    {
        var l = await db.AValoriser.AsNoTracking().OrderBy(x => x.SavLe).Take(500).ToListAsync(ct);
        foreach (var a in l)
        {
            await ValoriserAsync(a.SavEleId, ct);
            await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM stk_a_valoriser WHERE sav_ele_id = {a.SavEleId} AND sav_le <= {a.SavLe}", ct);
        }
    }

    /// <summary>Tout revaloriser (administrateur) : chaque article qui a un événement.</summary>
    public async Task<int> RevaloriserToutAsync(Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        var ids = await db.Mouvements.Select(x => x.MvtEleId).Union(db.Comptages.Select(x => x.CptEleId)).Union(db.Reevaluations.Select(x => x.RevEleId)).ToListAsync(ct);
        foreach (var id in ids) await ValoriserAsync(id, ct);
        return ids.Count;
    }

    /// <summary>Réévaluation du PMP (S4) : datée (maintenant par défaut), commentaire, ancien PMP gardé.</summary>
    public async Task<FicheStockArticle> ReevaluerAsync(long ele, ReevaluationSaisie s, Utilisateur u, CancellationToken ct)
    {
        await ExigerGestion(u, ct);
        if (s.Pmp is not { } pmp || pmp < 0) throw ExceptionMetier.Invalide("STK_PMP", "PMP positif ou nul obligatoire");
        var date = Instant(s.Date);
        if (date > Instant(null)) throw ExceptionMetier.Invalide("STK_DATE_FUTURE", "Date à venir refusée");
        await ValoriserEnAttenteAsync(ct);
        var (m, c, r) = await EvenementsAsync(ele, ct);
        var avant = ReglesValorisation.Valoriser(m, c, r, M(date)).Pmp;
        db.Reevaluations.Add(new ReevaluationEntite
        {
            RevEleId = ele, RevDate = date, RevPmp = Math.Round(pmp, 6, MidpointRounding.AwayFromZero), RevAncienPmp = avant,
            RevCommentaire = string.IsNullOrWhiteSpace(s.Commentaire) ? null : s.Commentaire.Trim(), RevPar = u.Code,
        });
        await db.SaveChangesAsync(ct);
        await ValoriserEnAttenteAsync(ct);
        return await FicheArticleAsync(ele, ct);
    }

    // ------------------------------------------------------------------ lectures

    /// <summary>Mouvement (ouverture depuis la liste) : pièce d'origine et article.</summary>
    public async Task<object> MouvementAsync(long id, CancellationToken ct)
    {
        var m = await db.Mouvements.AsNoTracking().FirstOrDefaultAsync(x => x.MvtId == id, ct) ?? throw ExceptionMetier.Introuvable("Mouvement");
        return new { id = m.MvtId, ent_id = m.MvtEntId, ele_id = m.MvtEleId, lieu = m.MvtLieuId };
    }

    /// <summary>Fiche de stock d'un article : quantités par lieu à maintenant, valorisation, mouvements récents, réévaluations.</summary>
    public async Task<FicheStockArticle> FicheArticleAsync(long ele, CancellationToken ct)
    {
        await ValoriserEnAttenteAsync(ct);
        var article = (await specialisation.ArticlesAsync(db, [ele], ct)).GetValueOrDefault(ele) ?? throw ExceptionMetier.Introuvable("Article");
        var methode = await MethodeAsync(ct);
        var lieux = (await specialisation.LieuxAsync(db, ct)).ToDictionary(l => l.Id);
        var maintenant = M(Instant(null));
        var mvts = await db.Mouvements.AsNoTracking().Where(x => x.MvtEleId == ele).OrderBy(x => x.MvtId).ToListAsync(ct);
        var cpts = await db.Comptages.AsNoTracking().Where(x => x.CptEleId == ele).OrderBy(x => x.CptId).ToListAsync(ct);
        var parLieu = mvts.Select(x => x.MvtLieuId).Union(cpts.Select(x => x.CptLieuId)).Distinct().Select(lieu =>
        {
            var s = ReglesStock.StockA(mvts.Where(x => x.MvtLieuId == lieu).Select(x => new MouvementQuantite(M(x.MvtDate), x.MvtQuantite)).ToList(),
                cpts.Where(x => x.CptLieuId == lieu).Select(x => new ComptageQuantite(M(x.CptDate), x.CptQuantite)).ToList(), maintenant);
            var l = lieux.GetValueOrDefault(lieu);
            return new QuantiteLieu(lieu, l?.Code ?? lieu.ToString(), l?.Libelle ?? "", l?.Depot ?? false, s.Quantite, s.Comptage);
        }).OrderByDescending(x => x.Depot).ThenBy(x => x.Code).ToList();
        var v = await db.Valeurs.AsNoTracking().FirstOrDefaultAsync(x => x.SvaEleId == ele, ct);
        var recents = mvts.OrderByDescending(x => x.MvtDate).ThenByDescending(x => x.MvtId).Take(100).ToList();
        var dernierPa = v?.SvaDernierPaMvtId is { } did ? mvts.FirstOrDefault(x => x.MvtId == did) : null;
        var pieces = await specialisation.PiecesAsync(db, recents.Select(x => x.MvtEntId).Append(dernierPa?.MvtPrixEntId ?? dernierPa?.MvtEntId)
            .Where(x => x is not null).Select(x => x!.Value).Distinct().ToList(), ct);
        var valo = new Valorisation(v?.SvaPmp, v?.SvaDernierPa, v?.SvaDernierPaMvtId, null, v?.SvaProvisoire ?? false, 0, []);
        var u = ReglesValorisation.Valeur(valo, methode, article.PaRepli);
        var revs = await db.Reevaluations.AsNoTracking().Where(x => x.RevEleId == ele).OrderByDescending(x => x.RevDate).ToListAsync(ct);
        var emps = await db.ArticlesEmplacements.AsNoTracking().Where(x => x.SaeEleId == ele).OrderBy(x => x.SaeOrdre).Select(x => x.SaeEmpId).ToListAsync(ct);
        return new FicheStockArticle(ele, article.Unite, article.Precision, methode, v?.SvaPmp, v?.SvaDernierPa,
            v?.SvaDernierPaDate is { } dd ? M(dd) : null, v?.SvaProvisoire ?? false,
            dernierPa is null ? null : pieces.GetValueOrDefault(dernierPa.MvtPrixEntId ?? dernierPa.MvtEntId ?? 0),
            u.Valeur, u.Source, parLieu.Sum(x => x.Quantite), parLieu,
            recents.Select(x =>
            {
                var p = x.MvtEntId is { } e ? pieces.GetValueOrDefault(e) : null;
                return new MouvementDto(x.MvtId, M(x.MvtDate), x.MvtLieuId, lieux.GetValueOrDefault(x.MvtLieuId)?.Code, x.MvtQuantite, x.MvtPrix, x.MvtProvisoire,
                    x.MvtPmp, x.MvtOrigine, x.MvtEntId, p?.Numero, p?.Type, p?.Tiers);
            }).ToList(),
            revs.Select(x => new ReevaluationDto(x.RevId, M(x.RevDate), x.RevPmp, x.RevAncienPmp, x.RevCommentaire, x.RevPar)).ToList(), emps);
    }

    /// <summary>
    /// État du stock d'un lieu à une date-heure (maintenant par défaut) : quantité par article (ReglesStock), valeur
    /// unitaire à cette date selon la méthode de la société (rejeu ReglesValorisation jusqu'à la date), repli signalé.
    /// </summary>
    public async Task<EtatStock> EtatAsync(long lieu, DateTimeOffset? date, bool zeros, CancellationToken ct)
    {
        await ValoriserEnAttenteAsync(ct);
        var t = Instant(date);
        var fin = M(t);
        var methode = await MethodeAsync(ct);
        var mvts = await db.Mouvements.AsNoTracking().Where(x => x.MvtLieuId == lieu && x.MvtDate <= t)
            .Select(x => new { x.MvtEleId, x.MvtDate, x.MvtQuantite }).ToListAsync(ct);
        var cpts = await db.Comptages.AsNoTracking().Where(x => x.CptLieuId == lieu && x.CptDate <= t)
            .Select(x => new { x.CptEleId, x.CptDate, x.CptQuantite, x.CptId }).OrderBy(x => x.CptId).ToListAsync(ct);
        var ids = mvts.Select(x => x.MvtEleId).Union(cpts.Select(x => x.CptEleId)).Distinct().ToList();
        var articles = await specialisation.ArticlesAsync(db, ids, ct);
        var maintenant = date is null;
        var valeurs = maintenant ? await db.Valeurs.AsNoTracking().Where(x => ids.Contains(x.SvaEleId)).ToDictionaryAsync(x => x.SvaEleId, ct) : [];
        var emplacements = await (from a in db.ArticlesEmplacements join e in db.Emplacements on a.SaeEmpId equals e.EmpId
                                  where e.EmpLieuId == lieu && ids.Contains(a.SaeEleId) orderby a.SaeOrdre select new { a.SaeEleId, e.EmpCode }).ToListAsync(ct);
        var lignes = new List<LigneEtatStock>();
        foreach (var id in ids)
        {
            var s = ReglesStock.StockA(mvts.Where(x => x.MvtEleId == id).Select(x => new MouvementQuantite(M(x.MvtDate), x.MvtQuantite)).ToList(),
                cpts.Where(x => x.CptEleId == id).Select(x => new ComptageQuantite(M(x.CptDate), x.CptQuantite)).ToList(), fin);
            if (s.Quantite == 0 && !zeros) continue;
            var a = articles.GetValueOrDefault(id);
            Valorisation v;
            if (maintenant)
            {
                var x = valeurs.GetValueOrDefault(id);
                v = new(x?.SvaPmp, x?.SvaDernierPa, x?.SvaDernierPaMvtId, null, x?.SvaProvisoire ?? false, 0, []);
            }
            else
            {
                var (m, c, r) = await EvenementsAsync(id, ct);
                v = ReglesValorisation.Valoriser(m, c, r, fin);
            }
            var u = ReglesValorisation.Valeur(v, methode, a?.PaRepli);
            var dernier = mvts.Where(x => x.MvtEleId == id).Select(x => (DateTimeOffset?)x.MvtDate).Max();
            lignes.Add(new LigneEtatStock(id, a?.Code ?? id.ToString(), a?.Libelle ?? "", a?.Unite ?? "", a?.Precision ?? 2, s.Quantite, u.Valeur, u.Source,
                u.Provisoire, u.Valeur is { } pu ? Math.Round(pu * s.Quantite, 2, MidpointRounding.AwayFromZero) : null,
                dernier is { } d ? M(d) : null, emplacements.Where(e => e.SaeEleId == id).Select(e => e.EmpCode).ToList()));
        }
        lignes = lignes.OrderBy(l => l.Code, StringComparer.OrdinalIgnoreCase).ToList();
        return new EtatStock(lieu, fin, methode, lignes.Sum(l => l.Valeur ?? 0), lignes);
    }
}

public static class Extensions
{
    public static IServiceCollection AddModuleStock<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options)
        where TSpecialisation : SpecialisationStock
    {
        services.AddDbContext<StockDbContext>(options);
        services.AddSingleton<SpecialisationStock, TSpecialisation>();
        services.AddScoped<ServiceStock>();
        services.AddScoped<ServiceInventaire>();
        return services;
    }

    /// <summary>Routes HTTP du module, sous /stock ; renvoie le groupe (filtre d'activation posé par l'application).</summary>
    public static RouteGroupBuilder MapModuleStock(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/stock");
        g.MapGet("/parametres", (ServiceStock s, CancellationToken ct) => s.ParametresAsync(ct));
        g.MapPut("/parametres", (ParametresStockDto p, HttpContext http, ServiceStock s, CancellationToken ct) => s.EnregistrerParametresAsync(p, Utilisateur.Depuis(http), ct));
        g.MapGet("/lieux", (ServiceStock s, CancellationToken ct) => s.LieuxAsync(ct));
        g.MapGet("/lieux/{id:long}/emplacements", (long id, ServiceStock s, CancellationToken ct) => s.EmplacementsAsync(id, ct));
        g.MapPut("/lieux/{id:long}/emplacements", (long id, List<EmplacementDto> l, HttpContext http, ServiceStock s, CancellationToken ct) =>
            s.EnregistrerEmplacementsAsync(id, l, Utilisateur.Depuis(http), ct));
        g.MapGet("/lieux/{id:long}/etat", (long id, DateTimeOffset? date, bool? zeros, ServiceStock s, CancellationToken ct) => s.EtatAsync(id, date, zeros ?? false, ct));
        g.MapGet("/mouvements/{id:long}", (long id, ServiceStock s, CancellationToken ct) => s.MouvementAsync(id, ct));
        g.MapGet("/articles/{id:long}", (long id, ServiceStock s, CancellationToken ct) => s.FicheArticleAsync(id, ct));
        g.MapPost("/articles/{id:long}/pmp", (long id, ReevaluationSaisie r, HttpContext http, ServiceStock s, CancellationToken ct) =>
            s.ReevaluerAsync(id, r, Utilisateur.Depuis(http), ct));
        g.MapPut("/articles/{id:long}/emplacements", async (long id, List<long> l, HttpContext http, ServiceStock s, CancellationToken ct) =>
        {
            await s.DefinirEmplacementsArticleAsync(id, l, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapInventaires();
        g.MapPost("/revaloriser", async (HttpContext http, ServiceStock s, CancellationToken ct) => Results.Ok(new { articles = await s.RevaloriserToutAsync(Utilisateur.Depuis(http), ct) }));
        return g;
    }
}
