using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Ged.Web;

public class ContenuGed
{
    public string CgeEmpreinte { get; set; } = "";
    public long CgeTaille { get; set; }
    public string CgeChemin { get; set; } = "";
    public DateTimeOffset CgeCreeLe { get; set; }
}

public class DocumentGed
{
    public long DgeId { get; set; }
    public string DgeTitre { get; set; } = "";
    public string? DgeCategorie { get; set; }
    public string DgeNature { get; set; } = "fichier";
    public string? DgeTypeElement { get; set; }
    public string? DgeIdElement { get; set; }
    public string? DgeAuteur { get; set; }
    public DateOnly? DgeDateDocument { get; set; }
    public long? DgeParentId { get; set; }
    public JsonDocument? DgeMail { get; set; }
    public string? DgeResume { get; set; }
    public string? DgeNotes { get; set; }
    public string? DgeEtat { get; set; }
    public bool DgeCoffre { get; set; }
    public DateTimeOffset? DgeCoffreLe { get; set; }
    public bool DgeSupprime { get; set; }
    public DateTimeOffset? DgeSupprimeLe { get; set; }
    public string? DgeSupprimePar { get; set; }
    public DateTimeOffset DgeCreeLe { get; set; }
    public string DgeCreePar { get; set; } = "";
    public DateTimeOffset? DgeModifieLe { get; set; }
}

public class VersionGed
{
    public long VgeId { get; set; }
    public long VgeDocument { get; set; }
    public int VgeNumero { get; set; }
    public string VgeGenre { get; set; } = RegleVersions.Edition;
    public string? VgeEtape { get; set; }
    public string? VgeEtat { get; set; }
    public string VgeEmpreinte { get; set; } = "";
    public string VgeNomFichier { get; set; } = "";
    public string? VgeTypeMime { get; set; }
    public long VgeTaille { get; set; }
    public string VgeAuteur { get; set; } = "";
    public DateTimeOffset VgeDate { get; set; }
    public string? VgeCommentaire { get; set; }
}

public class EntreeCoffreGed
{
    public long CofId { get; set; }
    public long CofDocument { get; set; }
    public long CofVersion { get; set; }
    public string CofEmpreinteDocument { get; set; } = "";
    public DateTimeOffset CofHorodatage { get; set; }
    public string CofUtilisateur { get; set; } = "";
    public string? CofMotif { get; set; }
    public string CofEmpreintePrecedente { get; set; } = "";
    public string CofEmpreinteEntree { get; set; } = "";

    public EntreeCoffre VersEntree() => new(CofEmpreintePrecedente, CofEmpreinteDocument, CofHorodatage, CofDocument, CofVersion, CofUtilisateur, CofMotif, CofEmpreinteEntree);
}

public class ParametreGed
{
    public string PgeCle { get; set; } = "";
    public JsonDocument PgeValeur { get; set; } = JsonDocument.Parse("null");
}

/// <summary>Contexte EF Core du module GED (modules/ged/db) ; les options sont fournies par l'application.</summary>
public class GedDbContext(DbContextOptions<GedDbContext> options) : DbContext(options)
{
    public DbSet<ContenuGed> Contenus => Set<ContenuGed>();
    public DbSet<DocumentGed> Documents => Set<DocumentGed>();
    public DbSet<VersionGed> Versions => Set<VersionGed>();
    public DbSet<EntreeCoffreGed> Coffre => Set<EntreeCoffreGed>();
    public DbSet<ParametreGed> Parametres => Set<ParametreGed>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<ContenuGed>().ToTable("contenu_ged").HasKey(x => x.CgeEmpreinte);
        b.Entity<DocumentGed>(e => { e.ToTable("document_ged").HasKey(x => x.DgeId); e.Property(x => x.DgeMail).HasColumnType("jsonb"); });
        b.Entity<VersionGed>().ToTable("version_ged").HasKey(x => x.VgeId);
        b.Entity<EntreeCoffreGed>().ToTable("coffre_ged").HasKey(x => x.CofId);
        b.Entity<ParametreGed>(e => { e.ToTable("parametre_ged").HasKey(x => x.PgeCle); e.Property(x => x.PgeValeur).HasColumnType("jsonb"); });
    }
}

// ------------------------------------------------------------------ contrats HTTP (snake_case, comme FournisseurGedApi)

public sealed class ParametresGedDto
{
    public int EditionsConservees { get; set; } = 5;
    public long TailleApercuMax { get; set; } = 15 * 1024 * 1024;
    public string AdresseCopieCachee { get; set; } = "";
    public JsonElement Categories { get; set; }
}

public sealed class FiltreGed
{
    public string? TypeElement { get; set; }
    public string? IdElement { get; set; }
    public string? Recherche { get; set; }
    public bool Supprimes { get; set; }
    public bool Coffre { get; set; }
}

/// <summary>Informations d'un dépôt (champ « donnees » du formulaire) ; une nouvelle version reprend genre, etape, etat, commentaire.</summary>
public sealed class MetaDepot
{
    public string? Titre { get; set; }
    public string? Categorie { get; set; }
    public string? Nature { get; set; }
    public string? TypeElement { get; set; }
    public string? IdElement { get; set; }
    public string? Auteur { get; set; }
    public string? DateDocument { get; set; }
    public long? ParentId { get; set; }
    public JsonElement? Mail { get; set; }
    public string? Resume { get; set; }
    public string? Notes { get; set; }
    public bool Coffre { get; set; }
    public string? Genre { get; set; }
    public string? Etape { get; set; }
    public string? Etat { get; set; }
    public string? Commentaire { get; set; }
}

public sealed class DemandeEtape
{
    public string Etape { get; set; } = "";
    public string? Etat { get; set; }
    public string? Commentaire { get; set; }
}

public sealed class DemandeCoffre
{
    public string? Motif { get; set; }
}

public sealed record VersionCouranteDto(long Id, int Numero, string NomFichier, string? TypeMime, long Taille, string Genre);

public sealed record VersionDto(long Id, long Document, int Numero, string Genre, string? Etape, string? Etat, string Empreinte, string NomFichier,
    string? TypeMime, long Taille, string Auteur, DateTimeOffset Date, string? Commentaire);

public sealed record EntreeCoffreDto(long Id, long Document, long Version, string EmpreinteDocument, string Horodatage, string Utilisateur,
    string? Motif, string EmpreintePrecedente, string EmpreinteEntree);

public class DocumentDto
{
    public long Id { get; set; }
    public string Titre { get; set; } = "";
    public string? Categorie { get; set; }
    public string Nature { get; set; } = "fichier";
    public string? TypeElement { get; set; }
    public string? IdElement { get; set; }
    public string? Auteur { get; set; }
    public string? DateDocument { get; set; }
    public long? ParentId { get; set; }
    public JsonElement? Mail { get; set; }
    public string? Resume { get; set; }
    public string? Notes { get; set; }
    public string? Etat { get; set; }
    public bool Coffre { get; set; }
    public DateTimeOffset? CoffreLe { get; set; }
    public bool Supprime { get; set; }
    public DateTimeOffset? SupprimeLe { get; set; }
    public string? SupprimePar { get; set; }
    public DateTimeOffset CreeLe { get; set; }
    public string CreePar { get; set; } = "";
    public DateTimeOffset? ModifieLe { get; set; }
    public VersionCouranteDto? Version { get; set; }
    public int NbPieces { get; set; }
}

public sealed class DocumentDetailDto : DocumentDto
{
    public List<VersionDto> Versions { get; set; } = [];
    public List<DocumentDto> Pieces { get; set; } = [];
    public DocumentDto? Parent { get; set; }
    public List<EntreeCoffreDto> JournalCoffre { get; set; } = [];
}

public sealed record VerificationDto(bool Integre, string EmpreinteAttendue, string? EmpreinteCalculee, string? Horodatage, ResultatChaine? Coffre);
