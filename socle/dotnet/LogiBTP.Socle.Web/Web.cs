using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace LogiBTP.Socle.Web;

/// <summary>Erreur métier traduite en réponse HTTP (ProblemDetails).</summary>
public class ExceptionMetier(int statut, string code, string message, object? details = null) : Exception(message)
{
    public int Statut { get; } = statut;
    public string Code { get; } = code;
    public object? Details { get; } = details;

    public static ExceptionMetier Introuvable(string quoi) => new(StatusCodes.Status404NotFound, "INTROUVABLE", $"{quoi} introuvable");
    public static ExceptionMetier AccesRefuse(string action) => new(StatusCodes.Status403Forbidden, "ACCES_REFUSE", $"Droit {action} refusé");

    /// <summary>Refus du paramétrage (403 ACCES_REFUSE, droit PARAMETRER).</summary>
    public static ExceptionMetier ParametrageRefuse() => AccesRefuse(ActionsDroits.Parametrer);
    /// <summary>Action ou route hors du plafond de la délégation d'un agent (403 AGENT_INTERDIT).</summary>
    public static ExceptionMetier AgentInterdit(string quoi) => new(StatusCodes.Status403Forbidden, ErreursAgent.AgentInterdit, $"Interdit à l'agent : {quoi}");
    public static ExceptionMetier Conflit(string code, string message, object? details = null) => new(StatusCodes.Status409Conflict, code, message, details);
    public static ExceptionMetier Invalide(string code, string message, object? details = null) => new(StatusCodes.Status422UnprocessableEntity, code, message, details);
}

/// <summary>
/// Utilisateur courant : posé sur la requête par l'authentification (session, <see cref="Poser"/>) ; sans
/// authentification branchée (tests) ou en mode de développement par en-têtes, lu dans X-Utilisateur, X-Profil et X-Groupe.
/// </summary>
public sealed record Utilisateur(string Code, string Profil, string? Groupe = null)
{
    private const string Cle = "LogiBTP.Utilisateur";

    /// <summary>Administrateur (profil ADMIN) ; jamais pour un agent (<see cref="Agent"/> posé), même s'il porte le compte d'un administrateur.</summary>
    public bool EstAdmin => Agent is null && Profil == Profils.Admin;

    /// <summary>Refus du paramétrage (403) si l'utilisateur n'est pas administrateur.</summary>
    public void ExigerAdmin()
    {
        if (!EstAdmin) throw ExceptionMetier.ParametrageRefuse();
    }

    /// <summary>
    /// Droits du profil sur le nœud « parametres », renseignés par le module Droits à chaque requête (absent : administrateur
    /// seul) ; toujours faux pour un agent (le paramétrage n'est pas délégué).
    /// </summary>
    public bool PeutConsulterParametres { get => Agent is null && field; init; }
    public bool PeutModifierParametres { get => Agent is null && field; init; }

    /// <summary>Refus du paramétrage (403) sans le droit de modification sur « parametres » (l'administrateur : toujours).</summary>
    public void ExigerParametres()
    {
        if (!EstAdmin && !PeutModifierParametres) throw ExceptionMetier.ParametrageRefuse();
    }

    /// <summary>Usurpation (module Authentification) : code de l'administrateur qui agit pour cet utilisateur (null sinon).</summary>
    public string? Usurpateur { get; init; }

    /// <summary>Agent IA (module MCP) : délégation et client sous lesquels la requête agit pour cet utilisateur (null : action humaine).</summary>
    public AgentRequete? Agent { get; init; }

    public static Utilisateur Depuis(HttpContext http) => http.Items[Cle] as Utilisateur ?? new(
        http.Request.Headers["X-Utilisateur"].FirstOrDefault() ?? "demo",
        http.Request.Headers["X-Profil"].FirstOrDefault() ?? Profils.Admin,
        http.Request.Headers["X-Groupe"].FirstOrDefault());

    /// <summary>Utilisateur de la requête établi par l'authentification (prime sur les en-têtes).</summary>
    public static void Poser(HttpContext http, Utilisateur u) => http.Items[Cle] = u;
}

/// <summary>Requête émise par un agent IA : code de la délégation (plafond) et client connecté.</summary>
public sealed record AgentRequete(string Delegation, string Client);

public static class ExtensionsWeb
{
    /// <summary>Traduit les erreurs métier en réponses JSON avec un code stable exploitable par le client.</summary>
    public static IApplicationBuilder UseErreursMetier(this IApplicationBuilder app) => app.Use(async (http, next) =>
    {
        try
        {
            await next(http);
        }
        catch (ExceptionMetier e)
        {
            http.Response.StatusCode = e.Statut;
            await http.Response.WriteAsJsonAsync(new { status = e.Statut, code = e.Code, title = e.Message, details = e.Details },
                JsonCalcul.Options);
        }
    });
}
