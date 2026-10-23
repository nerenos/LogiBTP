using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace LogiBTP.Authentification.Web;

/// <summary>Branchement du module Authentification dans une application ASP.NET Core.</summary>
public static class Extensions
{
    private const string CleSession = "LogiBTP.Session";

    /// <summary>Routes du module accessibles sans session (sous le préfixe /api).</summary>
    private static readonly string[] Publiques = ["/api/auth/connexion", "/api/auth/session", "/api/auth/politique", "/api/auth/test", "/api/auth/oubli",
        "/api/auth/reinitialiser"];

    public static IServiceCollection AddModuleAuthentification<TSpecialisation>(this IServiceCollection services,
        Action<IServiceProvider, DbContextOptionsBuilder> options, IConfiguration configuration)
        where TSpecialisation : SpecialisationAuthentification
    {
        services.Configure<OptionsAuthentification>(configuration);
        services.AddDbContext<AuthDbContext>(options);
        services.AddSingleton<SpecialisationAuthentification, TSpecialisation>();
        services.AddScoped<ServiceAuthentification>();
        services.AddScoped<ServiceComptes>();
        return services;
    }

    /// <summary>Session de la requête (null : aucune).</summary>
    public static SessionLue? Session(this HttpContext http) => http.Items[CleSession] as SessionLue;

    /// <summary>
    /// Intergiciel de session, après UseSocietes : le cookie désigne une session de la base de la société ; l'utilisateur
    /// est posé sur la requête (Utilisateur.Depuis). Sans session : 401 SESSION_REQUISE, sauf routes publiques et mode
    /// EnTetes (développement). Mot de passe provisoire : 403 MDP_A_CHANGER hors des routes de la session.
    /// </summary>
    public static IApplicationBuilder UseAuthentificationSession(this IApplicationBuilder app)
    {
        var o = app.ApplicationServices.GetRequiredService<IOptions<OptionsAuthentification>>().Value;
        var env = app.ApplicationServices.GetRequiredService<IWebHostEnvironment>();
        if ((o.EnTetes || o.ComptesTest) && !env.IsDevelopment())
        {
            throw new InvalidOperationException("Authentification : Mode EnTetes et ComptesTest réservés à l'environnement de développement");
        }
        var publiques = Publiques.Concat(o.RoutesPubliques).ToArray();
        return app.Use(async (http, next) =>
        {
            if (!http.Request.Path.StartsWithSegments("/api") || HttpMethods.IsOptions(http.Request.Method))
            {
                await next(http);
                return;
            }
            var chemin = http.Request.Path;
            var publique = publiques.Any(p => chemin.StartsWithSegments(p, StringComparison.OrdinalIgnoreCase));
            var jeton = http.Request.Cookies[o.NomCookie];
            var service = http.RequestServices.GetRequiredService<ServiceAuthentification>();
            var session = string.IsNullOrEmpty(jeton) ? null : await service.LireSessionAsync(jeton, http.RequestAborted);
            if (session is not null)
            {
                http.Items[CleSession] = session;
                Utilisateur.Poser(http, new Utilisateur(session.Code, session.Profil));
                if (session.MdpAChanger && !publique && !chemin.StartsWithSegments("/api/auth/mot-de-passe") && !chemin.StartsWithSegments("/api/auth/deconnexion"))
                {
                    await Refuser(http, StatusCodes.Status403Forbidden, "MDP_A_CHANGER", "Mot de passe provisoire : changez-le pour continuer");
                    return;
                }
                await next(http);
                return;
            }
            if (!string.IsNullOrEmpty(jeton)) http.Response.Cookies.Delete(o.NomCookie);
            if (publique || o.EnTetes)
            {
                await next(http);
                return;
            }
            await Refuser(http, StatusCodes.Status401Unauthorized, "SESSION_REQUISE", "Connexion requise");
        });
    }

    /// <summary>
    /// Adresse de l'application pour un lien envoyé par courriel : en-tête Origin, sinon l'hôte de la requête, retenu
    /// seulement s'il appartient aux domaines des sociétés (pas de lien vers un hôte imposé par la requête).
    /// </summary>
    public static string AdresseApplication(HttpContext http, OptionsSocietes societes)
    {
        var o = http.Request.Headers.Origin.FirstOrDefault();
        if (string.IsNullOrEmpty(o)) o = $"{http.Request.Scheme}://{http.Request.Host}";
        if (!Uri.TryCreate(o, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")
            || !societes.Domaines.Any(d => uri.Host.Equals(d, StringComparison.OrdinalIgnoreCase) || uri.Host.EndsWith("." + d, StringComparison.OrdinalIgnoreCase)))
        {
            throw ExceptionMetier.Invalide("ADRESSE_INCONNUE", "Adresse de l'application non reconnue");
        }
        return uri.GetLeftPart(UriPartial.Authority);
    }

    private static Task Refuser(HttpContext http, int statut, string code, string titre)
    {
        http.Response.StatusCode = statut;
        return http.Response.WriteAsJsonAsync(new { status = statut, code, title = titre }, JsonCalcul.Options);
    }

    private static void PoserCookie(HttpContext http, OptionsAuthentification o, string jeton, SessionLue s) =>
        http.Response.Cookies.Append(o.NomCookie, jeton, new CookieOptions
        {
            HttpOnly = true, SameSite = SameSiteMode.Strict, Secure = http.Request.IsHttps, Path = "/", IsEssential = true,
            Expires = s.Persistante ? s.ExpireLe : null,
        });

    /// <summary>Routes HTTP du module, sous /auth.</summary>
    public static RouteGroupBuilder MapModuleAuthentification(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/auth");
        static bool Dev(HttpContext http) => http.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment();

        g.MapGet("/session", async (HttpContext http, ServiceAuthentification s, CancellationToken ct) =>
            s.Decrire(http.Session(), await s.ParametresAsync(ct), Dev(http)));
        g.MapGet("/politique", async (HttpContext http, ServiceAuthentification s, SpecialisationAuthentification sp, CancellationToken ct) =>
        {
            var p = await s.ParametresAsync(ct);
            return new
            {
                longueur_min = p.MotDePasse.LongueurMin, courants = p.MotDePasse.Courants, pseudos_reserves = p.PseudosReserves,
                rester_connecte = p.Session.ResterConnecte, oubli_courriel = await sp.ReinitialisationParCourrielAsync(http.RequestServices, ct),
            };
        });
        // Mot de passe oublié : même réponse dans tous les cas (aucune indication sur l'existence du compte).
        g.MapPost("/oubli", async (DemandeOubli d, HttpContext http, ServiceAuthentification s, IOptions<OptionsSocietes> societes, CancellationToken ct) =>
        {
            await s.DemanderReinitialisationAsync(d, AdresseApplication(http, societes.Value), http.RequestServices, ServiceAuthentification.Origine.Depuis(http), ct);
            return Results.Ok(new { message = "Si ce compte existe et a une adresse de courriel, un lien de réinitialisation vient d'y être envoyé (valable 30 minutes)." });
        });
        g.MapPost("/reinitialiser", async (Reinitialisation r, HttpContext http, ServiceAuthentification s, CancellationToken ct) =>
        {
            await s.ReinitialiserAsync(r, ServiceAuthentification.Origine.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapPost("/connexion", async (ConnexionSaisie c, HttpContext http, ServiceAuthentification s, CancellationToken ct) =>
        {
            var (jeton, session) = await s.ConnecterAsync(c, ServiceAuthentification.Origine.Depuis(http), ct);
            PoserCookie(http, s.Options, jeton, session);
            return s.Decrire(session, await s.ParametresAsync(ct), Dev(http));
        });
        g.MapGet("/test/comptes", (HttpContext http, ServiceAuthentification s, CancellationToken ct) => s.ComptesTestAsync(Dev(http), ct));
        g.MapPost("/test/connexion", async (ConnexionSaisie c, HttpContext http, ServiceAuthentification s, CancellationToken ct) =>
        {
            var (jeton, session) = await s.ConnecterTestAsync(c.Identifiant, Dev(http), ServiceAuthentification.Origine.Depuis(http), ct);
            PoserCookie(http, s.Options, jeton, session);
            return s.Decrire(session, await s.ParametresAsync(ct), Dev(http));
        });
        g.MapPost("/deconnexion", async (HttpContext http, ServiceAuthentification s, CancellationToken ct) =>
        {
            if (http.Session() is { } session) await s.DeconnecterAsync(session, ServiceAuthentification.Origine.Depuis(http), ct);
            http.Response.Cookies.Delete(s.Options.NomCookie);
            return Results.NoContent();
        });
        g.MapPost("/mot-de-passe", async (ChangementMotDePasse c, HttpContext http, ServiceAuthentification s, CancellationToken ct) =>
        {
            var session = http.Session() ?? throw new ExceptionMetier(StatusCodes.Status401Unauthorized, "SESSION_REQUISE", "Connexion requise");
            await s.ChangerMotDePasseAsync(session, c, ServiceAuthentification.Origine.Depuis(http), ct);
            return s.Decrire(session with { MdpAChanger = false }, await s.ParametresAsync(ct), Dev(http));
        });

        // Gestion des comptes (administrateur).
        static ServiceAuthentification.Origine O(HttpContext http) => ServiceAuthentification.Origine.Depuis(http);
        g.MapGet("/profils", (SpecialisationAuthentification s) => new { profils = s.Profils, defaut = s.ProfilParDefaut });
        g.MapGet("/comptes", (string? recherche, string? etat, HttpContext http, ServiceComptes s, CancellationToken ct) => s.ListeAsync(recherche, etat, Utilisateur.Depuis(http), ct));
        g.MapGet("/comptes/{id:long}", (long id, HttpContext http, ServiceComptes s, CancellationToken ct) => s.DetailAsync(id, Utilisateur.Depuis(http), ct));
        g.MapPost("/comptes", (CompteSaisi c, HttpContext http, ServiceComptes s, CancellationToken ct) => s.CreerAsync(c, Utilisateur.Depuis(http), O(http), ct));
        g.MapPut("/comptes/{id:long}", (long id, CompteSaisi c, HttpContext http, ServiceComptes s, CancellationToken ct) => s.ModifierAsync(id, c, Utilisateur.Depuis(http), O(http), ct));
        g.MapPost("/comptes/{id:long}/reinitialiser", (long id, HttpContext http, ServiceComptes s, CancellationToken ct) => s.ReinitialiserAsync(id, Utilisateur.Depuis(http), O(http), ct));
        g.MapPost("/comptes/{id:long}/deverrouiller", (long id, HttpContext http, ServiceComptes s, CancellationToken ct) => s.DeverrouillerAsync(id, Utilisateur.Depuis(http), O(http), ct));
        g.MapGet("/personne", (string type, string id, HttpContext http, ServiceComptes s, CancellationToken ct) => s.PersonneAsync(type, id, Utilisateur.Depuis(http), ct));
        g.MapGet("/personnes", (string? recherche, HttpContext http, ServiceComptes s, CancellationToken ct) => s.PersonnesAsync(recherche, Utilisateur.Depuis(http), ct));
        return g;
    }
}
