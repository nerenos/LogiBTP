using Microsoft.EntityFrameworkCore;

namespace LogiBTP.FactureElectronique.Web;

// Entités du schéma du module (modules/facture-electronique/db/099f_facture_electronique.sql) ; colonnes en snake_case
// par la convention de l'application (UseSnakeCaseNamingConvention).

/// <summary>Paramètres de la société (une ligne, fpa_id = 1).</summary>
public class ParametreFe
{
    public short FpaId { get; set; } = 1;
    public bool FpaActif { get; set; }
    public string FpaConnecteur { get; set; } = ConnecteurFe.Manuel;
    public long? FpaConnexionOauth { get; set; }
    public string? FpaAdresseFlux { get; set; }
    public string? FpaAdresseAnnuaire { get; set; }
    public string? FpaOrganisation { get; set; }
    public string? FpaAdresseElectronique { get; set; }
    public string FpaSchemaAdresse { get; set; } = SchemaIdentifiant.AdresseElectronique;
    public string FpaSyntaxe { get; set; } = Syntaxe.FacturX;
    public string FpaProfil { get; set; } = ProfilFacture.En16931;
    public int FpaFrequenceReleve { get; set; } = 15;
    public int FpaDelaiSecondes { get; set; } = 100;
    public string FpaDecoupageEreporting { get; set; } = DecoupageEreporting.Unique;
    public DateTimeOffset FpaModifieLe { get; set; }
    public string FpaModifiePar { get; set; } = "";
}

/// <summary>Flux émis ou reçu, avec son état dans la file (EtatFlux).</summary>
public class FluxFe
{
    public long FflId { get; set; }
    public string FflSens { get; set; } = SensFlux.Sortant;
    public string FflType { get; set; } = TypeFlux.FactureClient;
    public string FflSyntaxe { get; set; } = Syntaxe.Cii;
    public string? FflProfil { get; set; }
    public string? FflRegle { get; set; }
    public string? FflOrigineRegle { get; set; }
    public string FflNom { get; set; } = "";
    public string? FflNumero { get; set; }
    public string? FflIdSuivi { get; set; }
    public string? FflIdFlux { get; set; }
    public string FflConnecteur { get; set; } = "";
    public string FflEmpreinte { get; set; } = "";
    public long? FflGedOriginalId { get; set; }
    public long? FflGedConvertiId { get; set; }
    public long? FflGedLisibleId { get; set; }
    public string? FflTypeElement { get; set; }
    public string? FflIdElement { get; set; }
    public string FflEtat { get; set; } = EtatFlux.AEnvoyer;
    public string? FflAccuse { get; set; }
    public string? FflAccuseDetails { get; set; }
    public int FflEssais { get; set; }
    public DateTimeOffset? FflProchainEssai { get; set; }
    public string? FflDerniereErreur { get; set; }
    public string? FflCurseur { get; set; }
    public DateTimeOffset? FflDeposeLe { get; set; }
    public DateTimeOffset? FflModifiePaLe { get; set; }
    public DateTimeOffset FflCreeLe { get; set; }
    public string FflCreePar { get; set; } = "";
    public DateTimeOffset FflModifieLe { get; set; }
}

/// <summary>Fichier d'un flux (Original, Converted, ReadableView).</summary>
public class FichierFe
{
    public long FfiFflId { get; set; }
    public string FfiDocument { get; set; } = TypeDocumentFlux.Original;
    public string FfiNom { get; set; } = "";
    public string FfiTypeMime { get; set; } = "";
    public string FfiEmpreinte { get; set; } = "";
    public byte[] FfiContenu { get; set; } = [];
    public DateTimeOffset FfiCreeLe { get; set; }
}

/// <summary>Statut du cycle de vie d'une facture, reçu ou posé (SensStatut).</summary>
public class StatutFe
{
    public long FstId { get; set; }
    public long? FstFflId { get; set; }
    public string FstNumeroFacture { get; set; } = "";
    public string FstSensFacture { get; set; } = SensFacture.Emise;
    public string FstCode { get; set; } = "";
    public string? FstMotif { get; set; }
    public string? FstAction { get; set; }
    public decimal? FstMontant { get; set; }
    public decimal? FstTaux { get; set; }
    public string? FstEmetteur { get; set; }
    public string FstSens { get; set; } = SensStatut.Recu;
    public long? FstFflCdarId { get; set; }
    public long? FstGedCdarId { get; set; }
    public DateTimeOffset FstDate { get; set; }
    public string FstErreurs { get; set; } = "[]";
    public string? FstDetail { get; set; }
    public DateTimeOffset FstCreeLe { get; set; }
    public string FstCreePar { get; set; } = "";
}

/// <summary>Erreur d'un flux : refus de la plateforme, échec d'un appel, lecture impossible.</summary>
public class ErreurFluxFe
{
    public long FerId { get; set; }
    public long FerFflId { get; set; }
    public string FerCode { get; set; } = "";
    public string? FerNiveau { get; set; }
    public string? FerElement { get; set; }
    public string? FerMessage { get; set; }
    public int? FerStatutHttp { get; set; }
    public string? FerRequestId { get; set; }
    public int FerEssai { get; set; }
    public DateTimeOffset FerCreeLe { get; set; }
}

/// <summary>
/// Étape du journal chaîné (lecture seule pour EF : l'écriture passe par <see cref="JournalFe"/>, le chaînage par le
/// trigger fn_fe_evenement_chainer). <see cref="FevDetail"/> est le texte du JSONB rendu par PostgreSQL (fev_detail::text),
/// celui qui entre dans l'empreinte.
/// </summary>
public class EvenementFeEntite
{
    public long FevId { get; set; }
    public long FevRang { get; set; }
    public long? FevFflId { get; set; }
    public string? FevTypeElement { get; set; }
    public string? FevIdElement { get; set; }
    public string FevType { get; set; } = "";
    public string? FevEtatAvant { get; set; }
    public string? FevEtatApres { get; set; }
    public string FevActeur { get; set; } = "";
    public string? FevUtilisateur { get; set; }
    public string? FevDetail { get; set; }
    public DateTimeOffset FevHorodatage { get; set; }
    public string FevEmpreintePrecedente { get; set; } = "";
    public string FevEmpreinte { get; set; } = "";
}

/// <summary>Relève par curseur d'un sens de flux.</summary>
public class ReleveFe
{
    public string FreSens { get; set; } = SensFlux.Entrant;
    public string? FreCurseur { get; set; }
    public DateTimeOffset? FreDerniereReleve { get; set; }
    public DateTimeOffset? FreDernierSucces { get; set; }
    public string? FreDerniereErreur { get; set; }
    public int FreNombre { get; set; }
}

/// <summary>Contexte EF Core du module ; snake_case par la convention de l'application.</summary>
public class FactureElectroniqueDbContext(DbContextOptions<FactureElectroniqueDbContext> options) : DbContext(options)
{
    public DbSet<ParametreFe> Parametres => Set<ParametreFe>();
    public DbSet<FluxFe> Flux => Set<FluxFe>();
    public DbSet<FichierFe> Fichiers => Set<FichierFe>();
    public DbSet<StatutFe> Statuts => Set<StatutFe>();
    public DbSet<ErreurFluxFe> Erreurs => Set<ErreurFluxFe>();
    public DbSet<EvenementFeEntite> Evenements => Set<EvenementFeEntite>();
    public DbSet<ReleveFe> Releves => Set<ReleveFe>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<ParametreFe>(e => { e.ToTable("fe_parametre").HasKey(x => x.FpaId); e.Property(x => x.FpaId).ValueGeneratedNever(); });
        b.Entity<FluxFe>(e =>
        {
            e.ToTable("fe_flux").HasKey(x => x.FflId);
            e.Property(x => x.FflAccuseDetails).HasColumnType("jsonb");
        });
        b.Entity<FichierFe>().ToTable("fe_fichier").HasKey(x => new { x.FfiFflId, x.FfiDocument });
        b.Entity<StatutFe>(e =>
        {
            e.ToTable("fe_statut").HasKey(x => x.FstId);
            e.Property(x => x.FstErreurs).HasColumnType("jsonb");
            e.Property(x => x.FstDetail).HasColumnType("jsonb");
        });
        b.Entity<ErreurFluxFe>().ToTable("fe_erreur").HasKey(x => x.FerId);
        // Journal : lu par une requête qui rend fev_detail::text (JournalFe), jamais modifié par EF.
        b.Entity<EvenementFeEntite>().ToTable("fe_evenement").HasKey(x => x.FevId);
        b.Entity<ReleveFe>(e => { e.ToTable("fe_releve").HasKey(x => x.FreSens); e.Property(x => x.FreSens).ValueGeneratedNever(); });
    }
}
