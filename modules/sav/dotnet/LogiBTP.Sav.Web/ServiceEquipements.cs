using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Sav.Web;

/// <summary>Équipement installé chez un client (table <c>equipement_installe</c>, module SAV).</summary>
public class EquipementEntite
{
    public long EqiId { get; set; }
    public string EqiNumero { get; set; } = "";
    public long EqiEleId { get; set; }
    public long? EqiLotId { get; set; }
    public string? EqiLibelle { get; set; }
    public long? EqiLieuId { get; set; }
    public long? EqiTiersId { get; set; }
    public DateOnly? EqiPose { get; set; }
    public int? EqiGarantieMois { get; set; }
    public DateOnly? EqiFinGarantie { get; set; }
    public string EqiEtat { get; set; } = EtatEquipement.Installe;
    public DateOnly? EqiRetireLe { get; set; }
    public string EqiOrigine { get; set; } = OrigineEquipement.Manuel;
    public long? EqiEntId { get; set; }
    public long? EqiLigId { get; set; }
    public long? EqiMvtId { get; set; }
    public long? EqiRetireEntId { get; set; }
    public long? EqiRemplaceId { get; set; }
    public string? EqiCommentaire { get; set; }
    public string EqiCreePar { get; set; } = "";
    public DateTimeOffset EqiCreeLe { get; set; } = DateTimeOffset.UtcNow;
    public string? EqiMajPar { get; set; }
    public DateTimeOffset? EqiMajLe { get; set; }
}

public class SavDbContext(DbContextOptions<SavDbContext> options) : DbContext(options)
{
    public DbSet<EquipementEntite> Equipements => Set<EquipementEntite>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<EquipementEntite>().ToTable("equipement_installe").HasKey(x => x.EqiId);
    }
}

/// <summary>Saisie d'un équipement (création manuelle, modification, remplaçant) ; identifiants de l'application.</summary>
public sealed record EquipementSaisi(string? Numero, long? Article, long? Lot, string? Libelle, long? Lieu, long? Tiers,
    DateOnly? Pose, decimal? GarantieMois, DateOnly? FinGarantie, string? Commentaire);

/// <summary>Pièce de stock à l'origine d'un équipement (créé par l'application à la validation d'un mouvement).</summary>
public sealed record OrigineMouvement(long Piece, long? Ligne, long? Mouvement);

/// <summary>Libellés fournis par l'application pour l'affichage d'un équipement.</summary>
public sealed record DescriptionEquipement(string? ArticleCode, string? ArticleLibelle, string? LieuCode, string? LieuLibelle, string? TiersNom, string? Piece);

public sealed record EquipementDto(long Id, string Numero, long Article, long? Lot, string? Libelle, long? Lieu, long? Tiers, DateOnly? Pose,
    int? GarantieMois, DateOnly? FinGarantieSaisie, GarantieEquipement Garantie, string Etat, DateOnly? RetireLe, string Origine,
    long? Piece, long? Ligne, long? Remplace, long? Remplacant, string? Commentaire, string Cree, DateTimeOffset CreeLe,
    DescriptionEquipement? Description);

public sealed record FiltreEquipements(string? Numero, long? Article, long? Lieu, long? Tiers, string? Etat, int? Limite);
public sealed record RetraitEquipement(DateOnly? Le, string? Commentaire);

/// <summary>Points d'accroche de l'application : contrôles propres (article suivi par numéro de série…) et libellés.</summary>
public abstract class SpecialisationSav
{
    /// <summary>Contrôles de l'application sur une saisie (codes d'erreur), après ceux du module.</summary>
    public virtual Task<List<string>> ControlerAsync(SavDbContext db, EquipementSaisi s, CancellationToken ct) => Task.FromResult(new List<string>());

    /// <summary>Libellés d'article, de lieu, de tiers et de pièce des équipements, par identifiant d'équipement.</summary>
    public virtual Task<IReadOnlyDictionary<long, DescriptionEquipement>> DecrireAsync(SavDbContext db, IReadOnlyCollection<EquipementEntite> equipements, CancellationToken ct) =>
        Task.FromResult<IReadOnlyDictionary<long, DescriptionEquipement>>(new Dictionary<long, DescriptionEquipement>());

    /// <summary>Messages des erreurs propres à l'application (codes renvoyés par <see cref="ControlerAsync"/>).</summary>
    public virtual IReadOnlyDictionary<string, string> Messages => new Dictionary<string, string>();
}

/// <summary>
/// Équipements installés (plans/stock.md, lot 2) : liste filtrée, fiche avec l'état de la garantie (ReglesGarantie),
/// création (manuelle ou par un mouvement de l'application), modification, retrait, remplacement. Un numéro de série
/// n'est installé qu'une fois par article (409 SAV_NUMERO_PRIS) ; seul un équipement installé se retire ou se remplace
/// (409 SAV_ETAT).
/// </summary>
public class ServiceEquipements(SavDbContext db, SpecialisationSav specialisation)
{
    private const int LimiteDefaut = 200;
    private static DateOnly Aujourdhui => DateOnly.FromDateTime(DateTime.Now);

    public async Task<List<EquipementDto>> ListeAsync(FiltreEquipements f, CancellationToken ct)
    {
        var q = db.Equipements.AsNoTracking();
        if (ReglesGarantie.Numero(f.Numero) is string n)
        {
            var motif = $"%{n.ToUpperInvariant().Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_")}%";
            q = q.Where(e => EF.Functions.Like(e.EqiNumero.ToUpper(), motif));
        }
        if (f.Article is long a) q = q.Where(e => e.EqiEleId == a);
        if (f.Lieu is long l) q = q.Where(e => e.EqiLieuId == l);
        if (f.Tiers is long t) q = q.Where(e => e.EqiTiersId == t);
        if (!string.IsNullOrWhiteSpace(f.Etat)) q = q.Where(e => e.EqiEtat == f.Etat);
        var liste = await q.OrderByDescending(e => e.EqiPose).ThenByDescending(e => e.EqiId)
            .Take(Math.Clamp(f.Limite ?? LimiteDefaut, 1, 1000)).ToListAsync(ct);
        return await VersDtoAsync(liste, ct);
    }

    public async Task<EquipementDto> ChargerAsync(long id, CancellationToken ct)
    {
        var e = await db.Equipements.AsNoTracking().FirstOrDefaultAsync(x => x.EqiId == id, ct) ?? throw ExceptionMetier.Introuvable($"Équipement {id}");
        return (await VersDtoAsync([e], ct))[0];
    }

    /// <summary>Création manuelle (route du module) ou par un mouvement de stock (appel de l'application, <paramref name="origine"/>).</summary>
    public async Task<EquipementDto> CreerAsync(EquipementSaisi s, Utilisateur u, CancellationToken ct, OrigineMouvement? origine = null, long? remplace = null)
    {
        await ControlerAsync(s, null, ct);
        var e = new EquipementEntite
        {
            EqiOrigine = origine is null ? OrigineEquipement.Manuel : OrigineEquipement.Mouvement,
            EqiEntId = origine?.Piece, EqiLigId = origine?.Ligne, EqiMvtId = origine?.Mouvement,
            EqiRemplaceId = remplace, EqiCreePar = u.Code,
        };
        Appliquer(e, s, numeroEtArticle: true);
        db.Equipements.Add(e);
        await db.SaveChangesAsync(ct);
        return await ChargerAsync(e.EqiId, ct);
    }

    /// <summary>Modification : numéro et article seulement sur un équipement saisi à la main.</summary>
    public async Task<EquipementDto> ModifierAsync(long id, EquipementSaisi s, Utilisateur u, CancellationToken ct)
    {
        var e = await db.Equipements.FirstOrDefaultAsync(x => x.EqiId == id, ct) ?? throw ExceptionMetier.Introuvable($"Équipement {id}");
        var manuel = e.EqiOrigine == OrigineEquipement.Manuel;
        var saisie = manuel ? s : s with { Numero = e.EqiNumero, Article = e.EqiEleId, Lot = e.EqiLotId };
        await ControlerAsync(saisie, e.EqiEtat == EtatEquipement.Installe ? id : null, ct, e.EqiEtat == EtatEquipement.Installe);
        Appliquer(e, saisie, numeroEtArticle: manuel);
        e.EqiMajPar = u.Code;
        e.EqiMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return await ChargerAsync(id, ct);
    }

    /// <summary>Retrait (retour, dépose) d'un équipement installé, à la date donnée (défaut : aujourd'hui).</summary>
    public async Task<EquipementDto> RetirerAsync(long id, RetraitEquipement r, Utilisateur u, CancellationToken ct)
    {
        var e = await InstalleAsync(id, ct);
        Retirer(e, EtatEquipement.Retire, r.Le ?? Aujourdhui, r.Commentaire, u);
        await db.SaveChangesAsync(ct);
        return await ChargerAsync(id, ct);
    }

    /// <summary>
    /// Remplacement : l'équipement installé passe à REMPLACE à la pose du remplaçant (défaut : aujourd'hui) ; le remplaçant
    /// reprend le lieu et le tiers de l'ancien quand ils ne sont pas saisis, et le désigne par <c>eqi_remplace_id</c>.
    /// </summary>
    public async Task<EquipementDto> RemplacerAsync(long id, EquipementSaisi nouveau, Utilisateur u, CancellationToken ct)
    {
        var ancien = await InstalleAsync(id, ct);
        var s = nouveau with { Lieu = nouveau.Lieu ?? ancien.EqiLieuId, Tiers = nouveau.Tiers ?? ancien.EqiTiersId, Pose = nouveau.Pose ?? Aujourdhui };
        await using var tx = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;
        Retirer(ancien, EtatEquipement.Remplace, s.Pose!.Value, null, u);
        await db.SaveChangesAsync(ct);
        var r = await CreerAsync(s, u, ct, remplace: id);
        if (tx is not null) await tx.CommitAsync(ct);
        return r;
    }

    private async Task<EquipementEntite> InstalleAsync(long id, CancellationToken ct)
    {
        var e = await db.Equipements.FirstOrDefaultAsync(x => x.EqiId == id, ct) ?? throw ExceptionMetier.Introuvable($"Équipement {id}");
        if (e.EqiEtat != EtatEquipement.Installe) throw ExceptionMetier.Conflit("SAV_ETAT", "Seul un équipement installé se retire ou se remplace");
        return e;
    }

    private static void Retirer(EquipementEntite e, string etat, DateOnly le, string? commentaire, Utilisateur u)
    {
        e.EqiEtat = etat;
        e.EqiRetireLe = e.EqiPose is DateOnly p && le < p ? p : le;
        if (!string.IsNullOrWhiteSpace(commentaire))
            e.EqiCommentaire = string.IsNullOrWhiteSpace(e.EqiCommentaire) ? commentaire.Trim() : $"{e.EqiCommentaire}\n{commentaire.Trim()}";
        e.EqiMajPar = u.Code;
        e.EqiMajLe = DateTimeOffset.UtcNow;
    }

    private static void Appliquer(EquipementEntite e, EquipementSaisi s, bool numeroEtArticle)
    {
        if (numeroEtArticle)
        {
            e.EqiNumero = ReglesGarantie.Numero(s.Numero)!;
            e.EqiEleId = s.Article!.Value;
            e.EqiLotId = s.Lot;
        }
        e.EqiLibelle = string.IsNullOrWhiteSpace(s.Libelle) ? null : s.Libelle.Trim();
        e.EqiLieuId = s.Lieu;
        e.EqiTiersId = s.Tiers;
        e.EqiPose = s.Pose;
        e.EqiGarantieMois = s.GarantieMois is decimal g ? (int)g : null;
        e.EqiFinGarantie = s.FinGarantie;
        e.EqiCommentaire = string.IsNullOrWhiteSpace(s.Commentaire) ? null : s.Commentaire.Trim();
    }

    /// <summary>Contrôles du module puis de l'application (422) ; numéro déjà installé pour l'article (409).</summary>
    private async Task ControlerAsync(EquipementSaisi s, long? soi, CancellationToken ct, bool installe = true)
    {
        var erreurs = ReglesGarantie.Controler(s.Numero, s.Article, s.Pose, s.GarantieMois, s.FinGarantie, Aujourdhui);
        if (erreurs.Count == 0) erreurs.AddRange(await specialisation.ControlerAsync(db, s, ct));
        if (erreurs.Count > 0)
            throw ExceptionMetier.Invalide(erreurs[0], string.Join(" · ", erreurs.Select(Message)), erreurs);
        if (!installe) return;
        var numero = ReglesGarantie.Numero(s.Numero)!.ToUpperInvariant();
        if (await db.Equipements.AnyAsync(e => e.EqiEleId == s.Article && e.EqiEtat == EtatEquipement.Installe
                && e.EqiNumero.ToUpper() == numero && e.EqiId != (soi ?? 0), ct))
            throw ExceptionMetier.Conflit("SAV_NUMERO_PRIS", $"Numéro de série {ReglesGarantie.Numero(s.Numero)} déjà installé pour cet article");
    }

    private string Message(string code) =>
        ReglesGarantie.Messages.GetValueOrDefault(code) ?? specialisation.Messages.GetValueOrDefault(code) ?? code;

    private async Task<List<EquipementDto>> VersDtoAsync(List<EquipementEntite> liste, CancellationToken ct)
    {
        if (liste.Count == 0) return [];
        var ids = liste.Select(e => e.EqiId).ToList();
        var remplacants = await db.Equipements.AsNoTracking().Where(e => e.EqiRemplaceId != null && ids.Contains(e.EqiRemplaceId.Value))
            .Select(e => new { Ancien = e.EqiRemplaceId!.Value, e.EqiId }).ToListAsync(ct);
        var parAncien = remplacants.GroupBy(r => r.Ancien).ToDictionary(g => g.Key, g => g.Max(r => r.EqiId));
        var descriptions = await specialisation.DecrireAsync(db, liste, ct);
        var jour = Aujourdhui;
        return liste.Select(e => new EquipementDto(e.EqiId, e.EqiNumero, e.EqiEleId, e.EqiLotId, e.EqiLibelle, e.EqiLieuId, e.EqiTiersId, e.EqiPose,
            e.EqiGarantieMois, e.EqiFinGarantie, ReglesGarantie.Etat(e.EqiPose, e.EqiGarantieMois, e.EqiFinGarantie, jour), e.EqiEtat, e.EqiRetireLe,
            e.EqiOrigine, e.EqiEntId, e.EqiLigId, e.EqiRemplaceId, parAncien.TryGetValue(e.EqiId, out var r) ? r : null, e.EqiCommentaire,
            e.EqiCreePar, e.EqiCreeLe, descriptions.GetValueOrDefault(e.EqiId))).ToList();
    }
}
