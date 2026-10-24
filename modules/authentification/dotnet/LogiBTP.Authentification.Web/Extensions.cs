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

    /// <summary>Routes interdites pendant une usurpation (mot de passe, comptes, droits, nouvelle usurpation).</summary>
    private static readonly string[] Interdites = ["/api/auth/mot-de-passe", "/api/auth/comptes", "/api/auth/personne", "/api/auth/personnes",
        "/api/droits/profils", "/api/droits/catalogue", "/api/droits/journal"];

    /// <summary>Routes du module accessibles sans session (sous le préfixe /api).</summary>
    private static readonly string[] Publiques = ["/api/auth/connexion", "/api/auth/session", "/api/auth/politique", "/api/auth/test", "/api/auth/oubli",
        "/api/auth/reinitialiser", "/api/auth/jeton"];

    public static IServiceCollection AddModuleAuthentification<TSpecialisation>(this IServiceCollection services,
        Action<IServiceProvider, DbContextOptionsBuilder> options, IConfiguration configuration)
        where TSpecialisation : SpecialisationAuthentification
    {
        services.Configure<OptionsAuthentification>(configuration);
        services.AddDbContext<AuthDbContext>(options);
        services.AddSingleton<SpecialisationAuthentification, TSpecialisation>();
        services.AddScoped<ServiceAuthentification>();
        services.AddScoped<ServiceComptes>();
        services.AddSingleton<JetonsAcces>();
        return services;
    }

    /// <summary>Session de la requête (null : aucune).</summary>
    public static SessionLue? Session(this HttpContext http) => http.Items[CleSession] as SessionLue;

    /// <summary>
    /// Intergiciel de session, après UseSocietes (D1) : jeton d'accès court (cookie, ou en-tête Bearer d'un identifiant
    /// d'API) vérifié sans lecture de la base ; expiré ou révoqué : le jeton de rafraîchissement du cookie est relu en base
    /// et remplacé (rotation), un nouveau jeton d'accès est posé. L'utilisateur est posé sur la requête
    /// (Utilisateur.Depuis). Sans session : 401 SESSION_REQUISE, sauf routes publiques et mode EnTetes (développement).
    /// Mot de passe provisoire : 403 MDP_A_CHANGER hors des routes de la session.
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
            var jetons = http.RequestServices.GetRequiredService<JetonsAcces>();
            var baseSociete = http.RequestServices.GetRequiredService<SocieteCourante>().Base;
            SessionLue? session;
            var entete = http.Request.Headers.Authorization.ToString();
            if (entete.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            {
                // Identifiant d'API : jeton d'accès seul, renouvelé par /auth/jeton/rafraichir.
                session = jetons.Lire(entete[7..].Trim(), baseSociete, out var api);
                if ((session is null || !api) && !publique)
                {
                    await Refuser(http, StatusCodes.Status401Unauthorized, "JETON_INVALIDE", "Jeton d'accès invalide ou expiré");
                    return;
                }
                if (!api) session = null;
            }
            else
            {
                session = jetons.Lire(http.Request.Cookies[o.NomCookieAcces], baseSociete, out _);
                if (session is null && !string.IsNullOrEmpty(jeton))
                {
                    var (lue, nouveau) = await service.RafraichirAsync(jeton, ServiceAuthentification.Origine.Depuis(http), http.RequestAborted);
                    session = lue;
                    if (lue is not null)
                    {
                        if (nouveau is not null) PoserRafraichissement(http, o, nouveau, lue);
                        PoserAcces(http, o, jetons.Emettre(lue, baseSociete));
                    }
                }
            }
            if (session is not null)
            {
                http.Items[CleSession] = session;
                Utilisateur.Poser(http, session.Utilisateur);
                if (session.Usurpation is not null)
                {
                    // Usurpation : ni mot de passe, ni gestion des comptes et des droits ; chaque écriture est journalisée.
                    if (Interdites.Any(p => chemin.StartsWithSegments(p, StringComparison.OrdinalIgnoreCase)))
                    {
                        await Refuser(http, StatusCodes.Status403Forbidden, "USURPATION_INTERDITE", "Action interdite pendant une usurpation");
                        return;
                    }
                    await next(http);
                    if (!HttpMethods.IsGet(http.Request.Method) && !HttpMethods.IsHead(http.Request.Method) && !chemin.StartsWithSegments("/api/auth/usurper"))
                    {
                        await service.JournaliserActionUsurpeeAsync(session, $"{http.Request.Method} {chemin} → {http.Response.StatusCode}", ServiceAuthentification.Origine.Depuis(http), CancellationToken.None);
                    }
                    return;
                }
                if (session.MdpAChanger && !publique && !chemin.StartsWithSegments("/api/auth/mot-de-passe") && !chemin.StartsWithSegments("/api/auth/deconnexion"))
                {
                    await Refuser(http, StatusCodes.Status403Forbidden, "MDP_A_CHANGER", "Mot de passe provisoire : changez-le pour continuer");
                    return;
                }
                await next(http);
                return;
            }
            if (!string.IsNullOrEmpty(jeton))
            {
                http.Response.Cookies.Delete(o.NomCookie);
                http.Response.Cookies.Delete(o.NomCookieAcces);
            }
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

    private static CookieOptions Cookie(HttpContext http, DateTimeOffset? expire) => new()
    {
        HttpOnly = true, SameSite = SameSiteMode.Strict, Secure = http.Request.IsHttps, Path = "/", IsEssential = true, Expires = expire,
    };

    /// <summary>Jeton de rafraîchissement (cookie de session ; persistant avec « Rester connecté »).</summary>
    private static void PoserRafraichissement(HttpContext http, OptionsAuthentification o, string jeton, SessionLue s) =>
        http.Response.Cookies.Append(o.NomCookie, jeton, Cookie(http, s.Persistante ? s.ExpireLe : null));

    private static void PoserAcces(HttpContext http, OptionsAuthentification o, string jeton) =>
        http.Response.Cookies.Append(o.NomCookieAcces, jeton, Cookie(http, null));

    /// <summary>Session ouverte : jetons de rafraîchissement et d'accès, machine nouvellement connue (cookie de 400 jours).</summary>
    private static void PoserSession(HttpContext http, OptionsAuthentification o, ResultatConnexion r)
    {
        if (r.Jeton is null || r.Session is null) return;
        PoserRafraichissement(http, o, r.Jeton, r.Session);
        PoserAcces(http, o, http.RequestServices.GetRequiredService<JetonsAcces>().Emettre(r.Session, http.RequestServices.GetRequiredService<SocieteCourante>().Base));
        if (r.Machine is not null) http.Response.Cookies.Append(o.NomCookieMachine, r.Machine, Cookie(http, DateTimeOffset.UtcNow.AddDays(400)));
    }

    /// <summary>Réponse d'une connexion : session décrite, ou étape du double facteur (code envoyé).</summary>
    private static async Task<object> RepondreConnexion(HttpContext http, ServiceAuthentification s, ResultatConnexion r, bool dev, CancellationToken ct)
    {
        if (r.Etape is { } e) return new { connecte = false, double_facteur = true, etape = e.Jeton, destination = e.Destination, expire_le = e.ExpireLe };
        PoserSession(http, s.Options, r);
        return s.Decrire(r.Session, await s.ParametresAsync(ct), dev);
    }

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
            await RepondreConnexion(http, s, await s.ConnecterAsync(c, ServiceAuthentification.Origine.Depuis(http), ct), Dev(http), ct));
        // Double facteur (D3) : second temps de la connexion, code reçu par courriel.
        g.MapPost("/connexion/code", async (SaisieCode c, HttpContext http, ServiceAuthentification s, CancellationToken ct) =>
            await RepondreConnexion(http, s, await s.ValiderCodeAsync(c, ServiceAuthentification.Origine.Depuis(http), ct), Dev(http), ct));
        g.MapGet("/test/comptes", (HttpContext http, ServiceAuthentification s, CancellationToken ct) => s.ComptesTestAsync(Dev(http), ct));
        g.MapPost("/test/connexion", async (ConnexionSaisie c, HttpContext http, ServiceAuthentification s, CancellationToken ct) =>
            await RepondreConnexion(http, s, await s.ConnecterTestAsync(c.Identifiant, Dev(http), ServiceAuthentification.Origine.Depuis(http), ct), Dev(http), ct));
        g.MapPost("/deconnexion", async (HttpContext http, ServiceAuthentification s, CancellationToken ct) =>
        {
            if (http.Session() is { } session) await s.DeconnecterAsync(session, ServiceAuthentification.Origine.Depuis(http), ct);
            http.Response.Cookies.Delete(s.Options.NomCookie);
            http.Response.Cookies.Delete(s.Options.NomCookieAcces);
            return Results.NoContent();
        });

        // Identifiants d'API (D15) : jetons par identifiant et secret, rafraîchissement rotatif (routes publiques).
        g.MapPost("/jeton", async (DemandeJeton d, HttpContext http, ServiceAuthentification s, JetonsAcces jetons, SocieteCourante societe, CancellationToken ct) =>
        {
            var (session, rafraichissement) = await s.JetonApiAsync(d, ServiceAuthentification.Origine.Depuis(http), ct);
            return new JetonsApi(jetons.Emettre(session, societe.Base, api: true), rafraichissement, (int)JetonsAcces.DureeApi.TotalSeconds);
        });
        g.MapPost("/jeton/rafraichir", async (DemandeRafraichissement d, HttpContext http, ServiceAuthentification s, JetonsAcces jetons, SocieteCourante societe, CancellationToken ct) =>
        {
            var (session, nouveau) = string.IsNullOrEmpty(d.Rafraichissement) ? (null, null)
                : await s.RafraichirAsync(d.Rafraichissement, ServiceAuthentification.Origine.Depuis(http), ct);
            if (session is null) throw new ExceptionMetier(StatusCodes.Status401Unauthorized, "JETON_INVALIDE", "Jeton de rafraîchissement invalide ou expiré");
            return new JetonsApi(jetons.Emettre(session, societe.Base, api: true), nouveau ?? d.Rafraichissement!, (int)JetonsAcces.DureeApi.TotalSeconds);
        });

        // Mes sessions et mes machines connues (déconnexion à distance), double facteur choisi.
        static SessionLue Courante(HttpContext http) => http.Session() ?? throw new ExceptionMetier(StatusCodes.Status401Unauthorized, "SESSION_REQUISE", "Connexion requise");
        g.MapGet("/sessions", async (HttpContext http, ServiceAuthentification s, CancellationToken ct) => new
        {
            sessions = await s.SessionsAsync(Courante(http).CptId, Courante(http).SesId, ct),
            machines = await s.MachinesAsync(Courante(http).CptId, ct),
            double_facteur = await s.DoubleFacteurChoisiAsync(Courante(http).CptId, ct),
        });
        g.MapDelete("/sessions", async (HttpContext http, ServiceAuthentification s, CancellationToken ct) =>
        {
            await s.FermerSessionsAsync(Courante(http).CptId, null, Courante(http).SesId, ServiceAuthentification.Origine.Depuis(http), Courante(http).Code, ct);
            return Results.NoContent();
        });
        g.MapDelete("/sessions/{id:guid}", async (Guid id, HttpContext http, ServiceAuthentification s, CancellationToken ct) =>
        {
            await s.FermerSessionsAsync(Courante(http).CptId, id, Courante(http).SesId, ServiceAuthentification.Origine.Depuis(http), Courante(http).Code, ct);
            return Results.NoContent();
        });
        g.MapDelete("/machines/{id:guid}", async (Guid id, HttpContext http, ServiceAuthentification s, CancellationToken ct) =>
        {
            await s.RevoquerMachineAsync(Courante(http).CptId, id, ServiceAuthentification.Origine.Depuis(http), Courante(http).Code, ct);
            return Results.NoContent();
        });
        g.MapPut("/double-facteur", async (ChoixDoubleFacteur d, HttpContext http, ServiceAuthentification s, CancellationToken ct) =>
        {
            await s.ChoisirDoubleFacteurAsync(Courante(http).CptId, d.Actif, ServiceAuthentification.Origine.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapPost("/mot-de-passe", async (ChangementMotDePasse c, HttpContext http, ServiceAuthentification s, CancellationToken ct) =>
        {
            var session = http.Session() ?? throw new ExceptionMetier(StatusCodes.Status401Unauthorized, "SESSION_REQUISE", "Connexion requise");
            await s.ChangerMotDePasseAsync(session, c, ServiceAuthentification.Origine.Depuis(http), ct);
            return s.Decrire(session with { MdpAChanger = false }, await s.ParametresAsync(ct), Dev(http));
        });

        // Usurpation (administrateur) : agir pour un autre compte, puis terminer.
        g.MapPost("/usurper", async (DemandeUsurpation d, HttpContext http, ServiceAuthentification s, CancellationToken ct) =>
        {
            var session = http.Session() ?? throw new ExceptionMetier(StatusCodes.Status401Unauthorized, "SESSION_REQUISE", "Connexion requise");
            return s.Decrire(await s.UsurperAsync(session, d, http.RequestServices, ServiceAuthentification.Origine.Depuis(http), ct), await s.ParametresAsync(ct), Dev(http));
        });
        g.MapPost("/usurper/fin", async (HttpContext http, ServiceAuthentification s, CancellationToken ct) =>
        {
            var session = http.Session() ?? throw new ExceptionMetier(StatusCodes.Status401Unauthorized, "SESSION_REQUISE", "Connexion requise");
            return s.Decrire(await s.TerminerUsurpationAsync(session, ServiceAuthentification.Origine.Depuis(http), ct), await s.ParametresAsync(ct), Dev(http));
        });

        // Gestion des comptes (administrateur).
        static ServiceAuthentification.Origine O(HttpContext http) => ServiceAuthentification.Origine.Depuis(http);
        g.MapGet("/profils", async (SpecialisationAuthentification s, HttpContext http, CancellationToken ct) =>
            new { profils = await s.ProfilsAsync(http.RequestServices, ct), defaut = s.ProfilParDefaut });
        g.MapGet("/comptes", (string? recherche, string? etat, HttpContext http, ServiceComptes s, CancellationToken ct) => s.ListeAsync(recherche, etat, Utilisateur.Depuis(http), ct));
        g.MapGet("/comptes/{id:long}", (long id, HttpContext http, ServiceComptes s, CancellationToken ct) => s.DetailAsync(id, Utilisateur.Depuis(http), ct));
        g.MapPost("/comptes", (CompteSaisi c, HttpContext http, ServiceComptes s, CancellationToken ct) => s.CreerAsync(c, Utilisateur.Depuis(http), O(http), ct));
        g.MapPut("/comptes/{id:long}", (long id, CompteSaisi c, HttpContext http, ServiceComptes s, CancellationToken ct) => s.ModifierAsync(id, c, Utilisateur.Depuis(http), O(http), ct));
        g.MapPost("/comptes/{id:long}/reinitialiser", (long id, HttpContext http, ServiceComptes s, CancellationToken ct) => s.ReinitialiserAsync(id, Utilisateur.Depuis(http), O(http), ct));
        // Sessions et machines d'un compte (administrateur), identifiants d'API, adresses exclues.
        g.MapDelete("/comptes/{id:long}/sessions", async (long id, HttpContext http, ServiceAuthentification s, CancellationToken ct) =>
        {
            if (!Utilisateur.Depuis(http).EstAdmin) throw ExceptionMetier.AccesRefuse("GERER_COMPTES");
            await s.FermerSessionsAsync(id, null, null, O(http), Utilisateur.Depuis(http).Code, ct);
            return Results.NoContent();
        });
        g.MapDelete("/comptes/{id:long}/machines/{machine:guid}", async (long id, Guid machine, HttpContext http, ServiceAuthentification s, CancellationToken ct) =>
        {
            if (!Utilisateur.Depuis(http).EstAdmin) throw ExceptionMetier.AccesRefuse("GERER_COMPTES");
            await s.RevoquerMachineAsync(id, machine, O(http), Utilisateur.Depuis(http).Code, ct);
            return Results.NoContent();
        });
        g.MapPost("/comptes-api", (CompteApiSaisi c, HttpContext http, ServiceAuthentification s, CancellationToken ct) => s.CreerApiAsync(c, Utilisateur.Depuis(http), O(http), ct));
        g.MapPost("/comptes-api/{id:long}/secret", (long id, HttpContext http, ServiceAuthentification s, CancellationToken ct) => s.NouveauSecretAsync(id, Utilisateur.Depuis(http), O(http), ct));
        g.MapPut("/comptes-api/{id:long}/adresses", async (long id, CompteApiSaisi c, HttpContext http, ServiceAuthentification s, CancellationToken ct) =>
        {
            await s.ModifierAdressesApiAsync(id, c.Adresses, Utilisateur.Depuis(http), O(http), ct);
            return Results.NoContent();
        });
        g.MapGet("/exclusions", (HttpContext http, ServiceAuthentification s, CancellationToken ct) => s.ExclusionsAsync(Utilisateur.Depuis(http), ct));
        g.MapPost("/exclusions/{id:long}/lever", async (long id, HttpContext http, ServiceAuthentification s, CancellationToken ct) =>
        {
            await s.LeverExclusionAsync(id, Utilisateur.Depuis(http), O(http), ct);
            return Results.NoContent();
        });
        g.MapPost("/comptes/{id:long}/deverrouiller", (long id, HttpContext http, ServiceComptes s, CancellationToken ct) => s.DeverrouillerAsync(id, Utilisateur.Depuis(http), O(http), ct));
        g.MapGet("/personne", (string type, string id, HttpContext http, ServiceComptes s, CancellationToken ct) => s.PersonneAsync(type, id, Utilisateur.Depuis(http), ct));
        g.MapGet("/personnes", (string? recherche, HttpContext http, ServiceComptes s, CancellationToken ct) => s.PersonnesAsync(recherche, Utilisateur.Depuis(http), ct));
        return g;
    }
}
