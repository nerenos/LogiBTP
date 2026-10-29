using System.Net;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace LogiBTP.OAuth.Web;

public sealed record DemandeAutorisation(bool AutreCompte = false);

/// <summary>Branchement du module OAuth.</summary>
public static class Extensions
{
    /// <summary>Route de retour des fournisseurs, publique (sans session) : le state désigne la société et la demande.</summary>
    public const string RouteRetour = "/api/oauth/retour";

    public static IServiceCollection AddModuleOAuth<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options,
        IConfiguration section) where TSpecialisation : SpecialisationOAuth
    {
        services.Configure<OptionsOAuth>(section);
        services.AddDbContext<OAuthDbContext>(options);
        services.AddHttpClient<ClientOAuth>(h => h.Timeout = TimeSpan.FromSeconds(30));
        services.AddScoped<SpecialisationOAuth, TSpecialisation>();
        services.AddScoped<ServiceOAuth>();
        services.AddScoped<IFournisseurJeton>(sp => sp.GetRequiredService<ServiceOAuth>());
        services.TryAddSingleton(TimeProvider.System);
        services.AddSingleton<RenouvellementOAuth>();
        services.AddHostedService(sp => sp.GetRequiredService<RenouvellementOAuth>());
        return services;
    }

    /// <summary>Routes HTTP du module, sous /oauth.</summary>
    public static RouteGroupBuilder MapModuleOAuth(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/oauth");
        g.MapGet("/fournisseurs", (ServiceOAuth s, CancellationToken ct) => s.FournisseursAsync(ct));
        g.MapGet("/connexions", (HttpContext http, ServiceOAuth s, CancellationToken ct) => s.ListeAsync(Utilisateur.Depuis(http), ct));
        g.MapGet("/alertes", (HttpContext http, ServiceOAuth s, CancellationToken ct) => s.AlertesAsync(Utilisateur.Depuis(http), ct));
        g.MapPost("/connexions", (SaisieConnexion c, HttpContext http, ServiceOAuth s, CancellationToken ct) => s.CreerAsync(Utilisateur.Depuis(http), c, ct));
        g.MapGet("/connexions/{id:long}", (long id, HttpContext http, ServiceOAuth s, CancellationToken ct) => s.DetailAsync(Utilisateur.Depuis(http), id, ct));
        g.MapPut("/connexions/{id:long}", (long id, SaisieConnexion c, HttpContext http, ServiceOAuth s, CancellationToken ct) => s.ModifierAsync(Utilisateur.Depuis(http), id, c, ct));
        g.MapDelete("/connexions/{id:long}", async (long id, HttpContext http, ServiceOAuth s, CancellationToken ct) =>
        {
            await s.SupprimerAsync(Utilisateur.Depuis(http), id, ct);
            return Results.NoContent();
        });
        g.MapPost("/connexions/{id:long}/client", (long id, SaisieClient c, HttpContext http, ServiceOAuth s, CancellationToken ct) =>
            s.EnregistrerClientAsync(Utilisateur.Depuis(http), id, c, ct));
        g.MapPost("/connexions/{id:long}/autoriser", async (long id, DemandeAutorisation d, HttpContext http, ServiceOAuth s, IOptions<OptionsSocietes> societes,
            SocieteCourante societe, CancellationToken ct) =>
            Results.Ok(new { url = await s.AutoriserAsync(Utilisateur.Depuis(http), id, Origine(http, societes.Value, societe), d.AutreCompte, ct) }));
        g.MapPost("/connexions/{id:long}/connecter", (long id, HttpContext http, ServiceOAuth s, CancellationToken ct) => s.ConnecterAsync(Utilisateur.Depuis(http), id, ct));
        g.MapPost("/connexions/{id:long}/tester", (long id, HttpContext http, ServiceOAuth s, CancellationToken ct) => s.TesterAsync(Utilisateur.Depuis(http), id, ct));
        g.MapPost("/connexions/{id:long}/revoquer", (long id, HttpContext http, ServiceOAuth s, CancellationToken ct) => s.RevoquerAsync(Utilisateur.Depuis(http), id, ct));
        g.MapGet("/connexions/{id:long}/compte", async (long id, HttpContext http, ServiceOAuth s, CancellationToken ct) =>
            Results.Ok(new { compte = await s.CompteAsync(Utilisateur.Depuis(http), id, ct) }));
        g.MapGet("/connexions/{id:long}/journal", (long id, HttpContext http, ServiceOAuth s, CancellationToken ct) => s.JournalAsync(Utilisateur.Depuis(http), id, ct));
        // Adresse de retour à déclarer chez les fournisseurs (commune à l'installation) et délais de rappel globaux.
        g.MapGet("/parametres", async (ServiceOAuth s, IOptions<OptionsOAuth> o, CancellationToken ct) =>
            Results.Ok(new { rappels_jours = await s.RappelsGlobauxAsync(ct), adresse_retour = o.Value.AdresseRetour }));
        g.MapPut("/parametres", async (ParametresOAuth p, HttpContext http, ServiceOAuth s, CancellationToken ct) =>
            Results.Ok(new { rappels_jours = await s.EnregistrerRappelsGlobauxAsync(Utilisateur.Depuis(http), p.RappelsJours ?? [], ct) }));
        // Passage de fond immédiat sur la base courante (administrateur) : contrôle et démonstration.
        g.MapPost("/passer", async (HttpContext http, ServiceOAuth s, CancellationToken ct) =>
        {
            Utilisateur.Depuis(http).ExigerAdmin();
            await s.PasserAsync(ct);
            return Results.NoContent();
        });
        // Retour du fournisseur : adresse commune ; la société est lue dans le state, la fenêtre renvoyée vers son application.
        g.MapGet("/retour", async (string? state, string? code, string? error, IServiceProvider sp, IOptions<OptionsSocietes> societes, CancellationToken ct) =>
        {
            SocieteCourante? cible;
            try
            {
                var codeSociete = ReglesOAuth.SocieteDuState(state);
                cible = societes.Value.Societes().FirstOrDefault(x => string.Equals(x.Code, codeSociete, StringComparison.OrdinalIgnoreCase));
            }
            catch (FormatException)
            {
                cible = null;
            }
            if (cible is null) return Page("Demande d'autorisation invalide.");
            await using var portee = sp.CreerPorteeSociete(cible);
            var r = await portee.ServiceProvider.GetRequiredService<ServiceOAuth>().TerminerAsync(state!, code, error, ct);
            if (r.Origine is null) return Page(r.Message);
            var requete = $"id={r.Connexion}&oauth={(r.Ok ? "ok" : "erreur")}&message={Uri.EscapeDataString(r.Message)}";
            return Results.Redirect($"{r.Origine.TrimEnd('/')}/parametres/connexions?{requete}");
        });
        return g;
    }

    public sealed record ParametresOAuth(int[]? RappelsJours);

    /// <summary>
    /// Adresse de l'application de la société qui demande l'autorisation (en-tête Origin, sinon l'hôte de la requête) ;
    /// refusée si elle ne désigne pas la société courante (pas de redirection ouverte au retour).
    /// </summary>
    public static string Origine(HttpContext http, OptionsSocietes societes, SocieteCourante societe)
    {
        var o = http.Request.Headers.Origin.FirstOrDefault();
        if (string.IsNullOrEmpty(o)) o = $"{http.Request.Scheme}://{http.Request.Host}";
        if (!Uri.TryCreate(o, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")
            || !societes.Domaines.Any(d => uri.Host.Equals(d, StringComparison.OrdinalIgnoreCase) || uri.Host.EndsWith("." + d, StringComparison.OrdinalIgnoreCase))
            || !string.Equals(ExtensionsSocietes.SousDomaine(uri.Host, societes.Domaines), societe.Code, StringComparison.OrdinalIgnoreCase))
        {
            throw ExceptionMetier.Invalide("OAUTH_ORIGINE", "Adresse de l'application non reconnue pour cette société");
        }
        return uri.GetLeftPart(UriPartial.Authority);
    }

    private static IResult Page(string message) => Results.Content(
        $"<!doctype html><meta charset=\"utf-8\"><title>Connexion</title><p>{WebUtility.HtmlEncode(message)}</p><p>Vous pouvez fermer cette fenêtre.</p>",
        "text/html; charset=utf-8");
}
