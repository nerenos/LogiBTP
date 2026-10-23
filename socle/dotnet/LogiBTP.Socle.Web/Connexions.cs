namespace LogiBTP.Socle.Web;

/// <summary>Jeton d'accès valable d'une connexion à un service externe : compte connecté (pour SASL XOAUTH2…) et fin de validité.</summary>
public sealed record JetonAcces(string Jeton, string Compte, DateTimeOffset ExpireLe);

/// <summary>Connexion à un service externe proposée aux modules consommateurs (choix d'une connexion OAuth).</summary>
public sealed record ConnexionExterne(long Id, string Nom, string Fournisseur, string Etat);

/// <summary>
/// Contrat entre un module qui ouvre des connexions sortantes (OAuth) et les modules qui s'en servent (Mail…) : aucun
/// des deux ne dépend de l'autre, l'application branche l'implémentation. Une connexion inutilisable lève une
/// <see cref="ExceptionMetier"/> de code <see cref="AReconnecter"/>.
/// </summary>
public interface IFournisseurJeton
{
    public const string AReconnecter = "CONNEXION_A_RECONNECTER";

    /// <summary>Jeton d'accès valable (renouvelé si besoin) de la connexion.</summary>
    Task<JetonAcces> JetonAsync(long connexion, CancellationToken ct);

    /// <summary>Connexions de la base courante.</summary>
    Task<IReadOnlyList<ConnexionExterne>> ConnexionsAsync(CancellationToken ct);
}

/// <summary>
/// Utilisations d'une connexion par un module consommateur (libellés affichés dans le paramétrage des connexions) ;
/// une connexion utilisée ne se supprime pas.
/// </summary>
public interface IUtilisationsConnexion
{
    Task<IReadOnlyList<string>> UtilisationsAsync(long connexion, CancellationToken ct);
}
