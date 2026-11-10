using LogiBTP.FactureElectronique.Web.Connecteurs;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace LogiBTP.FactureElectronique.Web;

/// <summary>Branchement du module Facturation électronique dans une application ASP.NET Core (facultatif : l'application fonctionne sans).</summary>
public static class Extensions
{
    /// <summary>
    /// Connecteurs de plateforme : fabrique, client HTTP, plateformes simulées et dépôts manuels (un état par base ;
    /// <paramref name="magasin"/> : stockage par base et par magasin, <see cref="ConnecteurFe.Simule"/> ou
    /// <see cref="ConnecteurFe.Manuel"/> ; mémoire par défaut). Le jeton vient de l'<c>IFournisseurJeton</c> branché par
    /// l'application (module OAuth).
    /// </summary>
    public static IServiceCollection AddConnecteursFactureElectronique(this IServiceCollection services,
        OptionsPlateformeSimulee? simulation = null, Func<string, string, IMagasinFlux>? magasin = null)
    {
        services.AddHttpClient(FabriqueConnecteurs.ClientHttp);
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton(s => new PlateformesSimulees(s.GetRequiredService<TimeProvider>(),
            magasin is null ? null : b => magasin(b, ConnecteurFe.Simule), simulation));
        services.TryAddSingleton(_ => new DepotsManuels(magasin is null ? null : b => magasin(b, ConnecteurFe.Manuel)));
        services.TryAddSingleton(s => new FabriqueConnecteurs(s, s.GetServices<EnregistrementConnecteur>()));
        return services;
    }

    /// <summary>Connecteur propre à une PA (ou remplacement d'un connecteur fourni, même code), créé par la fabrique.</summary>
    public static IServiceCollection AddConnecteurPlateforme(this IServiceCollection services, string code, CreationConnecteur creation) =>
        services.AddSingleton(new EnregistrementConnecteur(code, creation));

    /// <summary>
    /// Module complet : contexte EF (connexion de la société de la requête, par <paramref name="options"/>), spécialisation
    /// de l'application, service, file, relève, connecteurs avec la plateforme simulée et le dépôt manuel tenus en base
    /// (fe_magasin), tâche de fond (section « FactureElectronique » : Actif, IntervalleSecondes, FluxParPassage).
    /// </summary>
    public static IServiceCollection AddModuleFactureElectronique<TSpecialisation>(this IServiceCollection services,
        Action<IServiceProvider, DbContextOptionsBuilder> options, IConfiguration? configuration = null, OptionsPlateformeSimulee? simulation = null)
        where TSpecialisation : SpecialisationFactureElectronique
    {
        services.AddDbContext<FactureElectroniqueDbContext>(options);
        services.AddSingleton<SpecialisationFactureElectronique, TSpecialisation>();
        services.TryAddSingleton<MagasinsFluxBase>();
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton(s => new PlateformesSimulees(s.GetRequiredService<TimeProvider>(),
            b => s.GetRequiredService<MagasinsFluxBase>().Pour(b, ConnecteurFe.Simule), simulation));
        services.TryAddSingleton(s => new DepotsManuels(b => s.GetRequiredService<MagasinsFluxBase>().Pour(b, ConnecteurFe.Manuel)));
        services.AddConnecteursFactureElectronique(simulation);
        services.AddScoped(s => new ServiceFactureElectronique(s.GetRequiredService<FactureElectroniqueDbContext>(),
            s.GetRequiredService<SpecialisationFactureElectronique>(), s.GetRequiredService<FabriqueConnecteurs>(), s.GetRequiredService<SocieteCourante>(),
            s.GetRequiredService<DepotsManuels>(), s.GetRequiredService<TimeProvider>()));
        services.AddScoped<FileFlux>();
        services.AddScoped<ReleveFlux>();
        if (configuration is not null) services.Configure<OptionsFactureElectronique>(configuration.GetSection("FactureElectronique"));
        else services.TryAddSingleton(Options.Create(new OptionsFactureElectronique()));
        services.AddHostedService<PassageFactureElectronique>();
        return services;
    }

    /// <summary>
    /// Routes HTTP du module, sous /facture-electronique (droits rattachés par l'application à son nœud, lot 11) :
    /// paramètres, santé de la plateforme, flux (liste, détail, fichier, chronologie), chronologie d'un élément, nouvelle
    /// tentative, confirmation d'un dépôt manuel, import manuel, relève à la demande, vérification du journal.
    /// </summary>
    public static RouteGroupBuilder MapModuleFactureElectronique(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/facture-electronique");
        g.MapGet("/parametres", (ServiceFactureElectronique s, CancellationToken ct) => s.Parametres(ct));
        g.MapPut("/parametres", (ParametresFeDto p, HttpContext http, ServiceFactureElectronique s, CancellationToken ct) =>
            s.EnregistrerParametres(p, Utilisateur.Depuis(http), ct));
        g.MapGet("/sante", (ServiceFactureElectronique s, CancellationToken ct) => s.Sante(ct));
        g.MapGet("/flux", (string? sens, string? etat, string? type, string? type_element, string? id_element, long? avant, int? limite,
            bool? erreurs, DateOnly? du, DateOnly? au, ServiceFactureElectronique s, CancellationToken ct) =>
            s.Liste(new FiltreFlux(sens, etat, type, type_element, id_element, avant, limite, erreurs, du, au), ct));
        g.MapGet("/flux/{id:long}", (long id, ServiceFactureElectronique s, CancellationToken ct) => s.Detail(id, ct));
        g.MapGet("/flux/{id:long}/fichier", async (long id, string? document, ServiceFactureElectronique s, CancellationToken ct) =>
        {
            var f = await s.Fichier(id, document, ct);
            return Results.File(f.Contenu, f.TypeMime ?? "application/octet-stream", f.Nom);
        });
        g.MapGet("/flux/{id:long}/chronologie", (long id, ServiceFactureElectronique s, CancellationToken ct) => s.Chronologie(id, null, null, ct));
        g.MapGet("/chronologie", (string type_element, string id_element, ServiceFactureElectronique s, CancellationToken ct) =>
            s.Chronologie(null, type_element, id_element, ct));
        g.MapPost("/flux/{id:long}/tentative", (long id, HttpContext http, ServiceFactureElectronique s, CancellationToken ct) =>
            s.NouvelleTentative(id, Utilisateur.Depuis(http), ct));
        g.MapPost("/flux/{id:long}/depot-manuel", (long id, ConfirmationDepot c, HttpContext http, ServiceFactureElectronique s, CancellationToken ct) =>
            s.ConfirmerDepotManuel(id, c, Utilisateur.Depuis(http), ct));
        g.MapPost("/import", (ImportManuel i, HttpContext http, ServiceFactureElectronique s, CancellationToken ct) =>
            s.Importer(i, Utilisateur.Depuis(http), ct));
        g.MapPost("/releve", (HttpContext http, SpecialisationFactureElectronique sp, ReleveFlux r, CancellationToken ct) =>
        {
            sp.Exiger(Utilisateur.Depuis(http), LogiBTP.Socle.ActionsDroits.Modifier);
            return r.ReleverAsync(true, null, ct);
        });
        g.MapGet("/journal/verification", (ServiceFactureElectronique s, CancellationToken ct) => s.VerifierJournal(ct));
        return api;
    }
}
