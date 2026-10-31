using System.Text.Json;
using LogiBTP.Listes;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Listes.Web;

/// <summary>Source déclarée par l'application (source_liste) : vue SQL, identifiant et type d'élément.</summary>
public class SourceListe
{
    public string SliCode { get; set; } = "";
    public string SliLibelle { get; set; } = "";
    public string SliVue { get; set; } = "";
    public string SliColonneId { get; set; } = "";
    public string? SliColonneType { get; set; }
    public string? SliTypeElement { get; set; }
    /// <summary>Saisie dans les listes autorisée sur cette source (UPDATE sur la vue, colonnes is_updatable).</summary>
    public bool SliModifiable { get; set; }
    public bool SliActif { get; set; } = true;
}

/// <summary>Thème de vues (theme_liste) : regroupement et types d'élément couverts.</summary>
public class ThemeListe
{
    public string ThlCode { get; set; } = "";
    public string ThlLibelle { get; set; } = "";
    public string? ThlIcone { get; set; }
    public int ThlOrdre { get; set; }
    public JsonDocument ThlTypes { get; set; } = JsonDocument.Parse("[]");
    public bool ThlActif { get; set; } = true;
    /// <summary>Vue ouverte d'un clic sur le thème, sauf vue ★ de l'utilisateur (033).</summary>
    public long? ThlVliDefaut { get; set; }
}

public sealed class ThemeListeDto
{
    public string ThlCode { get; set; } = "";
    public string ThlLibelle { get; set; } = "";
    public string? ThlIcone { get; set; }
    public int ThlOrdre { get; set; }
    public List<TypeElementTheme> ThlTypes { get; set; } = [];
    public bool ThlActif { get; set; } = true;
    /// <summary>Vue ouverte d'un clic sur le thème, sauf vue ★ de l'utilisateur (033).</summary>
    public long? ThlVliDefaut { get; set; }
}

/// <summary>Vue de liste enregistrée (vue_liste).</summary>
public class VueListe
{
    public long VliId { get; set; }
    public string VliNom { get; set; } = "";
    public string? VliContexte { get; set; }
    public string? VliTheme { get; set; }
    /// <summary>P personnelle, G groupe, T tous.</summary>
    public string VliPartage { get; set; } = "P";
    public string VliProprietaire { get; set; } = "";
    public string? VliGroupe { get; set; }
    public JsonDocument VliDefinition { get; set; } = JsonDocument.Parse("{}");
    public int VliVersion { get; set; } = 1;
    public DateTimeOffset VliCreeLe { get; set; }
    public DateTimeOffset? VliModifieLe { get; set; }
}

/// <summary>
/// Contexte EF Core du module Liste (modules/liste/db). Le schéma est géré par les scripts SQL ; l'application
/// fournit les options (fournisseur Npgsql, convention snake_case) à l'enregistrement du module.
/// </summary>
public class ListeDbContext(DbContextOptions<ListeDbContext> options) : DbContext(options)
{
    public DbSet<SourceListe> Sources => Set<SourceListe>();
    public DbSet<VueListe> Vues => Set<VueListe>();
    public DbSet<ThemeListe> Themes => Set<ThemeListe>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<SourceListe>().ToTable("source_liste").HasKey(x => x.SliCode);
        b.Entity<ThemeListe>(e =>
        {
            e.ToTable("theme_liste").HasKey(x => x.ThlCode);
            e.Property(x => x.ThlTypes).HasColumnType("jsonb");
        });
        b.Entity<VueListe>(e =>
        {
            e.ToTable("vue_liste").HasKey(x => x.VliId);
            e.Property(x => x.VliDefinition).HasColumnType("jsonb");
            e.Property(x => x.VliVersion).IsConcurrencyToken();
        });
    }
}

/// <summary>Vue échangée avec le client : la définition est un objet JSON libre (mise en forme comprise).</summary>
public sealed class VueListeDto
{
    public long? VliId { get; set; }
    public string VliNom { get; set; } = "";
    public string? VliContexte { get; set; }
    public string? VliTheme { get; set; }
    public string VliPartage { get; set; } = "P";
    public string? VliProprietaire { get; set; }
    public string? VliGroupe { get; set; }
    public int VliVersion { get; set; }
    public bool Modifiable { get; set; }
    public JsonElement Definition { get; set; }
}

public sealed record ResumeVue(long VliId, string VliNom, string? VliContexte, string? VliTheme, string VliPartage, string VliProprietaire, bool Modifiable);

public sealed record SourceDto(string Code, string Libelle, IReadOnlyList<ColonneSource> Colonnes, string ColonneId, string? ColonneType, string? TypeElement, bool Modifiable);

public sealed record ReponseLot(List<Dictionary<string, object?>> Lignes, List<string?>? Suite);

public sealed record CompteSegment(string? Valeur, long Nombre);

public sealed record EtatLigne(string Id, string H);

public sealed class DemandeRequete
{
    public string? Requete { get; set; }
}
