using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using NpgsqlTypes;

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
    /// <summary>Pièce jointe à envoyer avec l'élément lié (module Mail).</summary>
    public bool DgeAEnvoyer { get; set; }
    public DateTimeOffset? DgeCoffreLe { get; set; }
    public bool DgeSupprime { get; set; }
    public DateTimeOffset? DgeSupprimeLe { get; set; }
    public string? DgeSupprimePar { get; set; }
    public DateTimeOffset DgeCreeLe { get; set; }
    public string DgeCreePar { get; set; } = "";
    public DateTimeOffset? DgeModifieLe { get; set; }
    /// <summary>Consultations du contenu (tenu par le déclencheur de consultation_ged).</summary>
    public int DgeNbConsultations { get; set; }
    public DateTimeOffset? DgeConsulteLe { get; set; }
    /// <summary>Texte de recherche normalisé (colonne générée par la base, index trigrammes) : jamais écrit.</summary>
    public string? DgeRecherche { get; set; }
    /// <summary>Répertoire de l'explorateur (même élément lié que le document).</summary>
    public long? DgeRepertoireId { get; set; }
    /// <summary>PUBLIC, INTERNE, CONFIDENTIEL ou SECRET (règle d'accès : AccesGed).</summary>
    public string DgeConfidentialite { get; set; } = AccesGed.Interne;
    public string[] DgeAccesProfils { get; set; } = [];
    public string[] DgeAccesUtilisateurs { get; set; } = [];
    /// <summary>Texte extrait du contenu courant (indexation plein texte).</summary>
    public string? DgeTexteContenu { get; set; }
    public string[] DgeMotsCles { get; set; } = [];
    public string DgeLangue { get; set; } = "fr";
    /// <summary>A_FAIRE, FAIT, SANS_TEXTE ou ECHEC.</summary>
    public string DgeIndexEtat { get; set; } = ExtractionTexte.AFaire;
    public DateTimeOffset? DgeIndexeLe { get; set; }
    /// <summary>Règles de classification appliquées au dépôt : { regles, le }.</summary>
    public JsonDocument? DgeClassification { get; set; }
    /// <summary>Nombre de versions et numéro courant (tenus par le déclencheur tr_ged_compteur_versions) : jamais écrits.</summary>
    public int DgeNbVersions { get; set; }
    public int? DgeVersionCourante { get; set; }
    /// <summary>Archivé sur place (document du coffre-fort) : exclu des recherches actives.</summary>
    public bool DgeArchive { get; set; }
    public DateTimeOffset? DgeArchiveLe { get; set; }
    /// <summary>Vecteur plein texte (colonne générée) : jamais écrit.</summary>
    public NpgsqlTsVector? DgePleinTexte { get; set; }
}

/// <summary>Document déplacé dans l'archive (document_ged_archive, mêmes colonnes) : colonnes lues par l'application.</summary>
public class DocumentArchiveGed
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
    public DateTimeOffset DgeCreeLe { get; set; }
    public string DgeCreePar { get; set; } = "";
    public DateTimeOffset? DgeModifieLe { get; set; }
    public string? DgeRecherche { get; set; }
    public long? DgeRepertoireId { get; set; }
    public string DgeConfidentialite { get; set; } = AccesGed.Interne;
    public string[] DgeAccesProfils { get; set; } = [];
    public string[] DgeAccesUtilisateurs { get; set; } = [];
    public string[] DgeMotsCles { get; set; } = [];
    public string DgeLangue { get; set; } = "fr";
    public string DgeIndexEtat { get; set; } = ExtractionTexte.AFaire;
    public string? DgeTexteContenu { get; set; }
    public int DgeNbVersions { get; set; }
    public int DgeNbConsultations { get; set; }
    public NpgsqlTsVector? DgePleinTexte { get; set; }
    public DateTimeOffset DgaArchiveLe { get; set; }
    public string DgaArchivePar { get; set; } = "";
    public string? DgaMotif { get; set; }
}

/// <summary>Répertoire créé dans l'explorateur, sous un élément lié (ou global).</summary>
public class RepertoireGed
{
    public long RgeId { get; set; }
    public string RgeNom { get; set; } = "";
    public long? RgeParentId { get; set; }
    public string? RgeTypeElement { get; set; }
    public string? RgeIdElement { get; set; }
    public DateTimeOffset RgeCreeLe { get; set; }
    public string RgeCreePar { get; set; } = "";
}

/// <summary>La cible dérive de la source (VERSION, TRADUCTION, ADAPTATION, EXTRAIT, ANNOTATION).</summary>
public class DerivationGed
{
    public long DrgId { get; set; }
    public long DrgSourceId { get; set; }
    public long DrgCibleId { get; set; }
    public string DrgType { get; set; } = "";
    public string? DrgLangue { get; set; }
    public string? DrgCommentaire { get; set; }
    public DateTimeOffset DrgCreeLe { get; set; }
    public string DrgCreePar { get; set; } = "";
}

/// <summary>Ligne de regle_retention_ged.</summary>
public class RetentionGed
{
    public int RrgId { get; set; }
    public string RrgLibelle { get; set; } = "";
    public string? RrgCategorie { get; set; }
    public string? RrgTypeElement { get; set; }
    public int? RrgDureeActiveMois { get; set; }
    public int? RrgDureeConservationMois { get; set; }
    public string RrgActionFin { get; set; } = "REVOIR";
    public int RrgPriorite { get; set; } = 100;
    public bool RrgActif { get; set; } = true;

    public RegleRetentionGed VersRegle() => new(RrgId, RrgLibelle, RrgCategorie, RrgTypeElement, RrgDureeActiveMois, RrgDureeConservationMois, RrgActionFin, RrgPriorite, RrgActif);
}

/// <summary>Ligne de regle_classification_ged.</summary>
public class ClassementGed
{
    public int RcgId { get; set; }
    public string RcgLibelle { get; set; } = "";
    public int RcgPriorite { get; set; } = 100;
    public bool RcgActif { get; set; } = true;
    public string[] RcgExtensions { get; set; } = [];
    public string[] RcgTypesMime { get; set; } = [];
    public string[] RcgMots { get; set; } = [];
    public string? RcgExpediteur { get; set; }
    public string? RcgTypeElement { get; set; }
    public string? RcgCategorie { get; set; }
    public string? RcgConfidentialite { get; set; }
    public string[] RcgMotsCles { get; set; } = [];

    public RegleClassificationGed VersRegle() => new(RcgId, RcgLibelle, RcgPriorite, RcgExtensions, RcgTypesMime, RcgMots, RcgExpediteur, RcgTypeElement,
        RcgCategorie, RcgConfidentialite, RcgMotsCles, RcgActif);
}

/// <summary>Consultation d'un contenu (aperçu ou téléchargement) : journal des statistiques d'utilisation.</summary>
public class ConsultationGed
{
    public long CogId { get; set; }
    public long CogDocument { get; set; }
    public long? CogVersion { get; set; }
    public string CogUtilisateur { get; set; } = "";
    public bool CogTelechargement { get; set; }
    public DateTimeOffset CogDate { get; set; }
}

/// <summary>Statistiques d'utilisation par élément lié (table statistique_ged, tenue par déclencheurs).</summary>
public class StatistiqueGed
{
    public string SgeTypeElement { get; set; } = "";
    public string SgeIdElement { get; set; } = "";
    public int SgeNbDocuments { get; set; }
    public int SgeNbSupprimes { get; set; }
    public int SgeNbCoffre { get; set; }
    public int SgeNbVersions { get; set; }
    public long SgeTaille { get; set; }
    public long SgeNbConsultations { get; set; }
    public DateTimeOffset? SgeDerniereActivite { get; set; }
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

/// <summary>Version d'un document archivé (version_ged_archive, mêmes colonnes que version_ged).</summary>
public class VersionArchiveGed
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

    public VersionGed VersVersion() => new()
    {
        VgeId = VgeId, VgeDocument = VgeDocument, VgeNumero = VgeNumero, VgeGenre = VgeGenre, VgeEtape = VgeEtape, VgeEtat = VgeEtat, VgeEmpreinte = VgeEmpreinte,
        VgeNomFichier = VgeNomFichier, VgeTypeMime = VgeTypeMime, VgeTaille = VgeTaille, VgeAuteur = VgeAuteur, VgeDate = VgeDate, VgeCommentaire = VgeCommentaire,
    };
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
    public DbSet<ConsultationGed> Consultations => Set<ConsultationGed>();
    public DbSet<StatistiqueGed> Statistiques => Set<StatistiqueGed>();
    public DbSet<RepertoireGed> Repertoires => Set<RepertoireGed>();
    public DbSet<DerivationGed> Derivations => Set<DerivationGed>();
    public DbSet<RetentionGed> ReglesRetention => Set<RetentionGed>();
    public DbSet<ClassementGed> ReglesClassification => Set<ClassementGed>();
    public DbSet<DocumentArchiveGed> Archives => Set<DocumentArchiveGed>();
    public DbSet<VersionArchiveGed> VersionsArchive => Set<VersionArchiveGed>();

    /// <summary>Normalisation de recherche de la base (f_ged_normaliser), utilisable dans les requêtes.</summary>
    public static string Normaliser(string texte) => throw new NotSupportedException("Fonction SQL f_ged_normaliser");

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<ContenuGed>().ToTable("contenu_ged").HasKey(x => x.CgeEmpreinte);
        b.Entity<DocumentGed>(e =>
        {
            e.ToTable("document_ged").HasKey(x => x.DgeId);
            e.Property(x => x.DgeMail).HasColumnType("jsonb");
            e.Property(x => x.DgeClassification).HasColumnType("jsonb");
            // Colonnes générées et compteurs tenus par la base : jamais écrits par l'application.
            e.Property(x => x.DgeRecherche).ValueGeneratedOnAddOrUpdate();
            e.Property(x => x.DgePleinTexte).ValueGeneratedOnAddOrUpdate();
            foreach (var p in new[] { e.Property(x => x.DgeRecherche).Metadata, e.Property(x => x.DgePleinTexte).Metadata,
                         e.Property(x => x.DgeNbConsultations).Metadata, e.Property(x => x.DgeConsulteLe).Metadata,
                         e.Property(x => x.DgeNbVersions).Metadata, e.Property(x => x.DgeVersionCourante).Metadata })
            {
                p.SetBeforeSaveBehavior(PropertySaveBehavior.Ignore);
                p.SetAfterSaveBehavior(PropertySaveBehavior.Ignore);
            }
        });
        b.Entity<DocumentArchiveGed>(e =>
        {
            e.ToTable("document_ged_archive").HasKey(x => x.DgeId);
            e.Property(x => x.DgeMail).HasColumnType("jsonb");
        });
        b.Entity<ConsultationGed>().ToTable("consultation_ged").HasKey(x => x.CogId);
        b.Entity<StatistiqueGed>().ToTable("statistique_ged").HasKey(x => new { x.SgeTypeElement, x.SgeIdElement });
        b.HasDbFunction(typeof(GedDbContext).GetMethod(nameof(Normaliser))!).HasName("f_ged_normaliser");
        b.Entity<VersionGed>().ToTable("version_ged").HasKey(x => x.VgeId);
        b.Entity<VersionArchiveGed>().ToTable("version_ged_archive").HasKey(x => x.VgeId);
        b.Entity<EntreeCoffreGed>().ToTable("coffre_ged").HasKey(x => x.CofId);
        b.Entity<ParametreGed>(e => { e.ToTable("parametre_ged").HasKey(x => x.PgeCle); e.Property(x => x.PgeValeur).HasColumnType("jsonb"); });
        b.Entity<RepertoireGed>().ToTable("repertoire_ged").HasKey(x => x.RgeId);
        b.Entity<DerivationGed>().ToTable("derivation_ged").HasKey(x => x.DrgId);
        b.Entity<RetentionGed>().ToTable("regle_retention_ged").HasKey(x => x.RrgId);
        b.Entity<ClassementGed>().ToTable("regle_classification_ged").HasKey(x => x.RcgId);
    }
}

// ------------------------------------------------------------------ contrats HTTP (snake_case, comme FournisseurGedApi)

public sealed class ParametresGedDto
{
    public int EditionsConservees { get; set; } = 5;
    public long TailleApercuMax { get; set; } = 15 * 1024 * 1024;
    public string AdresseCopieCachee { get; set; } = "";
    public JsonElement Categories { get; set; }
    /// <summary>Règles de classification (proposition de catégorie dans le dialogue de dépôt).</summary>
    public List<RegleClassificationDto> ReglesClassification { get; set; } = [];
}

public sealed class FiltreGed
{
    public string? TypeElement { get; set; }
    public string? IdElement { get; set; }
    public string? Recherche { get; set; }
    public bool Supprimes { get; set; }
    public bool Coffre { get; set; }
    /// <summary>Documents archivés (déplacés dans l'archive, ou du coffre-fort archivés sur place) au lieu des actifs.</summary>
    public bool Archives { get; set; }
    /// <summary>Documents sans élément lié (racine de la GED globale).</summary>
    public bool SansElement { get; set; }
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
    /// <summary>Répertoire de dépôt : le document est lié à l'élément du répertoire.</summary>
    public long? RepertoireId { get; set; }
    public string? Confidentialite { get; set; }
    public string[]? AccesProfils { get; set; }
    public string[]? AccesUtilisateurs { get; set; }
    public string[]? MotsCles { get; set; }
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

public sealed class DemandeRepertoire
{
    public string? Nom { get; set; }
    public long? ParentId { get; set; }
    public string? TypeElement { get; set; }
    public string? IdElement { get; set; }
}

public sealed class DemandeDerivation
{
    public long CibleId { get; set; }
    public string Type { get; set; } = "";
    public string? Langue { get; set; }
    public string? Commentaire { get; set; }
}

public sealed class DemandeArchivage
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
    public bool AEnvoyer { get; set; }
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
    public int NbConsultations { get; set; }
    public DateTimeOffset? ConsulteLe { get; set; }
    public long? RepertoireId { get; set; }
    public string Confidentialite { get; set; } = AccesGed.Interne;
    public string[] AccesProfils { get; set; } = [];
    public string[] AccesUtilisateurs { get; set; } = [];
    public string[] MotsCles { get; set; } = [];
    public string Langue { get; set; } = "fr";
    public string IndexEtat { get; set; } = ExtractionTexte.AFaire;
    public int NbVersions { get; set; }
    /// <summary>Archivé : déplacé dans l'archive, ou archivé sur place au coffre-fort.</summary>
    public bool Archive { get; set; }
    public DateTimeOffset? ArchiveLe { get; set; }
}

/// <summary>Statistiques d'utilisation d'un élément lié (ou de toute la GED).</summary>
public sealed record StatistiquesGedDto(int NbDocuments, int NbSupprimes, int NbCoffre, int NbVersions, long Taille, long NbConsultations,
    DateTimeOffset? DerniereActivite);

public sealed class DocumentDetailDto : DocumentDto
{
    public List<VersionDto> Versions { get; set; } = [];
    public List<DocumentDto> Pieces { get; set; } = [];
    public DocumentDto? Parent { get; set; }
    public List<EntreeCoffreDto> JournalCoffre { get; set; } = [];
    public List<DerivationDto> Derivations { get; set; } = [];
    public JsonElement? Classification { get; set; }
    /// <summary>Début du texte extrait (aperçu de l'indexation).</summary>
    public string? ExtraitTexte { get; set; }
    public EcheancesDto? Retention { get; set; }
}

public sealed record VerificationDto(bool Integre, string EmpreinteAttendue, string? EmpreinteCalculee, string? Horodatage, ResultatChaine? Coffre);

/// <summary>Dérivation vue depuis un document : sens « source » (l'autre document est la source) ou « cible ».</summary>
public sealed record DerivationDto(long Id, string Type, string? Langue, string? Commentaire, string Sens, DocumentDto Document, DateTimeOffset CreeLe, string CreePar);

public sealed record EcheancesDto(int? Regle, string? Libelle, string Base, string? ArchiverLe, string? FinLe, string? ActionFin, string Statut);

public sealed record EcheanceDocumentDto(DocumentDto Document, EcheancesDto Echeances);

public sealed record RepertoireDto(long Id, string Nom, long? ParentId, string? TypeElement, string? IdElement, int NbDocuments);

public sealed record ResultatRetentionDto(int Documents, int Archives, List<long> Ids);

public sealed record ResultatIndexationDto(int Indexes, int Restants);

public sealed record RegleRetentionDto(int Id, string Libelle, string? Categorie, string? TypeElement, int? DureeActiveMois, int? DureeConservationMois,
    string ActionFin, int Priorite, bool Actif);

public sealed record RegleClassificationDto(int Id, string Libelle, int Priorite, bool Actif, string[] Extensions, string[] TypesMime, string[] Mots,
    string? Expediteur, string? TypeElement, string? Categorie, string? Confidentialite, string[] MotsCles);

public sealed record ReglesGedDto(List<RegleRetentionDto> Retention, List<RegleClassificationDto> Classification);
