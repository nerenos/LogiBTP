using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Comptabilite.Web;

public class CompteEntite
{
    public string CptCode { get; set; } = "";
    public string CptLibelle { get; set; } = "";
    public bool CptActif { get; set; } = true;
    public string CptType { get; set; } = "GENERAL";
    public string CptSens { get; set; } = "AUCUN";
    public string? CptLibelleCourt { get; set; }
    public bool CptLettrable { get; set; }
    public string? CptMajPar { get; set; }
    public DateTimeOffset CptMajLe { get; set; } = DateTimeOffset.UtcNow;
}

public class ParametreEntite
{
    public string PcpCle { get; set; } = "";
    public string PcpValeur { get; set; } = "null";
    public string? PcpMajPar { get; set; }
    public DateTimeOffset PcpMajLe { get; set; } = DateTimeOffset.UtcNow;
}

public class CollectifEntite
{
    public string ColCode { get; set; } = "";
    public string ColLibelle { get; set; } = "";
    public string? ColCptCode { get; set; }
    public int ColOrdre { get; set; }
}

public class CategorieTvaEntite
{
    public string CtvCode { get; set; } = "";
    public string CtvLibelle { get; set; } = "";
    public string CtvComportement { get; set; } = "N";
    public string? CtvMention { get; set; }
    public string? CtvExigibilite { get; set; }
    public int CtvOrdre { get; set; }
    public bool CtvActif { get; set; } = true;
}

public class ComptabiliteDbContext(DbContextOptions<ComptabiliteDbContext> options) : DbContext(options)
{
    public DbSet<CompteEntite> Comptes => Set<CompteEntite>();
    public DbSet<ParametreEntite> Parametres => Set<ParametreEntite>();
    public DbSet<CollectifEntite> Collectifs => Set<CollectifEntite>();
    public DbSet<CategorieTvaEntite> CategoriesTva => Set<CategorieTvaEntite>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<CompteEntite>().ToTable("compte_comptable").HasKey(x => x.CptCode);
        b.Entity<ParametreEntite>().ToTable("parametre_comptabilite").HasKey(x => x.PcpCle);
        b.Entity<ParametreEntite>().Property(x => x.PcpValeur).HasColumnType("jsonb");
        b.Entity<CollectifEntite>().ToTable("collectif_tiers").HasKey(x => x.ColCode);
        b.Entity<CategorieTvaEntite>().ToTable("categorie_tva").HasKey(x => x.CtvCode);
    }
}

/// <summary>Paramètres de la comptabilité. Préfixes des comptes de tiers par type de compte (CLIENT, FOURNISSEUR…).</summary>
public sealed record ParametresComptabilite(int? LongueurComptesGeneraux, int? LongueurComptesTiers, bool CompleterZeros,
    Dictionary<string, string> PrefixesTiers, bool TvaSurDebits);

/// <summary>Compte du plan comptable ; Classe et Conforme (à la longueur paramétrée) sont calculés à la lecture.</summary>
public sealed record CompteDto(string Code, string Libelle, string Type, string Sens, string? LibelleCourt, bool Lettrable, bool Actif,
    int? Classe = null, bool Conforme = true);

public sealed record CollectifDto(string Code, string Libelle, string? Compte, int Ordre);

public sealed record CategorieTvaDto(string Code, string Libelle, string Comportement, string? Mention, string? Exigibilite, int Ordre, bool Actif);

/// <summary>
/// Taux de TVA vu par le module (table de l'application) : catégorie, comportement du calcul, mention, comptes de TVA
/// collectée (débits), collectée à encaisser, déductible et autoliquidée (due par le preneur).
/// </summary>
public sealed record TauxTvaDto(int Id, string Code, string Libelle, decimal Taux, string? Categorie, string Comportement, string? Mention, bool Actif,
    string? CompteCollectee, string? CompteCollecteeEncaissement, string? CompteDeductible, string? CompteAutoliquidee);

/// <summary>
/// Tiers vu par le module, une ligne par type de compte (CLIENT, FOURNISSEUR, SOUS_TRAITANT…) : compte auxiliaire
/// effectif (Compte) et propre (CompteSaisi : null = hérité, ex. un sous-traitant sans compte propre prend son compte
/// fournisseur), collectif par défaut du type (CollectifType) et surcharge de la fiche (CollectifSaisi).
/// </summary>
public sealed record TiersComptable(long TiersId, string TypeCompte, string? CodeTiers, string RaisonSociale, bool Particulier, bool Actif,
    string? Compte, string? CompteSaisi, string CollectifType, string? CollectifSaisi, string? Siret, string? TvaIntra);

/// <summary>Compte auxiliaire et collectif saisis d'un tiers pour un type de compte (null = hérité ou par défaut).</summary>
public sealed record CompteTiersSaisi(long TiersId, string TypeCompte, string? Compte, string? Collectif);

/// <summary>Tiers lus pour la liste par compte : collectif effectif (compte), doublons signalés.</summary>
public sealed record TiersCompteDto(long TiersId, string TypeCompte, string? CodeTiers, string RaisonSociale, bool Particulier, bool Actif,
    string? Compte, bool CompteHerite, string Collectif, string? CollectifCompte, bool CollectifSurcharge, string? Siret, string? TvaIntra, bool Doublon);

public sealed record ResultatGeneration(int Crees, List<string> Refus);
