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
    public string? ChsAide { get; set; }
    public int ChsOrdre { get; set; }
    public bool ChsActif { get; set; } = true;
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
    public DbSet<JournalConfidentiel> Journal => Set<JournalConfidentiel>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<TypeFiche>(e => { e.ToTable("type_fiche").HasKey(x => x.TyfCode); e.Property(x => x.TyfDefinition).HasColumnType("jsonb"); });
        b.Entity<DroitFiche>().ToTable("droit_fiche").HasKey(x => new { x.DrfProfil, x.DrfType, x.DrfAction });
        b.Entity<ParametreChampFiche>().ToTable("parametre_champ_fiche").HasKey(x => new { x.PcfType, x.PcfChamp });
        b.Entity<ChampSupplementaire>(e => { e.ToTable("champ_supplementaire").HasKey(x => new { x.ChsType, x.ChsCode }); e.Property(x => x.ChsOptions).HasColumnType("jsonb"); });
        b.Entity<VerrouFiche>().ToTable("verrou_fiche").HasKey(x => new { x.VefType, x.VefId });
        b.Entity<JournalConfidentiel>().ToTable("journal_confidentiel").HasKey(x => x.JcfId);
    }
}

// ------------------------------------------------------------------ contrats HTTP

public sealed record DroitsFiche(bool Voir, bool Modifier, bool Debloquer, bool Confidentiel);

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

public sealed record ReponseConfidentiel(Dictionary<string, object?> Valeurs, Dictionary<string, object?> Proprietes);

public sealed class ParametrageFicheDto
{
    public List<string> Obligatoires { get; set; } = [];
    public List<ChampFiche> Supplementaires { get; set; } = [];
}
