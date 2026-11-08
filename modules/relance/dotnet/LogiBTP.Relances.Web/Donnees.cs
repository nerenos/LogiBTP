using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Relances.Web;

/// <summary>Règle d'une nature (relance_regle) : niveaux en JSON (snake_case), répétition du dernier niveau.</summary>
public class RegleEntite
{
    public string RrgNature { get; set; } = "";
    public string RrgNiveaux { get; set; } = "[]";
    public bool RrgRepeter { get; set; }
    public int? RrgIntervalle { get; set; }
    public DateTimeOffset RrgModifieLe { get; set; }
    public string RrgModifiePar { get; set; } = "";
}

/// <summary>Lot de relances préparées puis validées (EtatLotRelance).</summary>
public class LotRelance
{
    public long RloId { get; set; }
    public DateOnly RloDate { get; set; }
    public DateTimeOffset RloCreeLe { get; set; }
    public string RloAuteur { get; set; } = "";
    public int RloNombre { get; set; }
    public string RloEtat { get; set; } = EtatLotRelance.Prepare;
}

/// <summary>
/// Relance du journal : une pièce (identifiant et groupe d'indices de l'application), son niveau propre, le mode et
/// l'état de l'envoi ; les pièces d'un même envoi partagent RelGroupe dans leur lot.
/// </summary>
public class Relance
{
    public long RelId { get; set; }
    public long? RelRloId { get; set; }
    public LotRelance? Lot { get; set; }
    public int RelGroupe { get; set; }
    public long RelEntId { get; set; }
    public long? RelEntGroupeId { get; set; }
    public string RelNature { get; set; } = "";
    public long RelTiersId { get; set; }
    public long? RelChargeId { get; set; }
    public int RelNiveau { get; set; }
    public int RelRepetition { get; set; }
    public string RelMode { get; set; } = "";
    public string RelEtat { get; set; } = EtatRelance.Proposee;
    public DateOnly RelDate { get; set; }
    public string RelAuteur { get; set; } = "";
    public decimal RelMontant { get; set; }
    public int RelJours { get; set; }
    public long? RelCourrielId { get; set; }
    public long? RelGedId { get; set; }
    public string? RelRecommande { get; set; }
    public string? RelCommentaire { get; set; }
    public DateTimeOffset RelCreeLe { get; set; }
}

/// <summary>Suspension d'une pièce ou d'un tiers jusqu'à une date (comprise), avec son motif (MotifSuspension).</summary>
public class SuspensionRelance
{
    public long RsuId { get; set; }
    public long? RsuEntId { get; set; }
    public long? RsuTiersId { get; set; }
    public DateOnly RsuJusquAu { get; set; }
    public string RsuMotif { get; set; } = MotifSuspension.Autre;
    public string? RsuCommentaire { get; set; }
    public DateTimeOffset RsuCreeLe { get; set; }
    public string RsuCreePar { get; set; } = "";
}

/// <summary>Contexte EF Core du module (modules/relance/db) ; snake_case par la convention de l'application.</summary>
public class RelanceDbContext(DbContextOptions<RelanceDbContext> options) : DbContext(options)
{
    public DbSet<RegleEntite> Regles => Set<RegleEntite>();
    public DbSet<LotRelance> Lots => Set<LotRelance>();
    public DbSet<Relance> Relances => Set<Relance>();
    public DbSet<SuspensionRelance> Suspensions => Set<SuspensionRelance>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<RegleEntite>(e => { e.ToTable("relance_regle").HasKey(x => x.RrgNature); e.Property(x => x.RrgNiveaux).HasColumnType("jsonb"); });
        b.Entity<LotRelance>().ToTable("relance_lot").HasKey(x => x.RloId);
        b.Entity<Relance>(e =>
        {
            e.ToTable("relance").HasKey(x => x.RelId);
            e.HasOne(x => x.Lot).WithMany().HasForeignKey(x => x.RelRloId);
        });
        b.Entity<SuspensionRelance>().ToTable("relance_suspension").HasKey(x => x.RsuId);
    }
}
