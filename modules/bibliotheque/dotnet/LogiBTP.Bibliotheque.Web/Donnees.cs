using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Bibliotheque.Web;

public class Bibliotheque
{
    public int BibId { get; set; }
    public string BibCode { get; set; } = "";
    public string BibLibelle { get; set; } = "";
    public bool BibDefaut { get; set; }
    public bool BibActif { get; set; } = true;
    public int BibOrdre { get; set; }
}

public class FamilleElement
{
    public int FamId { get; set; }
    public int FamBibId { get; set; }
    public int? FamParentId { get; set; }
    public string FamCode { get; set; } = "";
    public string FamLibelle { get; set; } = "";
    public int FamOrdre { get; set; }
}

/// <summary>Vue v_famille_element : chemin complet et niveau.</summary>
public class FamilleChemin
{
    public int FamId { get; set; }
    public int FamBibId { get; set; }
    public int? FamParentId { get; set; }
    public string FamCode { get; set; } = "";
    public string FamLibelle { get; set; } = "";
    public int FamOrdre { get; set; }
    public string Chemin { get; set; } = "";
    public int Niveau { get; set; }
}

public class RegroupementNature
{
    public string RgnCode { get; set; } = "";
    public string RgnLibelle { get; set; } = "";
    public int RgnOrdre { get; set; }
}

public class NatureElement
{
    public int NatId { get; set; }
    public string NatCode { get; set; } = "";
    public string NatLibelle { get; set; } = "";
    public string? NatRgnCode { get; set; }
    public string? NatAxeAnalytique { get; set; }
    public bool NatIsolant { get; set; }
    public JsonDocument NatTypes { get; set; } = JsonDocument.Parse("[]");
    public bool NatActif { get; set; } = true;
}

/// <summary>Élément (colonnes utiles au recalcul et à la recherche ; la fiche passe par le module Fiche).</summary>
public class Element
{
    public long EleId { get; set; }
    public int EleBibId { get; set; }
    public string EleCode { get; set; } = "";
    public string EleType { get; set; } = "ARTICLE";
    public string EleLibelleHtml { get; set; } = "";
    public string? EleLibelle { get; set; }
    public int? EleFamId { get; set; }
    public int? EleNatId { get; set; }
    public string EleUntStock { get; set; } = "";
    public string? EleUntAchat { get; set; }
    public string? EleUntVente { get; set; }
    public JsonDocument EleUnites { get; set; } = JsonDocument.Parse("[]");
    public string EleScenarioPa { get; set; } = "FIXE";
    public decimal? ElePaFixe { get; set; }
    public decimal? EleDernierPa { get; set; }
    public decimal? ElePmp { get; set; }
    public decimal? ElePa { get; set; }
    public decimal EleCoefFg { get; set; } = 1;
    public bool EleCoefFgImpose { get; set; }
    public bool EleCoefBenefImpose { get; set; }
    public decimal? ElePr { get; set; }
    public decimal EleCoefBenef { get; set; } = 1;
    public decimal? ElePv { get; set; }
    public bool ElePvFixe { get; set; }
    public decimal EleCoefRemise { get; set; } = 1;
    public decimal? ElePvNet { get; set; }
    public JsonDocument? EleComposition { get; set; }
    public JsonDocument EleProprietes { get; set; } = JsonDocument.Parse("{}");
    // Données techniques (par unité de stock ; dimensions en mm), utilisables dans les formules d'unités.
    public decimal? ElePoids { get; set; }
    public decimal? EleSurface { get; set; }
    public decimal? EleSurfacePeinture { get; set; }
    public decimal? EleVolume { get; set; }
    public decimal? EleHauteur { get; set; }
    public decimal? EleLargeur { get; set; }
    public decimal? EleEpaisseur { get; set; }
    /// <summary>Longueur en mm (barre, rouleau…).</summary>
    public decimal? EleLongueur { get; set; }
    public decimal? EleIsolantR { get; set; }
    public decimal? EleIsolantLambda { get; set; }
    public decimal? EleIsolantU { get; set; }
    // Poste de pied (type POSTE_PIED) : niveau HT / TTC, mode P / M / C, base, sens DEDUCTION / AJOUT, valeur, retenue,
    // compte comptable et code du taux de TVA (063).
    public string? ElePiedNiveau { get; set; }
    public string? ElePiedMode { get; set; }
    public string? ElePiedBase { get; set; }
    public string? ElePiedSens { get; set; }
    public decimal? ElePiedValeur { get; set; }
    public bool ElePiedRetenue { get; set; }
    public string? ElePiedGenre { get; set; }
    public string? EleCptCode { get; set; }
    public string? EleTvaCode { get; set; }
    // Compléments (064) : mots-clés de recherche, code-barres, description technique, délai de livraison (jours).
    public string? EleMotsCles { get; set; }
    public string? EleCodeBarre { get; set; }
    public string? EleDescriptionHtml { get; set; }
    public int? EleDelaiLivraison { get; set; }
    public bool EleActif { get; set; } = true;
    public string? EleCommentairePrix { get; set; }
    public string? EleMajPar { get; set; }
}

public class TarifFournisseur
{
    public long TfoId { get; set; }
    public long TfoEleId { get; set; }
    public string TfoFournisseur { get; set; } = "";
    public long? TfoTiersId { get; set; }
    public string? TfoReference { get; set; }
    public string? TfoLibelle { get; set; }
    public string TfoUntCode { get; set; } = "";
    public decimal TfoPrix { get; set; }
    public DateOnly? TfoDebut { get; set; }
    public DateOnly? TfoFin { get; set; }
    public bool TfoPrincipal { get; set; }
    public string? TfoLien { get; set; }
    // Lot 8 (065) : prix public et remises (%), délai (jours), code-barres du fournisseur.
    public decimal? TfoPrixPublic { get; set; }
    public decimal? TfoRemise1 { get; set; }
    public decimal? TfoRemise2 { get; set; }
    public int? TfoDelai { get; set; }
    public string? TfoCodeBarre { get; set; }
    public DateTimeOffset TfoMajLe { get; set; }
    public string? TfoMajPar { get; set; }
}

public class TarifImport
{
    public long TimId { get; set; }
    public long? TimTiersId { get; set; }
    public string TimFournisseur { get; set; } = "";
    public string? TimFichier { get; set; }
    public int TimCrees { get; set; }
    public int TimMaj { get; set; }
    public int TimErreurs { get; set; }
    public string? TimPar { get; set; }
    public DateTimeOffset TimLe { get; set; }
}

public class HistoriquePrix
{
    public long HpeId { get; set; }
    public long HpeEleId { get; set; }
    public DateTimeOffset HpeDate { get; set; }
    public string? HpeAuteur { get; set; }
    public string? HpeCommentaire { get; set; }
    public JsonDocument? HpeAvant { get; set; }
    public JsonDocument HpeApres { get; set; } = JsonDocument.Parse("{}");
}

public class CoefficientPeriode
{
    public int CopId { get; set; }
    public int? CopNatId { get; set; }
    public DateOnly CopDebut { get; set; }
    public decimal? CopCoefFg { get; set; }
    public decimal? CopCoefBenef { get; set; }
    public string? CopCommentaire { get; set; }
    public DateTimeOffset CopCreeLe { get; set; }
    public string? CopCreePar { get; set; }
}

public class ParametreBibliotheque
{
    public string PbiCle { get; set; } = "";
    public JsonDocument PbiValeur { get; set; } = JsonDocument.Parse("null");
}

/// <summary>Contexte EF Core du module Bibliothèque (modules/bibliotheque/db) ; les options sont fournies par l'application.</summary>
public class BibliothequeDbContext(DbContextOptions<BibliothequeDbContext> options) : DbContext(options)
{
    public DbSet<Bibliotheque> Bibliotheques => Set<Bibliotheque>();
    public DbSet<FamilleElement> Familles => Set<FamilleElement>();
    public DbSet<FamilleChemin> FamillesChemins => Set<FamilleChemin>();
    public DbSet<RegroupementNature> Regroupements => Set<RegroupementNature>();
    public DbSet<NatureElement> Natures => Set<NatureElement>();
    public DbSet<Element> Elements => Set<Element>();
    public DbSet<TarifFournisseur> Tarifs => Set<TarifFournisseur>();
    public DbSet<TarifImport> ImportsTarifs => Set<TarifImport>();
    public DbSet<HistoriquePrix> Historique => Set<HistoriquePrix>();
    public DbSet<ParametreBibliotheque> Parametres => Set<ParametreBibliotheque>();
    public DbSet<CoefficientPeriode> Periodes => Set<CoefficientPeriode>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Bibliotheque>().ToTable("bibliotheque").HasKey(x => x.BibId);
        b.Entity<FamilleElement>().ToTable("famille_element").HasKey(x => x.FamId);
        b.Entity<FamilleChemin>(e => { e.ToView("v_famille_element").HasKey(x => x.FamId); e.Property(x => x.Chemin).HasColumnName("chemin"); e.Property(x => x.Niveau).HasColumnName("niveau"); });
        b.Entity<RegroupementNature>().ToTable("regroupement_nature").HasKey(x => x.RgnCode);
        b.Entity<NatureElement>(e => { e.ToTable("nature_element").HasKey(x => x.NatId); e.Property(x => x.NatTypes).HasColumnType("jsonb"); });
        b.Entity<CoefficientPeriode>().ToTable("coefficient_periode").HasKey(x => x.CopId);
        b.Entity<Element>(e =>
        {
            e.ToTable("element").HasKey(x => x.EleId);
            e.Property(x => x.EleUnites).HasColumnType("jsonb");
            e.Property(x => x.EleProprietes).HasColumnType("jsonb");
            e.Property(x => x.EleComposition).HasColumnType("jsonb");
        });
        b.Entity<TarifFournisseur>().ToTable("tarif_fournisseur").HasKey(x => x.TfoId);
        b.Entity<TarifImport>().ToTable("tarif_import").HasKey(x => x.TimId);
        b.Entity<HistoriquePrix>(e => { e.ToTable("historique_prix_element").HasKey(x => x.HpeId); e.Property(x => x.HpeAvant).HasColumnType("jsonb"); e.Property(x => x.HpeApres).HasColumnType("jsonb"); });
        b.Entity<ParametreBibliotheque>(e => { e.ToTable("parametre_bibliotheque").HasKey(x => x.PbiCle); e.Property(x => x.PbiValeur).HasColumnType("jsonb"); });
    }
}

// ------------------------------------------------------------------ contrats HTTP (snake_case)

public sealed class ParametresBibliothequeDto
{
    public string ScenarioDefaut { get; set; } = "FIXE";
    public List<string> ScenariosAutorises { get; set; } = [.. CalculElement.Scenarios];
    public decimal CoefFgDefaut { get; set; } = 1;
    public decimal CoefBenefDefaut { get; set; } = 1;
}

public sealed record BibliothequeDto(int Id, string Code, string Libelle, bool Defaut, bool Actif, int Ordre);
public sealed record FamilleDto(int Id, int BibId, int? ParentId, string Code, string Libelle, int Ordre, string Chemin, int Niveau);
public sealed record RegroupementDto(string Code, string Libelle, int Ordre);
public sealed record NatureDto(int Id, string Code, string Libelle, string? Regroupement, string? AxeAnalytique, bool Actif,
    bool Isolant = false, List<string>? Types = null);

/// <summary>Période de coefficients : NatId null = globale ; un coefficient null est repris de la portée supérieure.</summary>
public sealed record PeriodeDto(int Id, int? NatId, string Debut, decimal? CoefFg, decimal? CoefBenef, string? Commentaire, DateTimeOffset CreeLe, string? CreePar);

public sealed record PeriodeEnregistree(List<PeriodeDto> Periodes, int ElementsRecalcules);

public sealed record TarifDto(long Id, string Fournisseur, long? TiersId, string? Reference, string? Libelle, string Unite, decimal Prix,
    string? Debut, string? Fin, bool Principal, string? Lien, DateTimeOffset MajLe, string? MajPar,
    decimal? PrixPublic = null, decimal? Remise1 = null, decimal? Remise2 = null, int? Delai = null, string? CodeBarre = null);

/// <summary>Tarif d'un fournisseur de l'annuaire, avec l'élément (onglet Tarifs de la fiche du fournisseur).</summary>
public sealed record TarifTiersDto(long Id, long EleId, string BibCode, string Code, string? Element, string? UniteStock, string Fournisseur, string? Reference,
    string? Libelle, string Unite, decimal Prix, string? Debut, string? Fin, bool Principal, string? Lien,
    decimal? PrixPublic = null, decimal? Remise1 = null, decimal? Remise2 = null, int? Delai = null, string? CodeBarre = null);

/// <summary>Ligne d'un import de tarifs (format fixe, lot 8 : A12).</summary>
public sealed record LigneImportTarif(string? Element, string? Reference, string? CodeBarre, string? Libelle, string? Unite, decimal? PrixPublic,
    decimal? Remise1, decimal? Remise2, decimal? Prix, int? Delai, string? Debut, string? Fin, bool Principal = false);

/// <summary>Import de tarifs d'un fournisseur : lignes, nom du fichier, simulation (contrôle sans écriture).</summary>
public sealed record DemandeImportTarifs(long TiersId, string Fournisseur, string? Fichier, List<LigneImportTarif> Lignes, bool Simulation = true);

/// <summary>Résultat d'une ligne importée : rang (1 = première ligne de données), élément trouvé, action (CREE, MAJ, ERREUR), message.</summary>
public sealed record ResultatLigneImport(int Rang, long? EleId, string? Code, string Action, string? Message);

public sealed record ResultatImportTarifs(int Crees, int MisesAJour, int Erreurs, List<ResultatLigneImport> Lignes);

public sealed record PrixElementDto(decimal? Pa, decimal? Pr, decimal? Pv, decimal CoefBenef, decimal? PvNet, List<string> Alertes);

public sealed record TarifsElementDto(List<TarifDto> Tarifs, PrixElementDto Prix);

public sealed record HistoriqueDto(long Id, DateTimeOffset Date, string? Auteur, string? Commentaire, JsonElement? Avant, JsonElement Apres);

/// <summary>Élément complet pour son appel dans un document (déploiement d'un article ou d'un ouvrage).</summary>
public sealed record ElementDetailDto(long Id, int BibId, string BibCode, string Code, string Type, string LibelleHtml, string? Libelle, int? FamId, int? NatId,
    string UniteStock, string? UniteAchat, string? UniteVente, JsonElement Unites, Dictionary<string, decimal?> Donnees,
    decimal? Pa, decimal CoefFg, decimal? Pr, decimal CoefBenef, decimal? Pv, bool PvFixe, decimal CoefRemise, decimal? PvNet, JsonElement? Composition, bool Actif,
    PosteElementDto? Poste = null, string? CodeBarre = null, int? DelaiLivraison = null);

/// <summary>Poste de pied d'un élément POSTE_PIED (inséré dans le pied des documents).</summary>
public sealed record PosteElementDto(string? Niveau, string? Mode, string? Base, string? Sens, decimal? Valeur, bool Retenue, string? Compte, string? Tva,
    string? Genre = null);

public sealed record ElementRechercheDto(long Id, string BibCode, string Code, string Type, string? Libelle, string LibelleHtml, string UniteStock,
    decimal? Pa, decimal? Pr, decimal? Pv, decimal? PvNet, decimal CoefFg, decimal CoefBenef);
