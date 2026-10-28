using System.Net;
using System.Security.Cryptography.X509Certificates;
using LogiBTP.Socle;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Server.Kestrel.Https;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Installation.Web;

/// <summary>
/// Certificat du serveur lu dans le dossier des certificats (volume logibtp-certificats) et rechargé à chaud : son
/// renouvellement (fichier serveur.crt remplacé) est pris en compte sans redémarrer l'API (relecture au plus toutes
/// les 30 secondes, à la première poignée de main qui suit).
/// </summary>
public sealed class CertificatServeur(DossierCertificats dossier)
{
    private readonly Lock verrou = new();
    private X509Certificate2? courant;
    private DateTime lu = DateTime.MinValue;
    private DateTime controle = DateTime.MinValue;

    public DossierCertificats Dossier { get; } = dossier;

    /// <summary>HTTPS actif : certificat et clé présents au démarrage.</summary>
    public bool Actif { get; } = dossier.Present;

    public X509Certificate2? Courant()
    {
        lock (verrou)
        {
            var maintenant = DateTime.UtcNow;
            if (courant is not null && maintenant - controle < TimeSpan.FromSeconds(30)) return courant;
            controle = maintenant;
            if (!Dossier.Present) return courant;
            var modifie = File.GetLastWriteTimeUtc(Dossier.Certificat);
            if (courant is not null && modifie == lu) return courant;
            using var pem = X509Certificate2.CreateFromPemFile(Dossier.Certificat, Dossier.Cle);
            // Ré-import PKCS#12 : clé utilisable par SslStream sur toutes les plateformes.
            courant = X509CertificateLoader.LoadPkcs12(pem.Export(X509ContentType.Pkcs12), null);
            lu = modifie;
            return courant;
        }
    }

    /// <summary>Fin de validité du certificat chargé (null sans HTTPS).</summary>
    public DateTimeOffset? Fin => Actif ? Courant()?.NotAfter : null;
}

/// <summary>
/// HTTPS de l'installation (ANALYSE-MODULE-INSTALLATION.md § 3.1, 5.6) : avec un certificat dans le dossier
/// LOGIBTP_CERTIFICATS, Kestrel écoute en HTTPS sur 8443 et en HTTP sur 8080 ; le HTTP ne sert que la redirection vers
/// HTTPS et la page d'amorçage du certificat (et la santé interrogée par le conteneur lui-même). Sans certificat
/// (développement, lot sans HTTPS), rien ne change.
/// </summary>
public static class ExtensionsHttpsInstallation
{
    public const int PortHttp = 8080;
    public const int PortHttps = 8443;

    public static WebApplicationBuilder AddHttpsInstallation(this WebApplicationBuilder builder)
    {
        var dossier = new DossierCertificats(Environment.GetEnvironmentVariable(VariablesEnv.Certificats)
            ?? Path.Combine(builder.Environment.ContentRootPath, "certificats"));
        var certificat = new CertificatServeur(dossier);
        builder.Services.AddSingleton(dossier);
        builder.Services.AddSingleton(certificat);
        if (certificat.Actif)
        {
            builder.WebHost.ConfigureKestrel(k =>
            {
                k.ListenAnyIP(PortHttp);
                k.ListenAnyIP(PortHttps, l => l.UseHttps(new HttpsConnectionAdapterOptions { ServerCertificateSelector = (_, _) => certificat.Courant() }));
            });
        }
        return builder;
    }

    /// <summary>
    /// Redirection permanente (308) du HTTP vers HTTPS, sauf la page d'amorçage (/certificat) et la santé demandée
    /// depuis le conteneur ; l'hôte de destination est celui de la requête s'il relève du domaine de l'installation
    /// (LOGIBTP_DOMAINE), sinon le domaine lui-même (pas de redirection vers un hôte arbitraire).
    /// </summary>
    public static IApplicationBuilder UseHttpsInstallation(this IApplicationBuilder app)
    {
        var certificat = app.ApplicationServices.GetRequiredService<CertificatServeur>();
        if (!certificat.Actif) return app;
        var config = app.ApplicationServices.GetRequiredService<Microsoft.Extensions.Configuration.IConfiguration>();
        var domaine = config[VariablesEnv.Domaine]?.Trim().ToLowerInvariant();
        var port = int.TryParse(config[VariablesEnv.PortHttpsPublic], out var p) ? p : 443;
        return app.Use(async (http, next) =>
        {
            var chemin = http.Request.Path;
            if (http.Request.IsHttps || chemin.StartsWithSegments("/certificat")
                || (chemin.StartsWithSegments("/api/sante") && http.Connection.RemoteIpAddress is { } ip && IPAddress.IsLoopback(ip)))
            {
                await next(http);
                return;
            }
            var hote = DestinationRedirection(http.Request.Host.Host, domaine);
            if (hote is null)
            {
                http.Response.StatusCode = StatusCodes.Status400BadRequest;
                return;
            }
            http.Response.StatusCode = StatusCodes.Status308PermanentRedirect;
            http.Response.Headers.Location = $"https://{hote}{(port == 443 ? "" : ":" + port)}{http.Request.PathBase}{chemin}{http.Request.QueryString}";
        });
    }

    /// <summary>Hôte de la redirection : celui de la requête s'il est le domaine ou l'un de ses sous-domaines, sinon le domaine.</summary>
    public static string? DestinationRedirection(string? hote, string? domaine)
    {
        var h = (hote ?? "").Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(domaine)) return string.IsNullOrEmpty(h) ? null : h;
        return h == domaine || h.EndsWith("." + domaine, StringComparison.Ordinal) ? h : domaine;
    }
}
