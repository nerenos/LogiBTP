using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;

namespace LogiBTP.Socle.Web;

/// <summary>
/// Client web construit (Vite : wwwroot de l'API dans l'image Docker, ANALYSE-MODULE-INSTALLATION.md § 3.1) servi par
/// l'API : fichiers à empreinte gardés un an en cache, index.html jamais, politique de sécurité du contenu bloquante
/// sur les pages (option C, ANALYSE-MODULE-DROITS.md § 10.4), toute adresse hors /api renvoyée vers index.html
/// (routes du client). Sans dossier wwwroot (développement : Vite sert le client), rien n'est ajouté.
/// </summary>
public static class ClientWeb
{
    /// <summary>Même politique que client/vite.config.js (test d'alignement LogiBTP.Installation.Tests).</summary>
    public static readonly string Csp = string.Join("; ",
        "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:",
        "connect-src 'self' ws: wss:", "frame-src 'self' blob:", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "form-action 'self'",
        "frame-ancestors 'self'");

    private static bool Present(IWebHostEnvironment env) => env.WebRootPath is { } d && File.Exists(Path.Combine(d, "index.html"));

    public static IApplicationBuilder UseClientWeb(this IApplicationBuilder app)
    {
        var env = app.ApplicationServices.GetRequiredService<IWebHostEnvironment>();
        if (!Present(env)) return app;
        app.UseDefaultFiles();
        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = new PhysicalFileProvider(env.WebRootPath),
            OnPrepareResponse = c => Entetes(c.Context, c.File.Name),
        });
        return app;
    }

    /// <summary>Routes du client : toute adresse GET hors /api et hors fichier renvoie index.html.</summary>
    public static IEndpointRouteBuilder MapClientWeb(this IEndpointRouteBuilder routes)
    {
        var env = routes.ServiceProvider.GetRequiredService<IWebHostEnvironment>();
        if (!Present(env)) return routes;
        var index = Path.Combine(env.WebRootPath, "index.html");
        routes.MapMethods("{*chemin:nonfile}", [HttpMethods.Get, HttpMethods.Head], (HttpContext http, string? chemin) =>
        {
            if (chemin is not null && (chemin == "api" || chemin.StartsWith("api/", StringComparison.Ordinal))) return Results.NotFound();
            Entetes(http, "index.html");
            return Results.File(index, "text/html; charset=utf-8");
        }).WithOrder(int.MaxValue);
        return routes;
    }

    private static void Entetes(HttpContext http, string fichier)
    {
        var h = http.Response.Headers;
        if (fichier.EndsWith(".html", StringComparison.OrdinalIgnoreCase))
        {
            h.CacheControl = "no-cache";
            h.ContentSecurityPolicy = Csp;
        }
        else if (http.Request.Path.StartsWithSegments("/assets")) h.CacheControl = "public, max-age=31536000, immutable";
    }
}
