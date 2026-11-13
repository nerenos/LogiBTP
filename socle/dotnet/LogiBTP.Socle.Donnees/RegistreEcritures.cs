using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace LogiBTP.Socle.Donnees;

/// <summary>
/// Route d'écriture déclarée : préfixe de gabarit (segments ; « {x} » accepte tout segment) et type d'écriture
/// (<see cref="TypesEcriture"/>), qui fixe son format d'échange et de contrôle.
/// </summary>
public sealed record RouteEcriture(string Prefixe, string Type);

/// <summary>
/// Registre des routes d'écriture de l'application (toute route /api autre que GET / HEAD) : la plus longue déclaration
/// qui couvre le gabarit donne le type. Une route d'écriture sans type est signalée au démarrage (exception en développement).
/// </summary>
public static class RegistreEcritures
{
    /// <summary>Gabarit sans contraintes ni valeurs par défaut (« {id:long} » → « {id} »), sans « / » final.</summary>
    public static string Normaliser(string gabarit)
    {
        var segments = gabarit.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries).Select(s =>
            s.StartsWith('{') && s.EndsWith('}') ? "{" + s[1..^1].Split(':', '=', '?')[0].TrimStart('*') + "}" : s);
        return "/" + string.Join('/', segments);
    }

    /// <summary>Déclaration qui couvre le gabarit (la plus longue), ou null.</summary>
    public static RouteEcriture? Trouver(IReadOnlyList<RouteEcriture> routes, string gabarit)
    {
        var g = Normaliser(gabarit).Split('/', StringSplitOptions.RemoveEmptyEntries);
        RouteEcriture? retenue = null;
        var longueur = -1;
        foreach (var r in routes)
        {
            var p = Normaliser(r.Prefixe).Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (p.Length > g.Length || p.Length <= longueur) continue;
            var ok = true;
            for (var i = 0; i < p.Length && ok; i++) ok = p[i] == g[i] || (p[i].StartsWith('{') && g[i].StartsWith('{')) || p[i] == "*";
            if (!ok) continue;
            retenue = r;
            longueur = p.Length;
        }
        return retenue;
    }

    /// <summary>Routes d'écriture /api de l'application : (méthode, gabarit normalisé).</summary>
    public static IEnumerable<(string Methode, string Gabarit)> Ecritures(IEndpointRouteBuilder app) =>
        app.DataSources.SelectMany(d => d.Endpoints).OfType<RouteEndpoint>()
            .SelectMany(e => (e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? []).Select(m => (m, Normaliser(e.RoutePattern.RawText ?? ""))))
            .Where(x => x.Item2.StartsWith("/api/", StringComparison.Ordinal) && !HttpMethods.IsGet(x.Item1) && !HttpMethods.IsHead(x.Item1) && !HttpMethods.IsOptions(x.Item1))
            .Distinct();

    /// <summary>Routes d'écriture sans type déclaré (« MÉTHODE gabarit »), triées.</summary>
    public static List<string> SansType(IEndpointRouteBuilder app, IReadOnlyList<RouteEcriture> routes) =>
        Ecritures(app).Where(x => Trouver(routes, x.Gabarit) is null).Select(x => $"{x.Methode} {x.Gabarit}")
            .Distinct().Order(StringComparer.Ordinal).ToList();

    /// <summary>Au démarrage : toute route d'écriture a un type (exception en développement, erreur journalisée sinon).</summary>
    public static IReadOnlyList<string> VerifierRoutesEcriture(this WebApplication app, IReadOnlyList<RouteEcriture> routes)
    {
        var manquantes = SansType(app, routes);
        if (manquantes.Count > 0)
        {
            var message = $"Écritures : {manquantes.Count} route(s) sans type d'écriture déclaré : {string.Join(", ", manquantes)}";
            if (app.Environment.IsDevelopment()) throw new InvalidOperationException(message);
            app.Logger.LogError("{Message}", message);
        }
        return manquantes;
    }
}
