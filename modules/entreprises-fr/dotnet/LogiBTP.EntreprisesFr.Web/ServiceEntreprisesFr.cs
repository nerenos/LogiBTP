using System.Net;
using System.Text.Json;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.EntreprisesFr.Web;

/// <summary>
/// Recherche dans l'annuaire des entreprises (API publique Recherche d'entreprises, sans clé, 7 requêtes par seconde
/// au plus) : nom, SIREN ou SIRET ; résultats convertis en entreprises (Correspondance).
/// </summary>
public class ServiceEntreprisesFr(HttpClient http)
{
    public const string UrlApi = "https://recherche-entreprises.api.gouv.fr/";

    public virtual async Task<ReponseRecherche> Rechercher(string? recherche, int page, CancellationToken ct)
    {
        var q = (recherche ?? "").Trim();
        if (q.Length < 3) throw ExceptionMetier.Invalide("RECHERCHE", "Saisissez au moins 3 caractères (nom, SIREN ou SIRET)");
        HttpResponseMessage r;
        try
        {
            r = await http.GetAsync($"search?q={Uri.EscapeDataString(q)}&page={Math.Max(1, page)}&per_page=10", ct);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            throw new ExceptionMetier(StatusCodes.Status503ServiceUnavailable, "INDISPONIBLE", "Annuaire des entreprises injoignable");
        }
        using (r)
        {
            if (r.StatusCode == HttpStatusCode.TooManyRequests) throw new ExceptionMetier(StatusCodes.Status429TooManyRequests, "LIMITE", "Trop de recherches : réessayez dans quelques secondes");
            if (!r.IsSuccessStatusCode) throw new ExceptionMetier(StatusCodes.Status502BadGateway, "HTTP", $"Annuaire des entreprises : erreur {(int)r.StatusCode}");
            using var doc = await JsonDocument.ParseAsync(await r.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            return Correspondance.Reponse(doc.RootElement, q);
        }
    }
}

/// <summary>Branchement du module Entreprises françaises dans une application ASP.NET Core.</summary>
public static class Extensions
{
    public static IServiceCollection AddModuleEntreprisesFr(this IServiceCollection services)
    {
        services.AddHttpClient<ServiceEntreprisesFr>(c =>
        {
            c.BaseAddress = new Uri(ServiceEntreprisesFr.UrlApi);
            c.Timeout = TimeSpan.FromSeconds(10);
            c.DefaultRequestHeaders.UserAgent.ParseAdd("LogiBTP/0.1");
        });
        return services;
    }

    /// <summary>Routes HTTP du module, sous /entreprises-fr.</summary>
    public static RouteGroupBuilder MapModuleEntreprisesFr(this RouteGroupBuilder api)
    {
        api.MapGet("/entreprises-fr/recherche", (string? q, int? page, ServiceEntreprisesFr s, CancellationToken ct) => s.Rechercher(q, page ?? 1, ct));
        return api;
    }
}
