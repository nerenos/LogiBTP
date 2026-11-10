using LogiBTP.FactureElectronique.Web.Connecteurs;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace LogiBTP.FactureElectronique.Web;

/// <summary>Branchement du module Facturation électronique dans une application ASP.NET Core (lot 6 : connecteurs ; schéma, file et routes au lot 8).</summary>
public static class Extensions
{
    /// <summary>
    /// Connecteurs de plateforme : fabrique, client HTTP, plateformes simulées et dépôts manuels (un état par base, en
    /// mémoire ; <paramref name="magasin"/> : autre stockage par base, lot 8). Le jeton vient de l'<c>IFournisseurJeton</c>
    /// branché par l'application (module OAuth).
    /// </summary>
    public static IServiceCollection AddConnecteursFactureElectronique(this IServiceCollection services,
        OptionsPlateformeSimulee? simulation = null, Func<string, IMagasinFlux>? magasin = null)
    {
        services.AddHttpClient(FabriqueConnecteurs.ClientHttp);
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton(s => new PlateformesSimulees(s.GetRequiredService<TimeProvider>(), magasin, simulation));
        services.TryAddSingleton(_ => new DepotsManuels(magasin));
        services.TryAddSingleton(s => new FabriqueConnecteurs(s, s.GetServices<EnregistrementConnecteur>()));
        return services;
    }

    /// <summary>Connecteur propre à une PA (ou remplacement d'un connecteur fourni, même code), créé par la fabrique.</summary>
    public static IServiceCollection AddConnecteurPlateforme(this IServiceCollection services, string code, CreationConnecteur creation) =>
        services.AddSingleton(new EnregistrementConnecteur(code, creation));
}
