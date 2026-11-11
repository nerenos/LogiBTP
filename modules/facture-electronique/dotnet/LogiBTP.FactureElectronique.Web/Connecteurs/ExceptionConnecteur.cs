using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Http;

namespace LogiBTP.FactureElectronique.Web.Connecteurs;

/// <summary>
/// Échec d'un appel à une plateforme : code <see cref="ErreurFe"/>, statut HTTP reçu (null : refus avant l'envoi ou
/// plateforme injoignable), code d'erreur de la plateforme (errorCode), identifiant de corrélation (Request-Id).
/// <see cref="Reessayable"/> : la file des flux (lot 8) peut reprendre l'appel plus tard (408, 429, 5xx sauf 501,
/// plateforme injoignable). Le message ne contient jamais de jeton ; celui de la plateforme passe par <c>Masquage</c>.
/// </summary>
public sealed class ExceptionConnecteur(string code, string message, int? statutHttp = null, string? codePlateforme = null, string? requestId = null)
    : ExceptionMetier(StatutDe(code), code, message, codePlateforme is null ? null : new { code_plateforme = codePlateforme, statut_http = statutHttp })
{
    public int? StatutHttp { get; } = statutHttp;
    public string? CodePlateforme { get; } = codePlateforme;
    public string? RequestId { get; } = requestId;

    public bool Reessayable => Code is ErreurFe.DelaiDepasse or ErreurFe.TropDeRequetes or ErreurFe.ErreurPlateforme
        or ErreurFe.PlateformeIndisponible;

    /// <summary>Code d'erreur d'un statut HTTP de la plateforme (XP Z12-013 : 400 à 503).</summary>
    public static string CodeDuStatut(int statut) => statut switch
    {
        400 => ErreurFe.RequeteRefusee,
        401 => ErreurFe.NonAuthentifie,
        403 => ErreurFe.AccesRefusePlateforme,
        404 => ErreurFe.RessourceIntrouvable,
        408 => ErreurFe.DelaiDepasse,
        413 => ErreurFe.FichierTropGros,
        422 => ErreurFe.DonneesIncoherentes,
        429 => ErreurFe.TropDeRequetes,
        501 => ErreurFe.FonctionNonPriseEnCharge,
        503 => ErreurFe.PlateformeIndisponible,
        _ => ErreurFe.ErreurPlateforme,
    };

    /// <summary>Statut de la réponse de LogiBTP à son client : 422 pour une demande refusée, 404, 501, 502 ou 503 pour la plateforme.</summary>
    private static int StatutDe(string code) => code switch
    {
        ErreurFe.DemandeInvalide or ErreurFe.ParametreConnecteur or ErreurFe.ConnecteurInconnu or ErreurFe.FichierTropGros
            or ErreurFe.DonneesIncoherentes or ErreurFe.RequeteRefusee => StatusCodes.Status422UnprocessableEntity,
        ErreurFe.RessourceIntrouvable => StatusCodes.Status404NotFound,
        ErreurFe.FonctionNonPriseEnCharge => StatusCodes.Status501NotImplemented,
        ErreurFe.PlateformeIndisponible or ErreurFe.DelaiDepasse or ErreurFe.TropDeRequetes => StatusCodes.Status503ServiceUnavailable,
        _ => StatusCodes.Status502BadGateway,
    };

    internal static ExceptionConnecteur Demande(string message) => new(ErreurFe.DemandeInvalide, message);
}
