using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Mail.Web;

public class CompteEntite
{
    public long McoId { get; set; }
    public string McoCode { get; set; } = "";
    public string McoIdentite { get; set; } = "";
    public string McoAdresseEmpreinte { get; set; } = "";
    public string McoGenre { get; set; } = "SYSTEME";
    public string? McoCompteUtilisateur { get; set; }
    public bool McoEnvoi { get; set; } = true;
    public bool McoReception { get; set; }
    public string McoAuthentification { get; set; } = "MOT_DE_PASSE";
    public string McoConnexion { get; set; } = "";
    public long? McoOcoId { get; set; }
    public long? McoRepondreAMcoId { get; set; }
    public string? McoSignatureHtml { get; set; }
    public string McoHebergeur { get; set; } = "AUTRE";
    public string McoLimites { get; set; } = "{}";
    public bool McoCopieEnvoyes { get; set; } = true;
    public string McoDossiers { get; set; } = "[]";
    public string McoOptions { get; set; } = "{}";
    public List<string> McoServices { get; set; } = [];
    public bool McoActif { get; set; } = true;
    public string McoEtat { get; set; } = "A_VERIFIER";
    public string? McoDerniereErreur { get; set; }
    public DateTimeOffset? McoVerifieLe { get; set; }
    public DateTimeOffset? McoSuspenduLe { get; set; }
    public string McoCreePar { get; set; } = "";
    public DateTimeOffset McoCreeLe { get; set; }
    public string? McoMajPar { get; set; }
    public DateTimeOffset? McoMajLe { get; set; }
}

public class AliasEntite
{
    public long MalId { get; set; }
    public string MalNom { get; set; } = "";
    public long MalMcoId { get; set; }
    public bool MalPrincipal { get; set; }
    public bool MalActif { get; set; } = true;
}

public class UsageEntite
{
    public long MusId { get; set; }
    public string MusUsage { get; set; } = "";
    public string MusPortee { get; set; } = "";
    public long MusMalId { get; set; }
}

public class ModeleEntite
{
    public long MmoId { get; set; }
    public string MmoCode { get; set; } = "";
    public string MmoLibelle { get; set; } = "";
    public string MmoUsage { get; set; } = "";
    public string MmoType { get; set; } = "";
    public string MmoObjet { get; set; } = "";
    public string MmoCorpsHtml { get; set; } = "";
    public bool MmoDefaut { get; set; }
    public bool MmoActif { get; set; } = true;
}

public class LotEntite
{
    public long MloId { get; set; }
    public string MloOrigine { get; set; } = "";
    public string? MloLibelle { get; set; }
    public string MloAuteur { get; set; } = "";
    public int MloMessages { get; set; }
    public int MloDestinataires { get; set; }
    public int MloEnvoyes { get; set; }
    public int MloErreurs { get; set; }
    public DateTimeOffset? MloFinEstimee { get; set; }
    public string? MloAvertissement { get; set; }
    public string? MloAcceptePar { get; set; }
    public DateTimeOffset? MloAccepteLe { get; set; }
    public DateTimeOffset MloCreeLe { get; set; }
}

public class MessageEntite
{
    public long MmeId { get; set; }
    public long MmeMcoId { get; set; }
    public long? MmeMalId { get; set; }
    public string? MmeExpediteur { get; set; }
    public string MmeSens { get; set; } = "E";
    public string MmeEtat { get; set; } = "A_ENVOYER";
    public string MmePriorite { get; set; } = "NORMALE";
    public long? MmeMloId { get; set; }
    public string? MmeUsage { get; set; }
    public string? MmeTypeElement { get; set; }
    public string? MmeIdElement { get; set; }
    public string? MmeMessageId { get; set; }
    public string? MmeInReplyTo { get; set; }
    public string? MmeReferences { get; set; }
    public string MmeObjet { get; set; } = "";
    public string? MmeDe { get; set; }
    public string? MmeCorpsHtml { get; set; }
    public string? MmeExtrait { get; set; }
    public DateTimeOffset? MmeDate { get; set; }
    public string? MmeEmpreinte { get; set; }
    public long? MmeDgeId { get; set; }
    public long? MmeUid { get; set; }
    public string? MmeDossier { get; set; }
    public int MmeTentatives { get; set; }
    public DateTimeOffset? MmeProchainEssai { get; set; }
    public string? MmeAttente { get; set; }
    public string? MmeErreur { get; set; }
    public bool MmeAuto { get; set; }
    public bool MmeCopieMoi { get; set; }
    public string MmeCreePar { get; set; } = "";
    public DateTimeOffset MmeCreeLe { get; set; }
    public DateTimeOffset? MmeEnvoyeLe { get; set; }
}

public class DestinataireEntite
{
    public long MdeId { get; set; }
    public long MdeMmeId { get; set; }
    public string MdeRole { get; set; } = "A";
    public string MdeAdresse { get; set; } = "";
    public string? MdeNom { get; set; }
    public long? MdePerId { get; set; }
    public long? MdeIndId { get; set; }
    public string? MdeNonRemis { get; set; }
}

public class PieceEntite
{
    public long MpiId { get; set; }
    public long MpiMmeId { get; set; }
    public string MpiReference { get; set; } = "";
    public string MpiNom { get; set; } = "";
    public string? MpiType { get; set; }
    public long MpiTaille { get; set; }
}

public class LienEntite
{
    public long MliId { get; set; }
    public long MliMmeId { get; set; }
    public string MliTypeElement { get; set; } = "";
    public string MliIdElement { get; set; } = "";
    public string MliOrigine { get; set; } = "MANUEL";
    public int? MliScore { get; set; }
    public string? MliRegle { get; set; }
    public string MliPar { get; set; } = "";
    public DateTimeOffset MliLe { get; set; }
    public DateTimeOffset? MliRetireLe { get; set; }
    public string? MliRetirePar { get; set; }
}

public class JournalEntite
{
    public long MjoId { get; set; }
    public long? MjoMmeId { get; set; }
    public long? MjoMloId { get; set; }
    public long MjoMcoId { get; set; }
    public string? MjoAlias { get; set; }
    public string MjoUtilisateur { get; set; } = "";
    public string? MjoOrigine { get; set; }
    public int MjoDestinataires { get; set; }
    public int MjoNouveaux { get; set; }
    public List<string> MjoDomaines { get; set; } = [];
    public List<string> MjoAdresses { get; set; } = [];
    public long MjoTaille { get; set; }
    public string MjoResultat { get; set; } = "OK";
    public string? MjoCode { get; set; }
    public string? MjoReponse { get; set; }
    public int? MjoDureeMs { get; set; }
    public DateTimeOffset MjoLe { get; set; }
}

public class ParametreEntite
{
    public string MpaCle { get; set; } = "";
    public string MpaValeur { get; set; } = "null";
}

public class MailDbContext(DbContextOptions<MailDbContext> options) : DbContext(options)
{
    public DbSet<CompteEntite> Comptes => Set<CompteEntite>();
    public DbSet<AliasEntite> Alias => Set<AliasEntite>();
    public DbSet<UsageEntite> Usages => Set<UsageEntite>();
    public DbSet<ModeleEntite> Modeles => Set<ModeleEntite>();
    public DbSet<LotEntite> Lots => Set<LotEntite>();
    public DbSet<MessageEntite> Messages => Set<MessageEntite>();
    public DbSet<DestinataireEntite> Destinataires => Set<DestinataireEntite>();
    public DbSet<PieceEntite> Pieces => Set<PieceEntite>();
    public DbSet<LienEntite> Liens => Set<LienEntite>();
    public DbSet<JournalEntite> Journal => Set<JournalEntite>();
    public DbSet<ParametreEntite> Parametres => Set<ParametreEntite>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<CompteEntite>(e =>
        {
            e.ToTable("mail_compte").HasKey(x => x.McoId);
            e.Property(x => x.McoLimites).HasColumnType("jsonb");
            e.Property(x => x.McoDossiers).HasColumnType("jsonb");
            e.Property(x => x.McoOptions).HasColumnType("jsonb");
            e.Property(x => x.McoCreeLe).ValueGeneratedOnAdd();
        });
        b.Entity<AliasEntite>().ToTable("mail_alias").HasKey(x => x.MalId);
        b.Entity<UsageEntite>().ToTable("mail_usage").HasKey(x => x.MusId);
        b.Entity<ModeleEntite>().ToTable("mail_modele").HasKey(x => x.MmoId);
        b.Entity<LotEntite>().ToTable("mail_lot").HasKey(x => x.MloId);
        b.Entity<LotEntite>().Property(x => x.MloCreeLe).ValueGeneratedOnAdd();
        b.Entity<MessageEntite>().ToTable("mail_message").HasKey(x => x.MmeId);
        b.Entity<MessageEntite>().Property(x => x.MmeCreeLe).ValueGeneratedOnAdd();
        b.Entity<DestinataireEntite>().ToTable("mail_destinataire").HasKey(x => x.MdeId);
        b.Entity<PieceEntite>().ToTable("mail_piece").HasKey(x => x.MpiId);
        b.Entity<LienEntite>().ToTable("mail_lien").HasKey(x => x.MliId);
        b.Entity<JournalEntite>().ToTable("mail_journal").HasKey(x => x.MjoId);
        b.Entity<ParametreEntite>().ToTable("mail_parametre").HasKey(x => x.MpaCle);
        b.Entity<ParametreEntite>().Property(x => x.MpaValeur).HasColumnType("jsonb");
    }
}
