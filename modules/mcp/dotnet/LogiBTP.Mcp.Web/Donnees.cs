using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Mcp.Web;

/// <summary>
/// Délégation d'un compte à un agent (mcp_delegation) : modèle de plafond, nœuds sur mesure (JSON { nœud: [actions] }),
/// portée maximale, garde-fous levés (JSON [codes]), client, échéance (jour exclu), révocation.
/// </summary>
public class DelegationMcp
{
    public long MdeId { get; set; }
    public string MdeCode { get; set; } = "";
    public string MdeCompte { get; set; } = "";
    public string MdeLibelle { get; set; } = "";
    public string MdeModele { get; set; } = "";
    public string? MdeNoeuds { get; set; }
    public string? MdePortee { get; set; }
    public string MdeLeves { get; set; } = "[]";
    public string MdeClient { get; set; } = "";
    public DateOnly MdeEcheance { get; set; }
    public DateTimeOffset MdeCreeLe { get; set; }
    public DateTimeOffset? MdePremierUsage { get; set; }
    public DateTimeOffset? MdeRevoqueeLe { get; set; }
    public string? MdeRevoqueePar { get; set; }

    /// <summary>Active à la date : ni révoquée, ni échue (l'échéance est le premier jour sans délégation).</summary>
    public bool Active(DateOnly jour) => MdeRevoqueeLe is null && jour < MdeEcheance;
}

/// <summary>Levées par profil (mcp_levee_profil) : garde-fous levables, modèles permis (null : tous), échéance maximale, quotas.</summary>
public class LeveeProfilMcp
{
    public string MlpProfil { get; set; } = "";
    public string MlpLevables { get; set; } = "[]";
    public string? MlpModeles { get; set; }
    public int? MlpJoursMax { get; set; }
    public int? MlpQuotaAppel { get; set; }
    public int? MlpQuotaJour { get; set; }
    public int? MlpAlerte { get; set; }
    public DateTimeOffset MlpModifieLe { get; set; }
    public string MlpModifiePar { get; set; } = "";
}

/// <summary>Appel d'outil au journal des agents (agent_journal, § 9 de l'analyse) ; champs JSON en texte.</summary>
public class JournalAgent
{
    public long AjoId { get; set; }
    public DateTimeOffset AjoDate { get; set; }
    public string AjoDelegation { get; set; } = "";
    public string AjoCompte { get; set; } = "";
    public string AjoClient { get; set; } = "";
    public string? AjoSession { get; set; }
    public string AjoOutil { get; set; } = "";
    public string AjoClasse { get; set; } = "";
    public string? AjoParametres { get; set; }
    public string? AjoRoutes { get; set; }
    public string? AjoLus { get; set; }
    public int AjoNbLus { get; set; }
    public string? AjoEcrits { get; set; }
    public string? AjoGardesFous { get; set; }
    public string AjoStatut { get; set; } = StatutAppelAgent.Succes;
    public int AjoDureeMs { get; set; }
    public string? AjoErreur { get; set; }
}

/// <summary>Compteur du garde-fou VOLUME (mcp_compteur) : appels et éléments lus par délégation et par jour.</summary>
public class CompteurMcp
{
    public string McoDelegation { get; set; } = "";
    public DateOnly McoJour { get; set; }
    public int McoAppels { get; set; }
    public int McoElements { get; set; }
}

/// <summary>Contexte EF Core du module (modules/mcp/db) ; snake_case par la convention de l'application.</summary>
public class McpDbContext(DbContextOptions<McpDbContext> options) : DbContext(options)
{
    public DbSet<DelegationMcp> Delegations => Set<DelegationMcp>();
    public DbSet<LeveeProfilMcp> Levees => Set<LeveeProfilMcp>();
    public DbSet<JournalAgent> Journal => Set<JournalAgent>();
    public DbSet<CompteurMcp> Compteurs => Set<CompteurMcp>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<DelegationMcp>(e =>
        {
            e.ToTable("mcp_delegation").HasKey(x => x.MdeId);
            e.Property(x => x.MdeNoeuds).HasColumnType("jsonb");
            e.Property(x => x.MdeLeves).HasColumnType("jsonb");
            e.Property(x => x.MdeCreeLe).HasDefaultValueSql("now()");
        });
        b.Entity<LeveeProfilMcp>(e =>
        {
            e.ToTable("mcp_levee_profil").HasKey(x => x.MlpProfil);
            e.Property(x => x.MlpLevables).HasColumnType("jsonb");
            e.Property(x => x.MlpModeles).HasColumnType("jsonb");
        });
        b.Entity<JournalAgent>(e =>
        {
            e.ToTable("agent_journal").HasKey(x => x.AjoId);
            foreach (var p in new[] { nameof(JournalAgent.AjoParametres), nameof(JournalAgent.AjoRoutes), nameof(JournalAgent.AjoLus),
                nameof(JournalAgent.AjoEcrits), nameof(JournalAgent.AjoGardesFous) })
                e.Property(p).HasColumnType("jsonb");
        });
        b.Entity<CompteurMcp>(e => e.ToTable("mcp_compteur").HasKey(x => new { x.McoDelegation, x.McoJour }));
    }
}
