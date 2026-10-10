using LogiBTP.Domaine;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace LogiBTP.Api.Donnees;

/// <summary>
/// Contexte EF Core. Le schéma est géré par les scripts db/*.sql (pas de migrations EF) ;
/// le mapping PascalCase ↔ snake_case est assuré par UseSnakeCaseNamingConvention().
/// </summary>
public sealed class LogiBtpContext(DbContextOptions<LogiBtpContext> options) : DbContext(options)
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
    public DbSet<Document> Documents => Set<Document>();
    public DbSet<DocumentLigne> Lignes => Set<DocumentLigne>();
    public DbSet<DocumentTva> DocumentsTva => Set<DocumentTva>();
    public DbSet<DocumentLien> DocumentsLien => Set<DocumentLien>();
    public DbSet<DocumentLigneLien> LignesLien => Set<DocumentLigneLien>();
    public DbSet<DocumentLigneSolde> LignesSolde => Set<DocumentLigneSolde>();
    public DbSet<Metre> Metres => Set<Metre>();
    public DbSet<MetreLigne> MetreLignes => Set<MetreLigne>();
    public DbSet<VariableDefinition> Variables => Set<VariableDefinition>();
    public DbSet<DocumentHistorique> Historiques => Set<DocumentHistorique>();
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

        b.Entity<Document>(e =>
        {
            e.ToTable("document").HasKey(x => x.EntId);
            e.Property(x => x.EntVersion).IsConcurrencyToken();
        });

        b.Entity<DocumentLigne>(e =>
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
        b.Entity<Metre>().ToTable("metre").HasKey(x => x.MtrId);
        b.Entity<MetreLigne>().ToTable("metre_ligne").HasKey(x => x.MliId);
        b.Entity<VariableDefinition>().ToTable("variable_definition").HasKey(x => x.VarId);
        b.Entity<DocumentHistorique>().ToTable("document_historique").HasKey(x => x.HisId);
        b.Entity<CalculCasTest>().ToTable("calcul_cas_test").HasKey(x => x.CasId);
    }
}
