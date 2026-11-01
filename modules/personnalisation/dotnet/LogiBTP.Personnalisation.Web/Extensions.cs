using LogiBTP.Socle;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Personnalisation.Web;

public static class Extensions
{
    /// <summary>Adresse des fichiers servis (même valeur que ADRESSE_PERSONNALISATION de @logibtp/socle/dictionnaire).</summary>
    public const string Adresse = "/personnalisation";

    /// <summary>
    /// Dossier de la personnalisation de l'installation : Personnalisation:Dossier, sinon LOGIBTP_PERSONNALISATION, sinon
    /// {LOGIBTP_CONFIG}/personnalisation (volume de configuration de l'image Docker), sinon personnalisation/ à côté de l'API.
    /// </summary>
    public static string DossierInstallation(IConfiguration configuration, string racineContenu) =>
        configuration["Personnalisation:Dossier"] is { Length: > 0 } d ? d
        : Environment.GetEnvironmentVariable(VariablesEnv.Personnalisation) is { Length: > 0 } e ? e
        : Environment.GetEnvironmentVariable(VariablesEnv.Config) is { Length: > 0 } c ? Path.Combine(c, "personnalisation")
        : Path.Combine(racineContenu, "personnalisation");

    /// <summary>
    /// Sert /personnalisation/* (fr.json, theme.css, images/) composés avec la surcharge de l'installation, avant les
    /// fichiers statiques du client (ClientWeb) : relus à chaque chargement (no-cache + ETag), servis sans session (page
    /// de connexion, borne). Sans client construit (développement : Vite sert la personnalisation), rien n'est ajouté.
    /// </summary>
    public static IApplicationBuilder UsePersonnalisation(this IApplicationBuilder app)
    {
        var env = app.ApplicationServices.GetRequiredService<IWebHostEnvironment>();
        var programme = env.WebRootPath is { } w ? Path.Combine(w, "personnalisation") : null;
        if (programme is null || !Directory.Exists(programme)) return app;
        var configuration = app.ApplicationServices.GetRequiredService<IConfiguration>();
        var fichiers = new FichiersPersonnalisation(programme, DossierInstallation(configuration, env.ContentRootPath));
        return app.Use(async (http, next) =>
        {
            var r = http.Request;
            if (!(HttpMethods.IsGet(r.Method) || HttpMethods.IsHead(r.Method)) || !r.Path.StartsWithSegments(Adresse, out var reste))
            {
                await next(http);
                return;
            }
            var f = fichiers.Lire(reste.Value ?? "");
            if (f is null)
            {
                http.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }
            var h = http.Response.Headers;
            h.CacheControl = "no-cache";
            h.ETag = f.Empreinte;
            h.XContentTypeOptions = "nosniff";
            if (r.Headers.IfNoneMatch.Contains(f.Empreinte))
            {
                http.Response.StatusCode = StatusCodes.Status304NotModified;
                return;
            }
            http.Response.ContentType = f.Type;
            http.Response.ContentLength = f.Contenu.Length;
            if (HttpMethods.IsGet(r.Method)) await http.Response.Body.WriteAsync(f.Contenu);
        });
    }
}
