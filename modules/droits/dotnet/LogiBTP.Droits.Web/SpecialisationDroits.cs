namespace LogiBTP.Droits.Web;

/// <summary>Nœud du catalogue des droits : clé « module/élément », libellé, actions permises, portée réglable, aide.</summary>
public sealed record NoeudCatalogue(string Cle, string Libelle, IReadOnlyList<string> Actions, bool Portee = false, string? Aide = null, string? Icone = null);

/// <summary>
/// Contrôle des routes : Module = droits du sous-arbre du nœud (lecture : une action quelconque ; écriture : une action
/// autre que la consultation), Action = action précise sur le nœud, Session = connecté suffit (pas de droit), Publique =
/// sans session (déjà réglé par l'authentification). Parametrage = lecture des pages de paramétrage (GET : Consulter sur le nœud « parametres ») et écriture (Modifier) ;
/// réservé aux routes qui ne servent que les pages /parametres.
/// </summary>
public enum ModeRoute { Module, Action, Session, Publique, Parametrage }

/// <summary>
/// Route de l'API rattachée à un nœud : préfixe du gabarit de la route (« /api/documents », « /api/fiches/{type} ») ;
/// le nœud peut citer une valeur de la route (« fiches/{type} »). Le préfixe le plus long l'emporte.
/// </summary>
public sealed record RouteDroits(string Prefixe, ModeRoute Mode, string? Noeud = null, string? Action = null);

/// <summary>
/// Spécialisation du module par l'application (méthode patron) : catalogue des nœuds (modules, types de documents et de
/// fiches, fonctions), rattachement des routes de l'API aux nœuds (refus par défaut des routes non déclarées), profils
/// utilisés par les comptes.
/// </summary>
public abstract class SpecialisationDroits
{
    /// <summary>Nœuds proposés à l'écran des droits (dans l'ordre d'affichage ; un parent avant ses enfants).</summary>
    public abstract Task<IReadOnlyList<NoeudCatalogue>> CatalogueAsync(IServiceProvider services, CancellationToken ct);

    /// <summary>Routes de l'API et leur contrôle ; une route /api absente de la table est refusée (403 DROIT_NON_DECLARE).</summary>
    public abstract IReadOnlyList<RouteDroits> Routes { get; }

    /// <summary>Nombre de comptes par code de profil (un profil utilisé ne se supprime pas).</summary>
    public virtual Task<IReadOnlyDictionary<string, int>> ComptesParProfilAsync(IServiceProvider services, CancellationToken ct) =>
        Task.FromResult<IReadOnlyDictionary<string, int>>(new Dictionary<string, int>());
}
