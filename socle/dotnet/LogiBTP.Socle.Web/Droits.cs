using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Socle.Web;

/// <summary>Profil attribuable à un compte : code, libellé, total (tous les droits : ADMIN).</summary>
public sealed record ProfilDroits(string Code, string Libelle, bool Total);

/// <summary>
/// Limites de validation d'un profil sur un nœud (montants HT) : par pièce, et cumul des pièces validées par le même
/// utilisateur pour le même tiers sur <c>Jours</c> jours glissants ; −1 = sans limite, 0 = toute validation soumise à demande.
/// </summary>
public sealed record LimiteValidation(decimal Piece, decimal Cumul, int Jours)
{
    /// <summary>Limite dépassée (même règle que ReglesDroits.Depassement) : PIECE, CUMUL (avec les pièces de la période) ou null.</summary>
    public string? Depassement(decimal montant, decimal cumulAnterieur) =>
        Piece >= 0 && montant > Piece ? "PIECE" : Cumul >= 0 && cumulAnterieur + montant > Cumul ? "CUMUL" : null;
}

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

    /// <summary>Limites de validation du profil sur le nœud (null : aucune).</summary>
    Task<LimiteValidation?> LimiteAsync(Utilisateur u, string noeud, CancellationToken ct) => Task.FromResult<LimiteValidation?>(null);
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
