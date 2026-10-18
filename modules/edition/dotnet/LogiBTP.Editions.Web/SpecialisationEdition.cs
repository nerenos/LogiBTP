using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Web;

namespace LogiBTP.Editions.Web;

/// <summary>Source de données d'édition déclarée par l'application (document, fiche, liste…).</summary>
public sealed record SourceEdition(string Code, string Libelle, string Cible);

/// <summary>
/// Demande d'édition : source et identifiant de l'élément, modèle (null : dernier imprimé ou défaut du type),
/// présentation des lignes, format (formats flexibles du modèle), orientation, valeurs des paramètres du modèle.
/// </summary>
public sealed record DemandeEdition(string Source, string Id, string? Modele = null, string? Presentation = null,
    string? Format = null, string? Orientation = null, Dictionary<string, JsonElement>? Parametres = null);

/// <summary>Image fournie au moteur : type (png, jpeg), octets en base64, dimensions en pixels, orientation EXIF.</summary>
public sealed record RessourceEdition(string Type, string Base64, int Largeur, int Hauteur, int? Dpi = null, int? Orientation = null);

/// <summary>Élément édité : type (choix du modèle par défaut), libellé (titre du PDF), niveau d'accès de la donnée.</summary>
public sealed record ElementEdite(string? Type, string Libelle, string? DernierModele = null, string? DernierePresentation = null);

/// <summary>
/// Spécialisation du module Édition (méthode patron) : l'application déclare ses sources et fournit les données
/// d'une édition par un seul appel (agrégat côté serveur, § 3.10), le dictionnaire des champs, les ressources images
/// et ce qu'elle garde d'une impression (dernier modèle imprimé, Q13). Sans spécialisation : aucune source.
/// </summary>
public class SpecialisationEdition
{
    public virtual IReadOnlyList<SourceEdition> Sources => [];

    /// <summary>Élément édité (type, libellé, dernier modèle imprimé) ; null : introuvable ou accès refusé.</summary>
    public virtual Task<ElementEdite?> ElementAsync(IServiceProvider services, string source, string id, Utilisateur u, CancellationToken ct) =>
        Task.FromResult<ElementEdite?>(null);

    /// <summary>Données d'une édition (objet racine lu par les formules du modèle) ; null : introuvable.</summary>
    public virtual Task<JsonObject?> DonneesAsync(IServiceProvider services, DemandeEdition demande, Utilisateur u, CancellationToken ct) =>
        Task.FromResult<JsonObject?>(null);

    /// <summary>
    /// Données d'une source annexe demandée par un sous-rapport (marchés et avenants, situations précédentes…) :
    /// ajoutées à la racine sous `sources.&lt;nom&gt;` dans le même appel (§ 15.2).
    /// </summary>
    public virtual Task<JsonNode?> SourceAnnexeAsync(IServiceProvider services, string nom, JsonObject donnees, Utilisateur u, CancellationToken ct) =>
        Task.FromResult<JsonNode?>(null);

    /// <summary>Dictionnaire des champs d'une source (concepteur, contrôle des modèles) : [{ chemin, libelle, type }].</summary>
    public virtual JsonArray Dictionnaire(string source) => [];

    /// <summary>Ressources images demandées par les modèles (codes) pour cet élément (logo de l'agence…).</summary>
    public virtual Task<Dictionary<string, RessourceEdition>> RessourcesAsync(IServiceProvider services, IReadOnlyCollection<string> codes,
        JsonObject donnees, Utilisateur u, CancellationToken ct) => Task.FromResult(new Dictionary<string, RessourceEdition>());

    /// <summary>Après une impression (PDF produit pour imprimer) : dernier modèle et présentation de l'élément (Q13).</summary>
    public virtual Task ApresImpressionAsync(IServiceProvider services, DemandeEdition demande, string modele, string? presentation,
        Utilisateur u, CancellationToken ct) => Task.CompletedTask;

    /// <summary>Accès à un modèle (Q18) ; à remplacer par le module des droits.</summary>
    public virtual bool PeutUtiliser(ModeleEdition m, Utilisateur u) => AccesEdition.Autorise(m.MedNiveauAcces, m.MedAccesProfils, u);

    /// <summary>Écriture des modèles, chartes et défauts : administrateur en attendant le module des droits.</summary>
    public virtual bool PeutParametrer(Utilisateur u) => u.EstAdmin;

    /// <summary>Date du jour des éditions (variable `Aujourdhui()`), au fuseau de la société.</summary>
    public virtual DateOnly Aujourdhui() => DateOnly.FromDateTime(DateTime.Now);
}
