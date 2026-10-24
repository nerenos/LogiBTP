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

    public bool EstAdmin => Profil == "ADMIN";

    /// <summary>Usurpation (module Authentification) : code de l'administrateur qui agit pour cet utilisateur (null sinon).</summary>
    public string? Usurpateur { get; init; }

    public static Utilisateur Depuis(HttpContext http) => http.Items[Cle] as Utilisateur ?? new(
        http.Request.Headers["X-Utilisateur"].FirstOrDefault() ?? "demo",
        http.Request.Headers["X-Profil"].FirstOrDefault() ?? "ADMIN",
        http.Request.Headers["X-Groupe"].FirstOrDefault());

    /// <summary>Utilisateur de la requête établi par l'authentification (prime sur les en-têtes).</summary>
    public static void Poser(HttpContext http, Utilisateur u) => http.Items[Cle] = u;
}

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
