using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Reglements.Web;

/// <summary>Règlement reçu (E) ou émis (D) d'un tiers.</summary>
public class Reglement
{
    public long RegId { get; set; }
    public long RegTiersId { get; set; }
    public string RegSens { get; set; } = "E";
    public DateOnly RegDate { get; set; }
    public string RegMode { get; set; } = "VIREMENT";
    public decimal RegMontant { get; set; }
    public string? RegReference { get; set; }
    public string? RegCommentaire { get; set; }
    public DateTimeOffset RegCreeLe { get; set; }
    public string RegCreePar { get; set; } = "";
}

/// <summary>Caution d'un tiers (retenue de garantie cautionnée…), rattachée à un objet de l'application.</summary>
public class Caution
{
    public long CauId { get; set; }
    public long CauTiersId { get; set; }
    public string? CauObjet { get; set; }
    public long? CauObjetId { get; set; }
    public string CauOrganisme { get; set; } = "";
    public decimal CauMontant { get; set; }
    public DateOnly CauDate { get; set; }
    public DateOnly? CauDateFin { get; set; }
    public string? CauReference { get; set; }
    public DateOnly? CauMainlevee { get; set; }
}

/// <summary>Pointage d'une échéance par un règlement ou une caution.</summary>
public class Pointage
{
    public long PoiId { get; set; }
    public long? PoiRegId { get; set; }
    public long? PoiCauId { get; set; }
    public long PoiEcheanceId { get; set; }
    public decimal PoiMontant { get; set; }
}

/// <summary>Contexte EF Core du module (modules/reglement/db) ; snake_case par la convention de l'application.</summary>
public class ReglementDbContext(DbContextOptions<ReglementDbContext> options) : DbContext(options)
{
    public DbSet<Reglement> Reglements => Set<Reglement>();
    public DbSet<Caution> Cautions => Set<Caution>();
    public DbSet<Pointage> Pointages => Set<Pointage>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Reglement>().ToTable("reglement").HasKey(x => x.RegId);
        b.Entity<Caution>().ToTable("caution").HasKey(x => x.CauId);
        b.Entity<Pointage>().ToTable("pointage").HasKey(x => x.PoiId);
    }
}
