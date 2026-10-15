using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace LogiBTP.Documents.Web;

/// <summary>
/// Contexte EF Core des tables du module Document (modules/document/db). Classe mère : le cœur le
/// spécialise avec ses types d'entête et de ligne (DocumentBtp, DocumentLigneBtp) et ajoute ses tables.
/// Le schéma est géré par les scripts SQL (pas de migrations EF) ; snake_case par UseSnakeCaseNamingConvention().
/// </summary>
public abstract class DocumentDbContext<TDoc, TLigne>(DbContextOptions options) : DbContext(options)
    where TDoc : Document, new()
    where TLigne : DocumentLigne, new()
{
    public DbSet<TypeDocument> TypesDocument => Set<TypeDocument>();
    public DbSet<ProprieteDefinition> ProprietesDefinition => Set<ProprieteDefinition>();
    public DbSet<StatutDocument> StatutsDocument => Set<StatutDocument>();
    public DbSet<TypeLigne> TypesLigne => Set<TypeLigne>();
    public DbSet<TauxTva> TauxTva => Set<TauxTva>();
    public DbSet<Unite> Unites => Set<Unite>();
    public DbSet<TransformationAutorisee> TransformationsAutorisees => Set<TransformationAutorisee>();
    public DbSet<DroitDocument> DroitsDocument => Set<DroitDocument>();
    public DbSet<CompteurNumero> CompteursNumero => Set<CompteurNumero>();
    public DbSet<TDoc> Documents => Set<TDoc>();
    public DbSet<TLigne> Lignes => Set<TLigne>();
    public DbSet<DocumentTva> DocumentsTva => Set<DocumentTva>();
    public DbSet<DocumentLien> DocumentsLien => Set<DocumentLien>();
    public DbSet<DocumentLigneLien> LignesLien => Set<DocumentLigneLien>();
    public DbSet<DocumentLigneSolde> LignesSolde => Set<DocumentLigneSolde>();
    public DbSet<DocumentHistorique> Historiques => Set<DocumentHistorique>();
    public DbSet<DocumentOrigine> Origines => Set<DocumentOrigine>();
    public DbSet<CalculCasTest> CasTest => Set<CalculCasTest>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<TypeDocument>().ToTable("type_document").HasKey(x => x.TydId);
        b.Entity<ProprieteDefinition>().ToTable("propriete_definition").HasKey(x => x.PrdId);
        b.Entity<StatutDocument>().ToTable("statut_document").HasKey(x => x.StdId);
        b.Entity<TypeLigne>().ToTable("type_ligne").HasKey(x => x.TylId);
        b.Entity<TypeLigne>().Property(x => x.TylId).ValueGeneratedNever();
        b.Entity<TauxTva>().ToTable("taux_tva").HasKey(x => x.TtvId);
        b.Entity<Unite>().ToTable("unite").HasKey(x => x.UntCode);
        b.Entity<TransformationAutorisee>().ToTable("transformation_autorisee").HasKey(x => new { x.TraSourceTydId, x.TraCibleTydId });
        b.Entity<DroitDocument>().ToTable("droit_document").HasKey(x => new { x.DrtProfil, x.DrtTydId, x.DrtAction });
        b.Entity<CompteurNumero>().ToTable("compteur_numero").HasKey(x => new { x.CnuTydId, x.CnuExercice });

        b.Entity<TDoc>(e =>
        {
            e.ToTable("document").HasKey(x => x.EntId);
            e.Property(x => x.EntVersion).IsConcurrencyToken();
        });

        b.Entity<TLigne>(e =>
        {
            e.ToTable("document_ligne").HasKey(x => x.LigId);
            // lig_chemin est dérivé par trigger à partir de lig_parent_id : jamais écrit par l'application.
            var chemin = e.Property(x => x.LigChemin).HasColumnType("ltree").ValueGeneratedOnAddOrUpdate();
            chemin.Metadata.SetBeforeSaveBehavior(PropertySaveBehavior.Ignore);
            chemin.Metadata.SetAfterSaveBehavior(PropertySaveBehavior.Ignore);
        });

        b.Entity<DocumentTva>().ToTable("document_tva").HasKey(x => new { x.TvaEntId, x.TvaCode });
        b.Entity<DocumentLien>().ToTable("document_lien").HasKey(x => new { x.LieSourceEntId, x.LieCibleEntId });
        b.Entity<DocumentLigneLien>().ToTable("document_ligne_lien").HasKey(x => x.LilId);
        b.Entity<DocumentLigneSolde>().ToTable("document_ligne_solde").HasKey(x => x.LsoId);
        b.Entity<DocumentHistorique>().ToTable("document_historique").HasKey(x => x.HisId);
        b.Entity<DocumentOrigine>(e => { e.ToTable("document_origine").HasKey(x => x.DorEntId); e.Property(x => x.DorEntId).ValueGeneratedNever(); });
        b.Entity<CalculCasTest>().ToTable("calcul_cas_test").HasKey(x => x.CasId);
        // Affichage de la saisie (013_document_affichage.sql).
        b.Entity<EtiquetteLigne>().ToTable("etiquette_ligne").HasKey(x => x.EtlCode);
        b.Entity<CouleurTypePrix>().ToTable("couleur_type_prix").HasKey(x => x.CtpType);
        b.Entity<ModeleDocument>().ToTable("modele_document").HasKey(x => x.ModCode);
        b.Entity<VueDocument>(e => { e.ToTable("vue_document").HasKey(x => x.VdoId); e.Property(x => x.VdoDefinition).HasColumnType("jsonb"); });
        ConfigurerComplements(b);
    }

    /// <summary>Tables ajoutées par une spécialisation (métrés, variables…).</summary>
    protected virtual void ConfigurerComplements(ModelBuilder b) { }
}
