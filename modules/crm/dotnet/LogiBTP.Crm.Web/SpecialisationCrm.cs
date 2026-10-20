namespace LogiBTP.Crm.Web;

/// <summary>Élément de l'application désigné par (type, id).</summary>
public sealed record ElementCrm(string Type, string Id);

/// <summary>Élément décrit : libellé, adresse de navigation (client), icône.</summary>
public sealed record ElementDecrit(string Type, string Id, string Libelle, string? Url, string? Icone);

/// <summary>Service de l'application : identifiant, code, libellé ; principal pour l'individu interrogé.</summary>
public sealed record ServiceEntreprise(int Id, string Code, string Libelle, bool Principal = false);

/// <summary>Document de l'application pour le fil : élément, identifiant, titre, image, date, auteur, page, contenu (image).</summary>
public sealed record DocumentFil(ElementCrm Element, long Id, string Titre, bool Image, DateTimeOffset Quand, string? Par, string? Url, string? Contenu);

/// <summary>Type d'élément rattachable à une note (proposé à la saisie).</summary>
public sealed record TypeElementCrm(string Code, string Libelle, string? Icone);

/// <summary>
/// Spécialisation du module CRM (méthode patron) : l'application décrit ses éléments (libellés, liens), relie un
/// utilisateur à son individu et fournit les services. Sans spécialisation, les éléments gardent leur type et leur
/// identifiant, l'utilisateur n'a ni individu ni service.
/// </summary>
public class SpecialisationCrm
{
    /// <summary>Types d'élément rattachables (tiers, chantier, document…).</summary>
    public virtual IReadOnlyList<TypeElementCrm> TypesElements => [];

    public virtual Task<List<ElementDecrit>> DecrireAsync(CrmDbContext db, IReadOnlyCollection<ElementCrm> elements, CancellationToken ct) =>
        Task.FromResult(elements.Select(e => new ElementDecrit(e.Type, e.Id, $"{e.Type} {e.Id}", null, null)).ToList());

    /// <summary>Individu de l'utilisateur connecté (code de connexion), ou null.</summary>
    public virtual Task<long?> IndividuAsync(CrmDbContext db, string utilisateur, CancellationToken ct) => Task.FromResult<long?>(null);

    /// <summary>Noms des individus.</summary>
    public virtual Task<Dictionary<long, string>> IndividusAsync(CrmDbContext db, IReadOnlyCollection<long> ids, CancellationToken ct) =>
        Task.FromResult(ids.Distinct().ToDictionary(i => i, i => $"#{i}"));

    /// <summary>Services d'un individu (le principal en tête).</summary>
    public virtual Task<List<ServiceEntreprise>> ServicesIndividuAsync(CrmDbContext db, long individu, CancellationToken ct) => Task.FromResult(new List<ServiceEntreprise>());

    /// <summary>
    /// Projet créé depuis une demande (objet, tiers, montant, responsable, description) : l'élément créé, ou null si
    /// l'application ne sait pas créer de projet.
    /// </summary>
    public virtual Task<ElementCrm?> CreerProjetAsync(CrmDbContext db, CrmDemande demande, string? responsable, CancellationToken ct) => Task.FromResult<ElementCrm?>(null);

    /// <summary>Recherche d'éléments d'un type (documents par numéro ou objet…) pour les rattacher à une note.</summary>
    public virtual Task<List<ElementDecrit>> RechercherAsync(CrmDbContext db, string type, string texte, CancellationToken ct) => Task.FromResult(new List<ElementDecrit>());

    /// <summary>
    /// Périmètre du fil d'un élément : lui-même et ce qu'il agrège (une affaire montre ses chantiers…). Par défaut,
    /// l'élément seul.
    /// </summary>
    public virtual Task<List<ElementCrm>> PerimetreAsync(CrmDbContext db, ElementCrm element, CancellationToken ct) => Task.FromResult(new List<ElementCrm> { element });

    /// <summary>Documents (et photos) rattachés à des éléments, du plus récent au plus ancien, avant une date.</summary>
    public virtual Task<List<DocumentFil>> DocumentsAsync(CrmDbContext db, IReadOnlyCollection<ElementCrm> elements, DateTimeOffset? avant, int taille, CancellationToken ct) =>
        Task.FromResult(new List<DocumentFil>());

    /// <summary>Services de l'application (actifs).</summary>
    public virtual Task<List<ServiceEntreprise>> ServicesAsync(CrmDbContext db, CancellationToken ct) => Task.FromResult(new List<ServiceEntreprise>());
}
