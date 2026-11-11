using LogiBTP.Socle.Web;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace LogiBTP.FactureElectronique.Web.Connecteurs;

/// <summary>Création d'un connecteur pour les paramètres d'une société.</summary>
public delegate ConnecteurPlateforme CreationConnecteur(ParametresConnecteur parametres, IServiceProvider services);

/// <summary>Connecteur ajouté à la fabrique (PA propre, ou remplacement d'un connecteur fourni) : code et création.</summary>
public sealed record EnregistrementConnecteur(string Code, CreationConnecteur Creer);

/// <summary>
/// Fabrique des connecteurs : code (<see cref="ConnecteurFe"/>) → classe. Fournis : AFNOR (<see cref="ConnecteurAfnor"/>),
/// SIMULE (<see cref="ConnecteurSimule"/>, plateforme simulée de la base), MANUEL (<see cref="ConnecteurManuel"/>).
/// Connecteur propre à une PA : classe dérivée de <see cref="ConnecteurAfnor"/> (ou de <see cref="ConnecteurPlateforme"/>)
/// enregistrée par <c>AddConnecteurPlateforme(code, creation)</c> ; un même code remplace le connecteur fourni.
/// </summary>
public sealed class FabriqueConnecteurs
{
    /// <summary>Nom du client HTTP des connecteurs (IHttpClientFactory).</summary>
    public const string ClientHttp = "LogiBTP.FactureElectronique";

    private readonly IServiceProvider services;
    private readonly Dictionary<string, CreationConnecteur> creations = new(StringComparer.Ordinal)
    {
        [ConnecteurFe.Afnor] = (p, s) => new ConnecteurAfnor(p, s.GetRequiredService<IHttpClientFactory>().CreateClient(ClientHttp),
            s.GetService<IFournisseurJeton>(), s.GetService<ILoggerFactory>()?.CreateLogger<ConnecteurAfnor>()),
        [ConnecteurFe.Simule] = (p, s) => new ConnecteurSimule(s.GetRequiredService<PlateformesSimulees>().Pour(p.Base)),
        [ConnecteurFe.Manuel] = (p, s) => new ConnecteurManuel(s.GetRequiredService<DepotsManuels>().Pour(p.Base),
            s.GetService<TimeProvider>() ?? TimeProvider.System),
    };

    public FabriqueConnecteurs(IServiceProvider services, IEnumerable<EnregistrementConnecteur>? enregistrements = null)
    {
        this.services = services;
        foreach (var e in enregistrements ?? []) creations[e.Code] = e.Creer;
    }

    /// <summary>Codes des connecteurs disponibles (fournis puis ajoutés).</summary>
    public IReadOnlyList<string> Codes => [.. creations.Keys];

    /// <summary>Connecteur des paramètres d'une société (CONNECTEUR_INCONNU si le code n'est pas enregistré).</summary>
    public ConnecteurPlateforme Creer(ParametresConnecteur parametres)
    {
        ArgumentNullException.ThrowIfNull(parametres);
        if (string.IsNullOrWhiteSpace(parametres.Base)) throw new ExceptionConnecteur(ErreurFe.ParametreConnecteur, "Base de la société absente");
        return creations.TryGetValue(parametres.Code ?? "", out var creer)
            ? creer(parametres, services)
            : throw new ExceptionConnecteur(ErreurFe.ConnecteurInconnu, $"Connecteur inconnu : {parametres.Code}");
    }
}
