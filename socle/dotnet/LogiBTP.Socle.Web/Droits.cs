using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Socle.Web;

/// <summary>Profil attribuable à un compte : code, libellé, total (tous les droits : ADMIN).</summary>
public sealed record ProfilDroits(string Code, string Libelle, bool Total);

/// <summary>
/// Contrat des droits entre modules (implémenté par le module Droits) : nœud = chemin « module/élément »
/// (documents/V_DEVIS, fiches/salarie…), action (CONSULTER, MODIFIER, VALIDER, CREER, SUPPRIMER, DEVERROUILLER, FORCER,
/// ou une action propre au nœud : RGPD, SUPERVISER…), portée accordée SOI, SERVICE ou TOUT. Sans implémentation
/// enregistrée, chaque module garde ses droits historiques (tables droit_document, droit_fiche, crm_droit).
/// </summary>
public interface IDroits
{
    /// <summary>Portée accordée pour l'action sur le nœud (null : refusée) ; profil total : TOUT.</summary>
    Task<string?> PorteeAsync(Utilisateur u, string noeud, string action, CancellationToken ct);

    /// <summary>Profils attribuables aux comptes.</summary>
    Task<IReadOnlyList<ProfilDroits>> ProfilsAsync(CancellationToken ct);
}

public static class ExtensionsDroits
{
    public static async Task<bool> AutoriseAsync(this IDroits droits, Utilisateur u, string noeud, string action, CancellationToken ct) =>
        await droits.PorteeAsync(u, noeud, action, ct) is not null;

    /// <summary>Refus 403 ACCES_REFUSE si l'action n'est pas permise sur le nœud.</summary>
    public static async Task ExigerAsync(this IDroits droits, Utilisateur u, string noeud, string action, CancellationToken ct)
    {
        if (!await droits.AutoriseAsync(u, noeud, action, ct)) throw ExceptionMetier.AccesRefuse(action);
    }

    /// <summary>Refuse les routes du groupe sans l'action sur le nœud (si un module Droits est branché).</summary>
    public static TBuilder ExigeDroit<TBuilder>(this TBuilder routes, string noeud, string action) where TBuilder : IEndpointConventionBuilder =>
        routes.AddEndpointFilter(async (contexte, suite) =>
        {
            var droits = contexte.HttpContext.RequestServices.GetService<IDroits>();
            if (droits is not null) await droits.ExigerAsync(Utilisateur.Depuis(contexte.HttpContext), noeud, action, contexte.HttpContext.RequestAborted);
            return await suite(contexte);
        });
}
