namespace LogiBTP.Socle.Web;

/// <summary>Route d'écriture permise à un agent : préfixe ou gabarit (« /api/documents/{id}/lignes ») et méthode HTTP.</summary>
public sealed record RouteAgent(string Methode, string Gabarit);

/// <summary>
/// Plafond d'une délégation d'agent : ce que l'agent ne peut jamais dépasser, quels que soient les droits du compte.
/// </summary>
/// <param name="Delegation">Code de la délégation.</param>
/// <param name="Modele">Modèle de plafond (<see cref="ModelePlafond"/>) ; SUR_MESURE : <paramref name="Actions"/> fait foi.</param>
/// <param name="Actions">Actions permises par nœud (nœud → actions).</param>
/// <param name="PorteeMax">Portée maximale (<see cref="PorteesDroits"/>).</param>
/// <param name="GardesFous">Garde-fous actifs (<see cref="GardeFou"/>).</param>
/// <param name="RoutesEcriture">Liste blanche des routes d'écriture permises.</param>
/// <param name="Interdits">Nœuds ou actions interdits à l'agent.</param>
public sealed record PlafondAgent(
    string Delegation,
    string Modele,
    IReadOnlyDictionary<string, IReadOnlyList<string>> Actions,
    string PorteeMax,
    IReadOnlyList<string> GardesFous,
    IReadOnlyList<RouteAgent> RoutesEcriture,
    IReadOnlyList<string> Interdits);

/// <summary>Plafond des délégations d'agent (implémenté par le module MCP, lu par le module Droits).</summary>
public interface IPlafondAgent
{
    /// <summary>Plafond de la délégation (null : délégation inconnue, révoquée ou expirée).</summary>
    Task<PlafondAgent?> PlafondAsync(string delegation, CancellationToken ct);
}

/// <summary>Jeton délégué ouvert : compte représenté, délégation et client.</summary>
public sealed record JetonDelegue(string Compte, string Delegation, string Client);

/// <summary>Jetons délégués aux agents (implémenté par le module Authentification).</summary>
public interface IJetonsDelegues
{
    /// <summary>Émet un jeton pour le compte ; le secret n'est rendu qu'une fois (seule son empreinte est conservée).</summary>
    Task<string> EmettreAsync(string compte, string delegation, string client, DateTime? expiration, CancellationToken ct);

    /// <summary>Révoque un jeton (par son secret) ; faux si inconnu.</summary>
    Task<bool> RevoquerAsync(string secret, CancellationToken ct);

    /// <summary>Révoque tous les jetons du compte ; rend le nombre révoqué.</summary>
    Task<int> RevoquerPourCompteAsync(string compte, CancellationToken ct);

    /// <summary>Ouvre un secret : compte, délégation et client (null : inconnu, révoqué ou expiré).</summary>
    Task<JetonDelegue?> OuvrirAsync(string secret, CancellationToken ct);
}
