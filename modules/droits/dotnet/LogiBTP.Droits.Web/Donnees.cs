using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Droits.Web;

/// <summary>Profil : code (unique, majuscules), libellé ; système (non supprimable), total (tous les droits : ADMIN).</summary>
public class Profil
{
    public Guid ProId { get; set; } = Guid.CreateVersion7();
    public string ProCode { get; set; } = "";
    public string ProLibelle { get; set; } = "";
    public string? ProDescription { get; set; }
    public bool ProSysteme { get; set; }
    public bool ProTotal { get; set; }
    public string ProCreePar { get; set; } = "";
    public DateTimeOffset ProCreeLe { get; set; } = DateTimeOffset.UtcNow;
    public string? ProMajPar { get; set; }
    public DateTimeOffset ProMajLe { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Ligne de droits d'un profil sur un nœud (« propre ») : { ACTION : PORTÉE } ; absente : le nœud hérite.</summary>
public class DroitProfil
{
    public Guid DprProId { get; set; }
    public string DprNoeud { get; set; } = "";
    public JsonDocument DprActions { get; set; } = JsonDocument.Parse("{}");
}

/// <summary>Journal des modifications des profils et de leurs droits (audit).</summary>
public class JournalDroits
{
    public long JdrId { get; set; }
    public DateTimeOffset JdrLe { get; set; } = DateTimeOffset.UtcNow;
    public string JdrPar { get; set; } = "";
    public string JdrProfil { get; set; } = "";
    public string JdrEvenement { get; set; } = "";
    public string? JdrNoeud { get; set; }
    public JsonDocument? JdrAvant { get; set; }
    public JsonDocument? JdrApres { get; set; }
}

public class DroitsDbContext(DbContextOptions<DroitsDbContext> options) : DbContext(options)
{
    public DbSet<Profil> Profils => Set<Profil>();
    public DbSet<DroitProfil> Droits => Set<DroitProfil>();
    public DbSet<JournalDroits> Journal => Set<JournalDroits>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Profil>().ToTable("profil").HasKey(x => x.ProId);
        b.Entity<DroitProfil>().ToTable("droit_profil").HasKey(x => new { x.DprProId, x.DprNoeud });
        b.Entity<JournalDroits>().ToTable("journal_droits").HasKey(x => x.JdrId);
    }
}
