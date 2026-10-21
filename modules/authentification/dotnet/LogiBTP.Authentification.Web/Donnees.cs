using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Authentification.Web;

/// <summary>Compte : pseudo unique sans casse, PERSONNE (lié à un élément de l'application) ou SERVICE (sans connexion).</summary>
public class Compte
{
    public long CptId { get; set; }
    public string CptCode { get; set; } = "";
    public string CptType { get; set; } = "PERSONNE";
    public string? CptLibelle { get; set; }
    public string? CptTypeElement { get; set; }
    public string? CptIdElement { get; set; }
    public string? CptHash { get; set; }
    public bool CptMdpProvisoire { get; set; }
    public string CptProfil { get; set; } = "SAISIE";
    public bool CptActif { get; set; } = true;
    public DateOnly? CptValideJusquAu { get; set; }
    public int CptEchecs { get; set; }
    public DateTimeOffset? CptVerrouilleJusquAu { get; set; }
    public DateTimeOffset? CptDerniereConnexion { get; set; }
    public string CptCreePar { get; set; } = "";
    public DateTimeOffset CptCreeLe { get; set; } = DateTimeOffset.UtcNow;
    public string? CptMajPar { get; set; }
    public DateTimeOffset CptMajLe { get; set; } = DateTimeOffset.UtcNow;

    public CompteAEvaluer AEvaluer() => new(CptType, CptActif, CptHash is not null, CptMdpProvisoire, CptValideJusquAu, CptVerrouilleJusquAu);
}

/// <summary>Session ouverte : seule l'empreinte du jeton du cookie est conservée.</summary>
public class SessionUtilisateur
{
    public long SesId { get; set; }
    public string SesJetonHache { get; set; } = "";
    public long SesCptId { get; set; }
    public DateTimeOffset SesCreeLe { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset SesVuLe { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset SesExpireLe { get; set; }
    public bool SesPersistante { get; set; }
    public string? SesAdresse { get; set; }
    public string? SesNavigateur { get; set; }
    public DateTimeOffset? SesFermeeLe { get; set; }
    public bool SesTest { get; set; }
}

/// <summary>Journal des connexions : qui, quand, d'où, quoi (CONNEXION, ECHEC, VERROUILLAGE, DECONNEXION…).</summary>
public class JournalConnexion
{
    public long JcoId { get; set; }
    public string JcoCode { get; set; } = "";
    public string JcoEvenement { get; set; } = "";
    public string? JcoDetail { get; set; }
    public DateTimeOffset JcoLe { get; set; } = DateTimeOffset.UtcNow;
    public string? JcoAdresse { get; set; }
    public string? JcoNavigateur { get; set; }
    public string? JcoPar { get; set; }
}

public class ParametreAuthentification
{
    public string PauCle { get; set; } = "";
    public JsonDocument PauValeur { get; set; } = JsonDocument.Parse("{}");
    public string? PauMajPar { get; set; }
    public DateTimeOffset PauMajLe { get; set; } = DateTimeOffset.UtcNow;
}

public class AuthDbContext(DbContextOptions<AuthDbContext> options) : DbContext(options)
{
    public DbSet<Compte> Comptes => Set<Compte>();
    public DbSet<SessionUtilisateur> Sessions => Set<SessionUtilisateur>();
    public DbSet<JournalConnexion> Journal => Set<JournalConnexion>();
    public DbSet<ParametreAuthentification> Parametres => Set<ParametreAuthentification>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Compte>().ToTable("compte").HasKey(x => x.CptId);
        b.Entity<SessionUtilisateur>().ToTable("session_utilisateur").HasKey(x => x.SesId);
        b.Entity<JournalConnexion>().ToTable("journal_connexion").HasKey(x => x.JcoId);
        b.Entity<ParametreAuthentification>().ToTable("parametre_authentification").HasKey(x => x.PauCle);
    }
}
