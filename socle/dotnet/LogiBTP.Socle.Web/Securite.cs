using System.Net;
using System.Net.Sockets;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using IPNetwork = System.Net.IPNetwork;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Socle.Web;

/// <summary>
/// Réglages de sécurité de l'installation (.env, ANALYSE-MODULE-DROITS.md § 10) : déploiement LOCAL ou INTERNET (D29),
/// origines CORS permises (vide : même origine seulement), proxys inverses déclarés (seuls crus pour X-Forwarded-*),
/// adresses de confiance (réseau local, serveur TSE : CIDR).
/// </summary>
public sealed class OptionsSecurite
{
    public string Deploiement { get; set; } = "LOCAL";
    public List<string> OriginesCors { get; set; } = [];
    public List<string> Proxys { get; set; } = [];
    public List<string> AdressesConfiance { get; set; } = [];
    public bool Internet => string.Equals(Deploiement, "INTERNET", StringComparison.OrdinalIgnoreCase);

    private static List<string> Liste(string? v) => (v ?? "").Split([',', ';', ' '], StringSplitOptions.RemoveEmptyEntries).ToList();

    /// <summary>Variables LOGIBTP_DEPLOIEMENT, LOGIBTP_CORS_ORIGINES, LOGIBTP_PROXYS, LOGIBTP_ADRESSES_CONFIANCE (listes séparées par des virgules).</summary>
    public static OptionsSecurite Lire(IConfiguration c) => new()
    {
        Deploiement = string.IsNullOrWhiteSpace(c["LOGIBTP_DEPLOIEMENT"]) ? "LOCAL" : c["LOGIBTP_DEPLOIEMENT"]!.Trim().ToUpperInvariant(),
        OriginesCors = Liste(c["LOGIBTP_CORS_ORIGINES"]),
        Proxys = Liste(c["LOGIBTP_PROXYS"]),
        AdressesConfiance = Liste(c["LOGIBTP_ADRESSES_CONFIANCE"]),
    };

    /// <summary>Adresse comprise dans les adresses de confiance (CIDR ; adresse seule = /32 ou /128).</summary>
    public bool DeConfiance(IPAddress? ip)
    {
        if (ip is null) return false;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        foreach (var p in AdressesConfiance)
        {
            var t = p.Contains('/') ? p : p + (p.Contains(':') ? "/128" : "/32");
            if (IPNetwork.TryParse(t, out var reseau) && reseau.Contains(ip)) return true;
        }
        return false;
    }
}

/// <summary>
/// Protections web communes (§ 10.2) : en-têtes transmis par les proxys déclarés seulement, en-têtes de sécurité
/// (nosniff, Referrer-Policy, Permissions-Policy, frame-ancestors, HSTS sur internet), CORS paramétré, refus des
/// écritures d'une autre origine (sous-domaines = même site pour le navigateur), limites de débit (D33).
/// </summary>
public static class ExtensionsSecurite
{
    public static IServiceCollection AddSecurite(this IServiceCollection services, OptionsSecurite o)
    {
        services.AddSingleton(o);
        services.Configure<ForwardedHeadersOptions>(f =>
        {
            f.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
            f.KnownProxies.Clear();
            f.KnownIPNetworks.Clear();
            foreach (var p in o.Proxys)
            {
                if (p.Contains('/') && IPNetwork.TryParse(p, out var reseau)) f.KnownIPNetworks.Add(reseau);
                else if (IPAddress.TryParse(p, out var ip)) f.KnownProxies.Add(ip);
            }
            f.ForwardLimit = 1;
        });
        services.AddCors(c => c.AddDefaultPolicy(p =>
        {
            if (o.OriginesCors.Count > 0) p.WithOrigins([.. o.OriginesCors]).AllowAnyHeader().AllowAnyMethod().AllowCredentials();
        }));
        services.AddRateLimiter(r =>
        {
            r.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            r.OnRejected = async (contexte, ct) =>
            {
                if (contexte.Lease.TryGetMetadata(MetadataName.RetryAfter, out var attente))
                {
                    contexte.HttpContext.Response.Headers.RetryAfter = ((int)attente.TotalSeconds).ToString();
                }
                await contexte.HttpContext.Response.WriteAsJsonAsync(new { status = 429, code = "TROP_DE_REQUETES", title = "Trop de requêtes : réessayez dans un instant" }, ct);
            };
            r.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(http => LimiteDebit.Partition(http, o));
        });
        return services;
    }

    /// <summary>À placer en tête du pipeline : proxys, en-têtes, CORS, origine des écritures, débit.</summary>
    public static IApplicationBuilder UseSecurite(this IApplicationBuilder app)
    {
        var o = app.ApplicationServices.GetRequiredService<OptionsSecurite>();
        app.UseForwardedHeaders();
        app.Use(async (http, next) =>
        {
            http.Response.OnStarting(() =>
            {
                var h = http.Response.Headers;
                if (!h.ContainsKey("X-Content-Type-Options")) h.XContentTypeOptions = "nosniff";
                h["Referrer-Policy"] = "same-origin";
                h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";
                if (!h.ContainsKey("Content-Security-Policy")) h.ContentSecurityPolicy = "frame-ancestors 'self'";
                if (o.Internet && http.Request.IsHttps) h.StrictTransportSecurity = "max-age=31536000";
                return Task.CompletedTask;
            });
            if (!OrigineAcceptee(http, o))
            {
                http.Response.StatusCode = StatusCodes.Status403Forbidden;
                await http.Response.WriteAsJsonAsync(new { status = 403, code = "ORIGINE_REFUSEE", title = "Requête d'une autre origine refusée" }, JsonCalcul.Options);
                return;
            }
            await next(http);
        });
        app.UseCors();
        app.UseRateLimiter();
        return app;
    }

    /// <summary>
    /// Écriture sur /api : en-tête Origin absent (client hors navigateur) ou égal à l'hôte de la requête, ou origine CORS
    /// permise ; une requête marquée cross-site par le navigateur (Sec-Fetch-Site) est refusée.
    /// </summary>
    public static bool OrigineAcceptee(HttpContext http, OptionsSecurite o)
    {
        var m = http.Request.Method;
        if (!http.Request.Path.StartsWithSegments("/api") || HttpMethods.IsGet(m) || HttpMethods.IsHead(m) || HttpMethods.IsOptions(m)) return true;
        var origine = http.Request.Headers.Origin.FirstOrDefault();
        if (!string.IsNullOrEmpty(origine))
        {
            if (o.OriginesCors.Contains(origine, StringComparer.OrdinalIgnoreCase)) return true;
            return Uri.TryCreate(origine, UriKind.Absolute, out var u) && string.Equals(u.Authority, http.Request.Host.Value, StringComparison.OrdinalIgnoreCase);
        }
        return http.Request.Headers["Sec-Fetch-Site"].FirstOrDefault() is not "cross-site";
    }
}

/// <summary>
/// Limites de débit (D33) : partition par route et par client (session, jeton Bearer, appareil de la borne, sinon
/// adresse ; une adresse de confiance n'est jamais limitée sur la connexion : TSE partagé).
/// </summary>
public static class LimiteDebit
{
    private static string Adresse(HttpContext http) => http.Connection.RemoteIpAddress?.ToString() ?? "?";

    /// <summary>Client de la requête : session (cookie), jeton Bearer, sinon adresse (empreinte courte, jamais la valeur).</summary>
    private static string Client(HttpContext http)
    {
        var bearer = http.Request.Headers.Authorization.ToString();
        var session = http.Request.Cookies["logibtp_session"];
        var valeur = bearer.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? "b:" + bearer : session is { Length: > 0 } ? "s:" + session : null;
        return valeur is null ? "ip:" + Adresse(http) : Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(valeur)))[..24];
    }

    private static RateLimitPartition<string> Fenetre(string cle, int nombre, TimeSpan periode) =>
        RateLimitPartition.GetFixedWindowLimiter(cle, _ => new FixedWindowRateLimiterOptions { PermitLimit = nombre, Window = periode, QueueLimit = 0 });

    public static RateLimitPartition<string> Partition(HttpContext http, OptionsSecurite o)
    {
        var p = http.Request.Path;
        if (!p.StartsWithSegments("/api") || p.StartsWithSegments("/api/sante")) return RateLimitPartition.GetNoLimiter("libre");
        var confiance = o.DeConfiance(http.Connection.RemoteIpAddress);
        if (p.StartsWithSegments("/api/auth/connexion") || p.StartsWithSegments("/api/auth/jeton"))
        {
            return confiance ? RateLimitPartition.GetNoLimiter("confiance") : Fenetre("cnx:" + Adresse(http), 10, TimeSpan.FromMinutes(1));
        }
        if (p.StartsWithSegments("/api/auth/oubli") || p.StartsWithSegments("/api/auth/reinitialiser"))
        {
            return confiance ? RateLimitPartition.GetNoLimiter("confiance") : Fenetre("oubli:" + Adresse(http), 5, TimeSpan.FromHours(1));
        }
        if (p.StartsWithSegments("/api/pointage/borne"))
        {
            var jeton = http.Request.Headers["X-Borne-Jeton"].FirstOrDefault();
            return Fenetre("borne:" + (jeton is { Length: > 0 } ? Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(jeton)))[..24] : Adresse(http)),
                60, TimeSpan.FromMinutes(1));
        }
        var client = Client(http);
        if (p.StartsWithSegments("/api/diffusion"))
        {
            return RateLimitPartition.GetConcurrencyLimiter("sse:" + client, _ => new ConcurrencyLimiterOptions { PermitLimit = 5, QueueLimit = 0 });
        }
        if (p.StartsWithSegments("/api/editions/pdf") || p.StartsWithSegments("/api/pointage/export") || p.StartsWithSegments("/api/listes/lignes"))
        {
            return RateLimitPartition.GetConcurrencyLimiter("lourd:" + client, _ => new ConcurrencyLimiterOptions { PermitLimit = 2, QueueLimit = 4 });
        }
        var api = http.Request.Headers.Authorization.ToString().StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase);
        return RateLimitPartition.GetTokenBucketLimiter("api:" + client, _ => new TokenBucketRateLimiterOptions
        {
            TokenLimit = 50, TokensPerPeriod = api ? 5 : 10, ReplenishmentPeriod = TimeSpan.FromSeconds(1), QueueLimit = 0, AutoReplenishment = true,
        });
    }
}
