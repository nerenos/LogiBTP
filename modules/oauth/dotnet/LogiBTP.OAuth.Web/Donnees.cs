using Microsoft.EntityFrameworkCore;

namespace LogiBTP.OAuth.Web;

public class FournisseurEntite
{
    public string OfoCode { get; set; } = "";
    public string OfoLibelle { get; set; } = "";
    public string OfoUrlAutorisation { get; set; } = "";
    public string OfoUrlJeton { get; set; } = "";
    public string? OfoUrlRevocation { get; set; }
    public string OfoPortees { get; set; } = "";
    public string OfoParametres { get; set; } = "{}";
    public int? OfoRafraichissementTestJours { get; set; }
    public bool OfoActif { get; set; } = true;
}

public class ConnexionEntite
{
    public long OcoId { get; set; }
    public string OcoCode { get; set; } = "";
    public string OcoNom { get; set; } = "";
    public string OcoOfoCode { get; set; } = "";
    public string OcoFlux { get; set; } = "CODE_PKCE";
    public string OcoPortees { get; set; } = "";
    public bool OcoModeTest { get; set; } = true;
    public string? OcoClient { get; set; }
    public string? OcoJetons { get; set; }
    public string? OcoCompte { get; set; }
    public string? OcoCompteEmpreinte { get; set; }
    public DateTimeOffset? OcoAccesExpireLe { get; set; }
    public DateTimeOffset? OcoRafraichissementExpireLe { get; set; }
    public DateTimeOffset? OcoSecretExpireLe { get; set; }
    public string OcoEtat { get; set; } = "A_CONNECTER";
    public string? OcoDerniereErreur { get; set; }
    public DateTimeOffset? OcoRenouveleLe { get; set; }
    public DateTimeOffset? OcoConnecteLe { get; set; }
    public string? OcoConnectePar { get; set; }
    public List<string> OcoDroits { get; set; } = [];
    public List<int>? OcoRappelsJours { get; set; }
    public string? OcoUtilisateur { get; set; }
    public string OcoCreePar { get; set; } = "";
    public DateTimeOffset OcoCreeLe { get; set; }
    public string? OcoMajPar { get; set; }
    public DateTimeOffset? OcoMajLe { get; set; }
}

public class ParametreEntite
{
    public string OpaCle { get; set; } = "";
    public string OpaValeur { get; set; } = "null";
}

public class RappelEntite
{
    public long OraOcoId { get; set; }
    public string OraEcheance { get; set; } = "";
    public DateTimeOffset OraDate { get; set; }
    public int OraDelai { get; set; }
    public DateTimeOffset OraEmisLe { get; set; }
}

public class JournalEntite
{
    public long OjoId { get; set; }
    public long? OjoOcoId { get; set; }
    public string OjoEvenement { get; set; } = "";
    public string? OjoDetail { get; set; }
    public string? OjoUtilisateur { get; set; }
    public DateTimeOffset OjoLe { get; set; }
}

public class AutorisationEntite
{
    public string OauState { get; set; } = "";
    public long OauOcoId { get; set; }
    public string OauVerificateur { get; set; } = "";
    public string OauUtilisateur { get; set; } = "";
    public string OauOrigine { get; set; } = "";
    public bool OauAutreCompte { get; set; }
    public DateTimeOffset OauExpireLe { get; set; }
}

public class OAuthDbContext(DbContextOptions<OAuthDbContext> options) : DbContext(options)
{
    public DbSet<FournisseurEntite> Fournisseurs => Set<FournisseurEntite>();
    public DbSet<ConnexionEntite> Connexions => Set<ConnexionEntite>();
    public DbSet<ParametreEntite> Parametres => Set<ParametreEntite>();
    public DbSet<RappelEntite> Rappels => Set<RappelEntite>();
    public DbSet<JournalEntite> Journal => Set<JournalEntite>();
    public DbSet<AutorisationEntite> Autorisations => Set<AutorisationEntite>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<FournisseurEntite>().ToTable("oauth_fournisseur").HasKey(x => x.OfoCode);
        b.Entity<FournisseurEntite>().Property(x => x.OfoParametres).HasColumnType("jsonb");
        b.Entity<ConnexionEntite>().ToTable("oauth_connexion").HasKey(x => x.OcoId);
        b.Entity<ConnexionEntite>().Property(x => x.OcoCreeLe).ValueGeneratedOnAdd();
        b.Entity<ParametreEntite>().ToTable("oauth_parametre").HasKey(x => x.OpaCle);
        b.Entity<ParametreEntite>().Property(x => x.OpaValeur).HasColumnType("jsonb");
        b.Entity<RappelEntite>().ToTable("oauth_rappel").HasKey(x => new { x.OraOcoId, x.OraEcheance, x.OraDate, x.OraDelai });
        b.Entity<JournalEntite>().ToTable("oauth_journal").HasKey(x => x.OjoId);
        b.Entity<JournalEntite>().Property(x => x.OjoLe).ValueGeneratedOnAdd();
        b.Entity<AutorisationEntite>().ToTable("oauth_autorisation").HasKey(x => x.OauState);
    }
}
