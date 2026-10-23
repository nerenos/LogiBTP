namespace LogiBTP.OAuth.Web;

/// <summary>Événement à signaler aux personnes autorisées à reconnecter une connexion (échec du renouvellement, échéance proche).</summary>
public sealed record SignalOAuth(long Connexion, string Nom, string Genre, string Titre, string? Texte, string Niveau, string Cle)
{
    public string Url => $"/parametres/connexions?id={Connexion}";
}

/// <summary>
/// Points d'accroche du module (méthode patron), implémentés par l'application : services d'un utilisateur et
/// destinataires des droits d'une connexion (le module ne connaît ni les services ni les comptes), publication des
/// signaux (notifications). Sans spécialisation : seuls les administrateurs reconnectent, rien n'est publié.
/// </summary>
public abstract class SpecialisationOAuth
{
    /// <summary>Codes des services dont l'utilisateur est membre (droits « service:&lt;code&gt; »).</summary>
    public virtual Task<IReadOnlyList<string>> ServicesAsync(string utilisateur, CancellationToken ct) => Task.FromResult<IReadOnlyList<string>>([]);

    /// <summary>Comptes à prévenir pour une connexion : administrateurs et titulaires des droits (profils, services).</summary>
    public virtual Task<IReadOnlyList<string>> DestinatairesAsync(IReadOnlyList<string> droits, CancellationToken ct) => Task.FromResult<IReadOnlyList<string>>([]);

    /// <summary>Publie un signal aux destinataires (notifications de l'application).</summary>
    public virtual Task SignalerAsync(SignalOAuth signal, IReadOnlyList<string> destinataires, CancellationToken ct) => Task.CompletedTask;
}

/// <summary>Spécialisation par défaut (tests, application sans notifications).</summary>
public sealed class SpecialisationOAuthDefaut : SpecialisationOAuth;
