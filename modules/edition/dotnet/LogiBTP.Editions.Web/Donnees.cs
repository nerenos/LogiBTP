using LogiBTP.Socle;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Editions.Web;

/// <summary>Charte graphique (modules/edition/db/090) : contenu JSON (couleurs, styles, traits, marges).</summary>
public class CharteEdition
{
    public string CheCode { get; set; } = "";
    public string CheLibelle { get; set; } = "";
    public string CheContenu { get; set; } = "{}";
    public bool CheDefaut { get; set; }
    public DateTimeOffset CheModifieLe { get; set; }
    public string CheModifiePar { get; set; } = "";
}

/// <summary>Modèle d'édition : rapport ou bloc, contenu JSON au format du moteur.</summary>
public class ModeleEdition
{
    public long MedId { get; set; }
    public string MedCode { get; set; } = "";
    public string MedLibelle { get; set; } = "";
    public string MedGenre { get; set; } = "RAPPORT";
    public string? MedCible { get; set; }
    public string? MedSource { get; set; }
    public List<string> MedTypes { get; set; } = [];
    public string MedContenu { get; set; } = "{}";
    public int MedVersion { get; set; } = 1;
    public string MedNiveauAcces { get; set; } = NiveauConfidentialite.Interne;
    public List<string> MedAccesProfils { get; set; } = [];
    public string? MedCharte { get; set; }
    public int MedOrdre { get; set; }
    public bool MedFourni { get; set; }
    public bool MedModifieLocal { get; set; }
    public bool MedActif { get; set; } = true;
    public DateTimeOffset MedCreeLe { get; set; }
    public string MedCreePar { get; set; } = "";
    public DateTimeOffset MedModifieLe { get; set; }
    public string MedModifiePar { get; set; } = "";
}

/// <summary>Version précédente d'un modèle (historique tenu par déclencheur).</summary>
public class ModeleEditionVersion
{
    public long MevId { get; set; }
    public long MevMedId { get; set; }
    public int MevVersion { get; set; }
    public string MevContenu { get; set; } = "{}";
    public DateTimeOffset MevLe { get; set; }
    public string MevPar { get; set; } = "";
}

/// <summary>Dépendance d'un modèle : bloc lié, sous-rapport ou ressource image.</summary>
public class ModeleEditionLien
{
    public long MelMedId { get; set; }
    public string MelGenre { get; set; } = "BLOC";
    public string MelCode { get; set; } = "";
}

/// <summary>Modèle par défaut d'un type (cible + type).</summary>
public class ModeleEditionDefaut
{
    public string MddCible { get; set; } = "";
    public string MddType { get; set; } = "";
    public long MddMedId { get; set; }
}

/// <summary>Production d'une édition par le serveur (file modules/edition/db/091).</summary>
public class TacheEdition
{
    public long EttId { get; set; }
    public string EttSource { get; set; } = "";
    public string EttIdElement { get; set; } = "";
    public string? EttModele { get; set; }
    public string? EttPresentation { get; set; }
    public string EttMotif { get; set; } = "DEMANDE";
    public bool EttCoffre { get; set; }
    public string EttEtat { get; set; } = "A_FAIRE";
    public short EttEssais { get; set; }
    public string? EttErreur { get; set; }
    public long? EttGedId { get; set; }
    public int? EttPages { get; set; }
    public string EttDemandePar { get; set; } = "";
    public DateTimeOffset EttCreeLe { get; set; }
    public DateTimeOffset? EttTraiteLe { get; set; }
}

/// <summary>Contexte EF Core du module (modules/edition/db) ; snake_case par la convention de l'application.</summary>
public class EditionDbContext(DbContextOptions<EditionDbContext> options) : DbContext(options)
{
    public DbSet<CharteEdition> Chartes => Set<CharteEdition>();
    public DbSet<ModeleEdition> Modeles => Set<ModeleEdition>();
    public DbSet<ModeleEditionVersion> Versions => Set<ModeleEditionVersion>();
    public DbSet<ModeleEditionLien> Liens => Set<ModeleEditionLien>();
    public DbSet<ModeleEditionDefaut> Defauts => Set<ModeleEditionDefaut>();
    public DbSet<TacheEdition> Taches => Set<TacheEdition>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<CharteEdition>(e => { e.ToTable("charte_edition").HasKey(x => x.CheCode); e.Property(x => x.CheContenu).HasColumnType("jsonb"); });
        b.Entity<ModeleEdition>(e =>
        {
            e.ToTable("modele_edition").HasKey(x => x.MedId);
            e.Property(x => x.MedContenu).HasColumnType("jsonb");
            e.Property(x => x.MedVersion).ValueGeneratedOnAddOrUpdate().Metadata.SetAfterSaveBehavior(Microsoft.EntityFrameworkCore.Metadata.PropertySaveBehavior.Ignore);
        });
        b.Entity<ModeleEditionVersion>(e => { e.ToTable("modele_edition_version").HasKey(x => x.MevId); e.Property(x => x.MevContenu).HasColumnType("jsonb"); });
        b.Entity<ModeleEditionLien>().ToTable("modele_edition_lien").HasKey(x => new { x.MelMedId, x.MelGenre, x.MelCode });
        b.Entity<ModeleEditionDefaut>().ToTable("modele_edition_defaut").HasKey(x => new { x.MddCible, x.MddType });
        b.Entity<TacheEdition>().ToTable("edition_tache").HasKey(x => x.EttId);
    }
}
