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

public class TypeComptableEntite
{
    public string TcoCode { get; set; } = "";
    public string TcoLibelle { get; set; } = "";
    public string? TcoParent { get; set; }
    public string TcoSens { get; set; } = "VENTE";
    public string? TcoJournal { get; set; }
    public string? TcoJournalLibelle { get; set; }
    public string? TcoCptDefaut { get; set; }
    public string? TcoCptRemise { get; set; }
    public string? TcoCptRetenue { get; set; }
    public bool TcoRetenueCompteTiers { get; set; }
    public string? TcoCptAcompte { get; set; }
    public string? TcoCptPaiementDirect { get; set; }
    public string? TcoCptProrata { get; set; }
    public string? TcoCptEcartDebit { get; set; }
    public string? TcoCptEcartCredit { get; set; }
    public int TcoOrdre { get; set; }
    public bool TcoActif { get; set; } = true;
}

public class VentilationEntite
{
    public int VcoId { get; set; }
    public string VcoTcoCode { get; set; } = "";
    /// <summary>Nature (identifiant fourni par l'application) ; null : toutes natures.</summary>
    public int? VcoNatId { get; set; }
    /// <summary>Taux de TVA (identifiant fourni par l'application) ; null : tous taux.</summary>
    public int? VcoTtvId { get; set; }
    public string VcoCptCode { get; set; } = "";
}

public class ComptabiliteDbContext(DbContextOptions<ComptabiliteDbContext> options) : DbContext(options)
{
    public DbSet<CompteEntite> Comptes => Set<CompteEntite>();
    public DbSet<ParametreEntite> Parametres => Set<ParametreEntite>();
    public DbSet<CollectifEntite> Collectifs => Set<CollectifEntite>();
    public DbSet<CategorieTvaEntite> CategoriesTva => Set<CategorieTvaEntite>();
    public DbSet<TypeComptableEntite> TypesComptables => Set<TypeComptableEntite>();
    public DbSet<VentilationEntite> Ventilations => Set<VentilationEntite>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<CompteEntite>().ToTable("compte_comptable").HasKey(x => x.CptCode);
        b.Entity<ParametreEntite>().ToTable("parametre_comptabilite").HasKey(x => x.PcpCle);
        b.Entity<ParametreEntite>().Property(x => x.PcpValeur).HasColumnType("jsonb");
        b.Entity<CollectifEntite>().ToTable("collectif_tiers").HasKey(x => x.ColCode);
        b.Entity<CategorieTvaEntite>().ToTable("categorie_tva").HasKey(x => x.CtvCode);
        b.Entity<TypeComptableEntite>().ToTable("type_comptable").HasKey(x => x.TcoCode);
        b.Entity<VentilationEntite>().ToTable("ventilation_compte").HasKey(x => x.VcoId);
        b.Entity<ExportEntite>().ToTable("comptabilite_export").HasKey(x => x.CexId);
        b.Entity<ExportEntite>().Property(x => x.CexModele).HasColumnType("jsonb");
        b.Entity<ExportPieceEntite>().ToTable("comptabilite_export_piece").HasKey(x => new { x.CepCexId, x.CepPieceId });
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
    string? CompteCollectee, string? CompteCollecteeEncaissement, string? CompteDeductible, string? CompteAutoliquidee, int Ordre, bool Defaut);

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

/// <summary>
/// Type comptable (VENTE, ACHAT, SOUS_TRAITANCE…) : parent dont il hérite la ventilation, sens des comptes proposés,
/// journal, compte par défaut et comptes des postes particuliers (retenue de garantie : compte distinct, ou compte du
/// tiers si RetenueCompteTiers, C12).
/// </summary>
public sealed record TypeComptableDto(string Code, string Libelle, string? Parent, string Sens, string? Journal, string? JournalLibelle,
    string? CompteDefaut, string? CompteRemise, string? CompteRetenue, bool RetenueCompteTiers, string? CompteAcompte, string? ComptePaiementDirect,
    string? CompteProrata, string? CompteEcartDebit, string? CompteEcartCredit, int Ordre, bool Actif);

/// <summary>Clé de ventilation : type comptable × nature et / ou taux de TVA (codes) → compte.</summary>
public sealed record CleVentilationDto(string Type, string? Nature, string? Taux, string Compte);

/// <summary>Nature de l'application (code, libellé) pour le tableau de ventilation.</summary>
public sealed record NatureVentilation(int Id, string Code, string Libelle, bool Actif);

/// <summary>Type de document et son type comptable : surcharge (TypeComptable) et effectif (celui de sa famille sinon).</summary>
public sealed record TypeDocumentComptable(string Code, string Libelle, string Famille, string? TypeComptable, string? TypeEffectif, bool PieceComptable);

public sealed record TypeDocumentSaisi(string Code, string? TypeComptable);

/// <summary>Paramétrage de la règle de ventilation pour la saisie : types, clés et type comptable de chaque type de document.</summary>
public sealed record RegleVentilation(List<TypeVentilationDto> Types, List<CleVentilationDto> Cles, Dictionary<string, string?> TypesDocuments);

public sealed record TypeVentilationDto(string Code, string? Parent, string? CompteDefaut);

