using System.Text.Json;
using LogiBTP.Annuaire;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Annuaire.Web;

public class NiveauPersonne
{
    public string NivCode { get; set; } = "";
    public string NivLibelle { get; set; } = "";
    public string? NivIcone { get; set; }
    public bool NivMorale { get; set; } = true;
    public int NivOrdre { get; set; }
    public bool NivActif { get; set; } = true;
}

public class Casquette
{
    public string CasCode { get; set; } = "";
    public string CasLibelle { get; set; } = "";
    public string? CasIcone { get; set; }
    public JsonDocument CasGroupes { get; set; } = JsonDocument.Parse("[]");
    public int CasOrdre { get; set; }
    public bool CasActif { get; set; } = true;
}

public class TypeLien
{
    public string TliCode { get; set; } = "";
    public string TliLibelle { get; set; } = "";
    public string TliLibelleInverse { get; set; } = "";
    public int TliOrdre { get; set; }
    public bool TliActif { get; set; } = true;
}

public class RoleIndividu
{
    public string RolCode { get; set; } = "";
    public string RolLibelle { get; set; } = "";
    public string? RolIcone { get; set; }
    public int RolOrdre { get; set; }
    public bool RolActif { get; set; } = true;
}

/// <summary>Personne (colonnes utiles à l'annuaire ; la fiche passe par le module Fiche).</summary>
public class Personne
{
    public long PerId { get; set; }
    public string? PerCode { get; set; }
    public string PerNivCode { get; set; } = "";
    public string PerRaisonSociale { get; set; } = "";
    public string? PerNomCommercial { get; set; }
    public long? PerParentId { get; set; }
    public JsonDocument PerCasquettes { get; set; } = JsonDocument.Parse("[]");
    public string PerPays { get; set; } = "FR";
    public string? PerSiren { get; set; }
    public string? PerSiret { get; set; }
    public bool PerSocieteBase { get; set; }
    public bool PerActif { get; set; } = true;
    public string PerDevise { get; set; } = "EUR";
    /// <summary>Tiers provisoire (db/071) : en attente de validation ou de fusion.</summary>
    public bool PerProvisoire { get; set; }
    public string? PerProvisoirePar { get; set; }
    public DateTimeOffset? PerProvisoireLe { get; set; }
    public string? PerValidePar { get; set; }
    public DateTimeOffset? PerValideLe { get; set; }
}

public class Individu
{
    public long IndId { get; set; }
    public string? IndCivilite { get; set; }
    public string IndNom { get; set; } = "";
    public string? IndPrenom { get; set; }
    public string IndPays { get; set; } = "FR";
    public JsonDocument IndRoles { get; set; } = JsonDocument.Parse("[]");
    public bool IndActif { get; set; } = true;
}

public class Rattachement
{
    public long RatId { get; set; }
    public long RatIndId { get; set; }
    public long RatPerId { get; set; }
    public string? RatFonction { get; set; }
    public string? RatService { get; set; }
    public bool RatPrincipal { get; set; }
    public bool RatTitulaire { get; set; }
    public DateOnly? RatDebut { get; set; }
    public DateOnly? RatFin { get; set; }
    public bool RatActif { get; set; } = true;
    public string? RatCommentaire { get; set; }
    public DateTimeOffset RatModifieLe { get; set; }
}

public class LienPersonne
{
    public long LpeId { get; set; }
    public long LpePerId { get; set; }
    public long LpeCibleId { get; set; }
    public string LpeTliCode { get; set; } = "";
    public string? LpeCommentaire { get; set; }
    public DateOnly? LpeDebut { get; set; }
    public DateOnly? LpeFin { get; set; }
}

public class Coordonnee
{
    public long CooId { get; set; }
    public string CooNature { get; set; } = "";
    public string? CooValeur { get; set; }
    public string? CooLigne1 { get; set; }
    public string? CooLigne2 { get; set; }
    public string? CooLigne3 { get; set; }
    public string? CooCodePostal { get; set; }
    public string? CooVille { get; set; }
    public string? CooPays { get; set; }
    public string? CooReseau { get; set; }
    public DateTimeOffset CooModifieLe { get; set; }
    public string? CooModifiePar { get; set; }
    public DateTimeOffset? CooNonRemisLe { get; set; }
    public string? CooNonRemisMotif { get; set; }

    /// <summary>Valeurs au format des saisies (comparaison avec l'origine, plan).</summary>
    public SaisieCoordonnee VersSaisie() => new()
    {
        Nature = CooNature, Valeur = CooValeur, Ligne1 = CooLigne1, Ligne2 = CooLigne2, Ligne3 = CooLigne3, CodePostal = CooCodePostal,
        Ville = CooVille, Pays = CooPays, Reseau = CooReseau,
    };

    public void Affecter(IReadOnlyDictionary<string, string?> v)
    {
        // Adresse corrigée : la marque « non remise » visait l'ancienne valeur.
        if (v.GetValueOrDefault("valeur") != CooValeur) { CooNonRemisLe = null; CooNonRemisMotif = null; }
        CooValeur = v.GetValueOrDefault("valeur");
        CooReseau = v.GetValueOrDefault("reseau");
        CooLigne1 = v.GetValueOrDefault("ligne1");
        CooLigne2 = v.GetValueOrDefault("ligne2");
        CooLigne3 = v.GetValueOrDefault("ligne3");
        CooCodePostal = v.GetValueOrDefault("code_postal");
        CooVille = v.GetValueOrDefault("ville");
        CooPays = v.GetValueOrDefault("pays");
    }
}

public class UsageCoordonnee
{
    public long UcoId { get; set; }
    public long UcoCooId { get; set; }
    public long? UcoPerId { get; set; }
    public long? UcoIndId { get; set; }
    public long? UcoRatId { get; set; }
    public string? UcoUsage { get; set; }
    public string? UcoLibelle { get; set; }
    public bool UcoPrincipal { get; set; }
    public int UcoOrdre { get; set; }
}

public class CoordonneeHistorique
{
    public long CohId { get; set; }
    public long CohCooId { get; set; }
    public JsonDocument CohAvant { get; set; } = JsonDocument.Parse("{}");
    public DateTimeOffset CohLe { get; set; }
    public string? CohPar { get; set; }
}

/// <summary>Contexte EF Core du module Annuaire (modules/annuaire/db) ; les options sont fournies par l'application.</summary>
public class AnnuaireDbContext(DbContextOptions<AnnuaireDbContext> options) : DbContext(options)
{
    public DbSet<NiveauPersonne> Niveaux => Set<NiveauPersonne>();
    public DbSet<Casquette> Casquettes => Set<Casquette>();
    public DbSet<TypeLien> TypesLien => Set<TypeLien>();
    public DbSet<RoleIndividu> Roles => Set<RoleIndividu>();
    public DbSet<Personne> Personnes => Set<Personne>();
    public DbSet<Individu> Individus => Set<Individu>();
    public DbSet<Rattachement> Rattachements => Set<Rattachement>();
    public DbSet<LienPersonne> Liens => Set<LienPersonne>();
    public DbSet<Coordonnee> Coordonnees => Set<Coordonnee>();
    public DbSet<UsageCoordonnee> Usages => Set<UsageCoordonnee>();
    public DbSet<CoordonneeHistorique> Historique => Set<CoordonneeHistorique>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<NiveauPersonne>().ToTable("niveau_personne").HasKey(x => x.NivCode);
        b.Entity<Casquette>(e => { e.ToTable("casquette").HasKey(x => x.CasCode); e.Property(x => x.CasGroupes).HasColumnType("jsonb"); });
        b.Entity<TypeLien>().ToTable("type_lien").HasKey(x => x.TliCode);
        b.Entity<RoleIndividu>().ToTable("role_individu").HasKey(x => x.RolCode);
        b.Entity<Personne>(e =>
        {
            e.ToTable("personne").HasKey(x => x.PerId);
            e.Property(x => x.PerCasquettes).HasColumnType("jsonb");
            e.Property(x => x.PerCode).ValueGeneratedOnAdd();
        });
        b.Entity<Individu>(e => { e.ToTable("individu").HasKey(x => x.IndId); e.Property(x => x.IndRoles).HasColumnType("jsonb"); });
        b.Entity<Rattachement>().ToTable("rattachement").HasKey(x => x.RatId);
        b.Entity<LienPersonne>().ToTable("lien_personne").HasKey(x => x.LpeId);
        b.Entity<Coordonnee>().ToTable("coordonnee").HasKey(x => x.CooId);
        b.Entity<UsageCoordonnee>().ToTable("usage_coordonnee").HasKey(x => x.UcoId);
        b.Entity<CoordonneeHistorique>(e => { e.ToTable("coordonnee_historique").HasKey(x => x.CohId); e.Property(x => x.CohAvant).HasColumnType("jsonb"); });
    }
}

// ------------------------------------------------------------------ contrats HTTP (snake_case)

/// <summary>Élément d'un référentiel : niveau (morale), casquette (groupes), type de lien (libellé inverse), rôle.</summary>
public sealed class ReferentielDto
{
    public string Code { get; set; } = "";
    public string Libelle { get; set; } = "";
    public string? Icone { get; set; }
    public int Ordre { get; set; }
    public bool Actif { get; set; } = true;
    public bool? Morale { get; set; }
    public List<string>? Groupes { get; set; }
    public string? LibelleInverse { get; set; }
}

public sealed record ReferentielsDto(List<ReferentielDto> Niveaux, List<ReferentielDto> Casquettes, List<ReferentielDto> TypesLien, List<ReferentielDto> Roles);

public sealed record ResumePersonne(long Id, string? Code, string RaisonSociale, string? NomCommercial, string Niveau, string NiveauLibelle, string? Icone,
    string? Ville, string? Siret, List<string> Casquettes, bool Actif, long? ParentId, string? Chemin, bool Provisoire = false);

public sealed record ResumeIndividu(long Id, string? Civilite, string Nom, string? Prenom, string NomComplet, string? Personnes, string? Email, string? Telephone, bool Actif);

/// <summary>Fiche qui utilise une coordonnée (personne, individu ou rattachement).</summary>
public sealed record FicheUsage(string Type, long Id, string Libelle, string? Usage, long? IndividuId = null, long? PersonneId = null);

/// <summary>Usage d'une coordonnée lu pour une fiche (champs gérés « coordonnees »).</summary>
public sealed class UsageDto
{
    public long? UcoId { get; set; }
    public long CooId { get; set; }
    public string Nature { get; set; } = "";
    public string? Usage { get; set; }
    public string? Libelle { get; set; }
    public bool Principal { get; set; }
    public string? Ligne1 { get; set; }
    public string? Ligne2 { get; set; }
    public string? Ligne3 { get; set; }
    public string? CodePostal { get; set; }
    public string? Ville { get; set; }
    public string? Pays { get; set; }
    public string? Valeur { get; set; }
    public string? Reseau { get; set; }
    public Dictionary<string, string?> Origine { get; set; } = [];
    public DateTimeOffset? Maj { get; set; }
    public DateTimeOffset? NonRemisLe { get; set; }
    public string? NonRemisMotif { get; set; }
    public List<FicheUsage> Partages { get; set; } = [];
    /// <summary>Coordonnées proposées : fiche liée d'où vient la coordonnée.</summary>
    public FicheUsage? Source { get; set; }
}

public sealed class RattachementDto
{
    public long RatId { get; set; }
    public long IndId { get; set; }
    public long PerId { get; set; }
    public string Individu { get; set; } = "";
    public string? Personne { get; set; }
    public string? Niveau { get; set; }
    public string? Fonction { get; set; }
    public string? Service { get; set; }
    public bool Principal { get; set; }
    public bool Titulaire { get; set; }
    public string? Debut { get; set; }
    public string? Fin { get; set; }
    public bool Actif { get; set; }
    public string? Commentaire { get; set; }
    public DateTimeOffset Maj { get; set; }
    public List<UsageDto> Coordonnees { get; set; } = [];
}

/// <summary>Page de rattachements d'une fiche (onglet Contacts).</summary>
public sealed record PageRattachementsDto(List<RattachementDto> Lignes, int Total, int Page, int Taille);

public sealed record LienDto(long LpeId, string TliCode, bool Inverse, long AutreId, string? Autre, string? Commentaire, string? Debut, string? Fin);

public sealed record HistoriqueCoordonneeDto(JsonElement Avant, DateTimeOffset Le, string? Par);

public sealed record ParticulierDto(long Id, bool Existant);

// ------------------------------------------------------------------ saisies des champs gérés

public sealed class NouvelIndividu
{
    public string? Civilite { get; set; }
    public string? Nom { get; set; }
    public string? Prenom { get; set; }
}

public sealed class SaisieRattachement
{
    public long? RatId { get; set; }
    public long? IndId { get; set; }
    public long? PerId { get; set; }
    public NouvelIndividu? NouvelIndividu { get; set; }
    public string? Individu { get; set; }
    public string? Personne { get; set; }
    public string? Fonction { get; set; }
    public string? Service { get; set; }
    public bool Principal { get; set; }
    public bool Titulaire { get; set; }
    public string? Debut { get; set; }
    public string? Fin { get; set; }
    public bool? Actif { get; set; }
    public string? Commentaire { get; set; }
    public DateTimeOffset? Maj { get; set; }
    /// <summary>Rattachement retiré (les rattachements non saisis sont inchangés).</summary>
    public bool Supprime { get; set; }
    public List<SaisieCoordonnee> Coordonnees { get; set; } = [];
}

public sealed class SaisieLien
{
    public long? LpeId { get; set; }
    public long? AutreId { get; set; }
    public string? TliCode { get; set; }
    public bool Inverse { get; set; }
    public string? Commentaire { get; set; }
    public string? Debut { get; set; }
    public string? Fin { get; set; }
}
