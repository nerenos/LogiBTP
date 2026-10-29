using System.Text.Json;
using LogiBTP.Fiches;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Fiches.Web;

public class TypeFiche
{
    public string TyfCode { get; set; } = "";
    public string TyfLibelle { get; set; } = "";
    public string TyfTable { get; set; } = "";
    public string TyfCle { get; set; } = "";
    public string? TyfColonneProprietes { get; set; }
    public JsonDocument TyfDefinition { get; set; } = JsonDocument.Parse("{}");
    public bool TyfActif { get; set; } = true;
}

public class DroitFiche
{
    public string DrfProfil { get; set; } = "";
    public string DrfType { get; set; } = "";
    public string DrfAction { get; set; } = "";
}

public class ParametreChampFiche
{
    public string PcfType { get; set; } = "";
    public string PcfChamp { get; set; } = "";
    public bool PcfObligatoire { get; set; }
    public bool PcfConfidentiel { get; set; }
}

public class ChampSupplementaire
{
    public string ChsType { get; set; } = "";
    public string ChsCode { get; set; } = "";
    public string ChsLibelle { get; set; } = "";
    public string ChsTypeDonnee { get; set; } = "texte";
    public string? ChsFormat { get; set; }
    public int? ChsLongueur { get; set; }
    public bool ChsObligatoire { get; set; }
    public bool ChsConfidentiel { get; set; }
    public JsonDocument? ChsOptions { get; set; }
    public string? ChsRequete { get; set; }
    public string? ChsAide { get; set; }
    public int ChsOrdre { get; set; }
    public bool ChsActif { get; set; } = true;
    public string? ChsSection { get; set; }
    public string? ChsGroupe { get; set; }
}

/// <summary>Format paramétré du chrono d'un type de fiche (et d'une variante) ; sans ligne : celui de la définition.</summary>
public class ChronoParametre
{
    public string ChfType { get; set; } = "";
    public string ChfVariante { get; set; } = "";
    public string? ChfPrefixe { get; set; }
    public string? ChfFormat { get; set; }
    public string ChfRaz { get; set; } = "J";
}

public class VerrouFiche
{
    public string VefType { get; set; } = "";
    public string VefId { get; set; } = "";
    public string VefUtilisateur { get; set; } = "";
    public Guid VefJeton { get; set; }
    public DateTimeOffset VefDepuis { get; set; }
    public DateTimeOffset VefRenouvele { get; set; }
}

public class JournalConfidentiel
{
    public long JcfId { get; set; }
    public string JcfType { get; set; } = "";
    public string JcfElement { get; set; } = "";
    public string JcfUtilisateur { get; set; } = "";
    public string[] JcfChamps { get; set; } = [];
    public DateTimeOffset JcfDate { get; set; }
}

/// <summary>Contexte EF Core du module Fiche (modules/fiche/db) ; les options sont fournies par l'application.</summary>
public class FicheDbContext(DbContextOptions<FicheDbContext> options) : DbContext(options)
{
    public DbSet<TypeFiche> Types => Set<TypeFiche>();
    public DbSet<DroitFiche> Droits => Set<DroitFiche>();
    public DbSet<ParametreChampFiche> Parametres => Set<ParametreChampFiche>();
    public DbSet<ChampSupplementaire> Supplementaires => Set<ChampSupplementaire>();
    public DbSet<VerrouFiche> Verrous => Set<VerrouFiche>();
    public DbSet<ChronoParametre> Chronos => Set<ChronoParametre>();
    public DbSet<JournalConfidentiel> Journal => Set<JournalConfidentiel>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<TypeFiche>(e => { e.ToTable("type_fiche").HasKey(x => x.TyfCode); e.Property(x => x.TyfDefinition).HasColumnType("jsonb"); });
        b.Entity<DroitFiche>().ToTable("droit_fiche").HasKey(x => new { x.DrfProfil, x.DrfType, x.DrfAction });
        b.Entity<ParametreChampFiche>().ToTable("parametre_champ_fiche").HasKey(x => new { x.PcfType, x.PcfChamp });
        b.Entity<ChampSupplementaire>(e => { e.ToTable("champ_supplementaire").HasKey(x => new { x.ChsType, x.ChsCode }); e.Property(x => x.ChsOptions).HasColumnType("jsonb"); });
        b.Entity<VerrouFiche>().ToTable("verrou_fiche").HasKey(x => new { x.VefType, x.VefId });
        b.Entity<ChronoParametre>().ToTable("chrono_fiche").HasKey(x => new { x.ChfType, x.ChfVariante });
        b.Entity<JournalConfidentiel>().ToTable("journal_confidentiel").HasKey(x => x.JcfId);
    }
}

// ------------------------------------------------------------------ contrats HTTP

/// <summary>Droits d'un type de fiche ; ModifierCode : changer le code d'une fiche déjà créée (chrono).</summary>
public sealed record DroitsFiche(bool Voir, bool Modifier, bool Debloquer, bool Confidentiel, bool Supprimer = false, bool ModifierCode = false);

/// <summary>Définition envoyée au client : champs (avec obligatoire_parametre), champs supplémentaires, droits.</summary>
public sealed class DefinitionFicheDto
{
    public string Type { get; set; } = "";
    public string Libelle { get; set; } = "";
    public string? Titre { get; set; }
    public string? SousTitre { get; set; }
    public List<SectionFiche> Sections { get; set; } = [];
    public List<ChampFiche> Champs { get; set; } = [];
    public List<ChampFiche> Supplementaires { get; set; } = [];
    /// <summary>Chrono du code (champ, portée, parent, variante) : code prévisionnel et contrôle à la saisie.</summary>
    public ChronoDefinition? Chrono { get; set; }
    public DroitsFiche Droits { get; set; } = new(false, false, false, false);
}

/// <summary>Verrou : Moi = cette fenêtre (jeton) ; MemeUtilisateur = l'utilisateur courant (reprise silencieuse).</summary>
public sealed record EtatVerrou(string Utilisateur, DateTimeOffset Depuis, bool Moi, bool MemeUtilisateur = false);

public sealed class FicheDto
{
    public string? Id { get; set; }
    public Dictionary<string, object?> Valeurs { get; set; } = [];
    public Dictionary<string, object?> Proprietes { get; set; } = [];
    public string? H { get; set; }
    /// <summary>Champs confidentiels non envoyés : code (programme) ou « +code » (supplémentaire).</summary>
    public List<string> Masques { get; set; } = [];
    /// <summary>Mots de passe enregistrés (valeur jamais envoyée, révélée à la demande) : code ou « +code ».</summary>
    public List<string> Secrets { get; set; } = [];
    public EtatVerrou? Verrou { get; set; }
}

public sealed record ReponseVerrou(bool Ok, EtatVerrou? Verrou);

public sealed class DemandeVerrou
{
    public Guid Jeton { get; set; }
    public bool Forcer { get; set; }
}

public sealed class DemandeEnregistrement
{
    public Guid Jeton { get; set; }
    public string? H { get; set; }
    public Dictionary<string, JsonElement> Valeurs { get; set; } = [];
    public Dictionary<string, JsonElement> Proprietes { get; set; } = [];
    /// <summary>Relire les champs confidentiels (s'ils étaient affichés et si le droit le permet).</summary>
    public bool Confidentiel { get; set; }
}

/// <summary>
/// Code d'une fiche (création ou modification) : code saisi (vide : seulement le prévisionnel), valeurs de la fiche
/// qui le déterminent (portée, parent, variante), fiche modifiée (exclue du contrôle).
/// </summary>
public sealed class DemandeCode
{
    public string? Code { get; set; }
    public Dictionary<string, JsonElement> Valeurs { get; set; } = [];
    public string? Id { get; set; }
}

/// <summary>Fiche qui porte déjà un code.</summary>
public sealed record FichePrise(string Id, string Code);

/// <summary>Code prévisionnel (calculé par le chrono, sans faire avancer le compteur) et fiche qui porte déjà le code saisi.</summary>
public sealed record ReponseCode(string? Previsionnel, FichePrise? Pris);

/// <summary>Refus CODE_PRIS d'une création : code saisi, fiche qui le porte, prochain code libre proposé à partir de la saisie.</summary>
public sealed record CodePrisDetails(string Code, FichePrise Pris, string? Propose);

/// <summary>
/// Chrono d'un type de fiche (Paramètres › Référentiels communs) : variante, préfixe, format, remise à zéro, rang
/// tiré du parent (sans compteur), compteur par portée, dernier rang de l'exercice en cours (portée commune) et
/// prochain code.
/// </summary>
public sealed record ChronoTypeDto(string Type, string Libelle, string Variante, string? LibelleVariante, string? Prefixe, string? Format, string Raz,
    bool Parent, bool Portee, int Exercice, int Dernier, string Prochain);

public sealed class ChronoSaisie
{
    public string Variante { get; set; } = "";
    public string? Prefixe { get; set; }
    public string? Format { get; set; }
    public string Raz { get; set; } = "J";
    public int? Dernier { get; set; }
}

/// <summary>Révélation d'un mot de passe : code du champ (« +code » pour un champ supplémentaire).</summary>
public sealed class DemandeSecret
{
    public string Champ { get; set; } = "";
}

public sealed record ReponseSecret(string? Valeur);

public sealed record ReponseConfidentiel(Dictionary<string, object?> Valeurs, Dictionary<string, object?> Proprietes);

public sealed class ParametrageFicheDto
{
    public List<string> Obligatoires { get; set; } = [];
    /// <summary>Champs du logiciel rendus confidentiels (RGPD) par le paramétrage.</summary>
    public List<string> Confidentiels { get; set; } = [];
    public List<ChampFiche> Supplementaires { get; set; } = [];
}
