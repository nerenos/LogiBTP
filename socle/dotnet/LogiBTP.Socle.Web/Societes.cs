using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace LogiBTP.Socle.Web;

/// <summary>
/// Sociétés : une base par société, désignée par le sous-domaine (acme.logibtp.fr, acme.localhost en développement).
/// Sans sous-domaine, la base principale. Section de configuration « Societes » :
///   Domaines : domaines de base (["localhost", "logibtp.fr"]) ; Principale : connexion de la base principale (par défaut
///   ConnectionStrings:LogiBTP) ; Liste : { "acme": { "Libelle": "ACME BTP", "Connexion": "Host=…;Database=logibtp_acme" } }.
/// </summary>
public sealed class OptionsSocietes
{
    public List<string> Domaines { get; set; } = ["localhost"];
    public string? Principale { get; set; }
    public string LibellePrincipale { get; set; } = "Société principale";
    public Dictionary<string, SocieteConfiguree> Liste { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

public sealed class SocieteConfiguree
{
    public string Libelle { get; set; } = "";
    public string Connexion { get; set; } = "";
}

/// <summary>Société de la requête : Code null pour la base principale.</summary>
public sealed record SocieteCourante(string? Code, string Libelle, string Connexion)
{
    public bool Principale => Code is null;
}

public static class ExtensionsSocietes
{
    private const string Cle = "LogiBTP.Societe";

    /// <summary>
    /// Sous-domaine d'un nom d'hôte pour les domaines de base (null : base principale, adresse IP, domaine inconnu ou www).
    /// </summary>
    public static string? SousDomaine(string? hote, IEnumerable<string> domaines)
    {
        if (string.IsNullOrWhiteSpace(hote)) return null;
        var h = hote.Trim().ToLowerInvariant();
        if (h.StartsWith('[')) return null; // IPv6
        var deuxPoints = h.LastIndexOf(':');
        if (deuxPoints > 0) h = h[..deuxPoints];
        if (IPAddress.TryParse(h, out _)) return null;
        foreach (var d in domaines.Select(x => x.Trim().ToLowerInvariant()).OrderByDescending(x => x.Length))
        {
            if (h == d) return null;
            if (h.EndsWith("." + d, StringComparison.Ordinal))
            {
                var sd = h[..^(d.Length + 1)];
                return sd == "www" ? null : sd;
            }
        }
        return null;
    }

    public static IServiceCollection AddSocietes(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<OptionsSocietes>(configuration.GetSection("Societes"));
        services.PostConfigure<OptionsSocietes>(o => o.Principale ??= configuration.GetConnectionString("LogiBTP"));
        services.AddHttpContextAccessor();
        services.AddScoped(sp =>
        {
            var o = sp.GetRequiredService<IOptions<OptionsSocietes>>().Value;
            return sp.GetRequiredService<IHttpContextAccessor>().HttpContext?.Items[Cle] as SocieteCourante
                ?? new SocieteCourante(null, o.LibellePrincipale, o.Principale ?? "");
        });
        return services;
    }

    /// <summary>
    /// Résout la société de chaque requête d'après l'en-tête Host ; sous-domaine non configuré : 404 SOCIETE_INCONNUE.
    /// </summary>
    public static IApplicationBuilder UseSocietes(this IApplicationBuilder app) => app.Use(async (http, next) =>
    {
        var o = http.RequestServices.GetRequiredService<IOptions<OptionsSocietes>>().Value;
        var code = SousDomaine(http.Request.Host.Value, o.Domaines);
        if (code is null) http.Items[Cle] = new SocieteCourante(null, o.LibellePrincipale, o.Principale ?? "");
        else if (o.Liste.TryGetValue(code, out var s)) http.Items[Cle] = new SocieteCourante(code, string.IsNullOrEmpty(s.Libelle) ? code.ToUpperInvariant() : s.Libelle, s.Connexion);
        else
        {
            http.Response.StatusCode = StatusCodes.Status404NotFound;
            await http.Response.WriteAsJsonAsync(new { status = 404, code = "SOCIETE_INCONNUE", title = $"Société « {code} » inconnue" }, JsonCalcul.Options);
            return;
        }
        await next(http);
    });
}
