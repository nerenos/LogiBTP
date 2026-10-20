using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Socle.Web;

/// <summary>
/// Modules activés pour la société courante (activation par drapeau, réglée par l'application). Un module facultatif
/// pose <see cref="ExtensionsModules.ExigeModule"/> sur ses routes ; sans implémentation enregistrée, tout est actif.
/// </summary>
public interface IModulesActifs
{
    Task<bool> EstActifAsync(string code, CancellationToken ct);
}

public static class ExtensionsModules
{
    /// <summary>Refuse les routes du groupe quand le module est désactivé pour la société (409 MODULE_INACTIF).</summary>
    public static TBuilder ExigeModule<TBuilder>(this TBuilder routes, string code, string libelle) where TBuilder : IEndpointConventionBuilder =>
        routes.AddEndpointFilter(async (contexte, suite) =>
        {
            var modules = contexte.HttpContext.RequestServices.GetService<IModulesActifs>();
            if (modules is not null && !await modules.EstActifAsync(code, contexte.HttpContext.RequestAborted))
            {
                throw ExceptionMetier.Conflit("MODULE_INACTIF", $"Module {libelle} désactivé pour cette société");
            }
            return await suite(contexte);
        });
}
