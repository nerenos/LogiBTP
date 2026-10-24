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
    /// <summary>Identifiant non consécutif (D17) : désigne le compte hors de la base (jetons, écrans).</summary>
    public Guid CptUuid { get; set; } = Guid.CreateVersion7();
    /// <summary>Identifiant d'API (D15) : adresses permises (CIDR), vide = toutes.</summary>
    public string[]? CptAdresses { get; set; }
    /// <summary>Double facteur demandé par l'utilisateur lui-même.</summary>
    public bool CptDoubleFacteur { get; set; }

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
    /// <summary>Usurpation en cours : compte pour lequel agit l'administrateur de la session, fin, motif.</summary>
    public long? SesUsurpeCptId { get; set; }
    public DateTimeOffset? SesUsurpationFin { get; set; }
    public string? SesUsurpationMotif { get; set; }
    /// <summary>Identifiant de la session dans les jetons d'accès (non consécutif).</summary>
    public Guid SesUuid { get; set; } = Guid.CreateVersion7();
    /// <summary>Fin absolue (D2 : un jour, sept sur une machine connue avec « Rester connecté »).</summary>
    public DateTimeOffset? SesAbsolueLe { get; set; }
    public long? SesMacId { get; set; }
    /// <summary>Session d'un identifiant d'API (jeton Bearer).</summary>
    public bool SesApi { get; set; }
}

/// <summary>Jeton de rafraîchissement remplacé (empreinte) : réutilisé au-delà de 30 s, la session est fermée (vol présumé).</summary>
public class JetonRemplace
{
    public string JreEmpreinte { get; set; } = "";
    public long JreSesId { get; set; }
    public DateTimeOffset JreRemplaceLe { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Machine connue d'un compte (D4) : jeton d'appareil de longue durée, empreinte seule conservée.</summary>
public class MachineConnue
{
    public long MacId { get; set; }
    public Guid MacUuid { get; set; } = Guid.CreateVersion7();
    public long MacCptId { get; set; }
    public string MacEmpreinte { get; set; } = "";
    public string? MacNom { get; set; }
    public DateTimeOffset MacCreeLe { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset MacVuLe { get; set; } = DateTimeOffset.UtcNow;
    public string? MacAdresse { get; set; }
    public DateTimeOffset? MacRevoqueeLe { get; set; }
}

/// <summary>Code du double facteur envoyé par courriel (D3) : étape et code hachés, 10 minutes, 5 essais.</summary>
public class CodeConnexion
{
    public long CcoId { get; set; }
    public long CcoCptId { get; set; }
    public string CcoEtape { get; set; } = "";
    public string CcoCode { get; set; } = "";
    public DateTimeOffset CcoCreeLe { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset CcoExpireLe { get; set; }
    public int CcoEssais { get; set; }
    public DateTimeOffset? CcoUtiliseLe { get; set; }
    public bool CcoRester { get; set; }
    public string? CcoAdresse { get; set; }
}

/// <summary>Adresse (IPv4, ou préfixe /64 en IPv6) exclue après trop d'échecs de connexion (D19 à D21).</summary>
public class IpExclue
{
    public long IpeId { get; set; }
    public string IpePrefixe { get; set; } = "";
    public DateTimeOffset IpeDebut { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset IpeFin { get; set; }
    public int IpeEchecs { get; set; }
    public string? IpeLeveePar { get; set; }
    public DateTimeOffset? IpeLeveeLe { get; set; }
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

/// <summary>Demande de réinitialisation du mot de passe par lien (jeton à usage unique, empreinte seule conservée).</summary>
public class ReinitialisationMdp
{
    public long RmpId { get; set; }
    public long RmpCptId { get; set; }
    public string RmpEmpreinte { get; set; } = "";
    public DateTimeOffset RmpCreeLe { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset RmpExpireLe { get; set; }
    public DateTimeOffset? RmpUtiliseLe { get; set; }
    public string? RmpAdresse { get; set; }
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
    public DbSet<ReinitialisationMdp> Reinitialisations => Set<ReinitialisationMdp>();
    public DbSet<JetonRemplace> JetonsRemplaces => Set<JetonRemplace>();
    public DbSet<MachineConnue> Machines => Set<MachineConnue>();
    public DbSet<CodeConnexion> Codes => Set<CodeConnexion>();
    public DbSet<IpExclue> Exclusions => Set<IpExclue>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Compte>().ToTable("compte").HasKey(x => x.CptId);
        b.Entity<SessionUtilisateur>().ToTable("session_utilisateur").HasKey(x => x.SesId);
        b.Entity<JournalConnexion>().ToTable("journal_connexion").HasKey(x => x.JcoId);
        b.Entity<ParametreAuthentification>().ToTable("parametre_authentification").HasKey(x => x.PauCle);
        b.Entity<ReinitialisationMdp>().ToTable("reinitialisation_mdp").HasKey(x => x.RmpId);
        b.Entity<JetonRemplace>().ToTable("jeton_remplace").HasKey(x => x.JreEmpreinte);
        b.Entity<MachineConnue>().ToTable("machine_connue").HasKey(x => x.MacId);
        b.Entity<CodeConnexion>().ToTable("code_connexion").HasKey(x => x.CcoId);
        b.Entity<IpExclue>().ToTable("ip_exclue").HasKey(x => x.IpeId);
    }
}
