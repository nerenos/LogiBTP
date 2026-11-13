namespace LogiBTP.Authentification;

// Codes du module Authentification, répliqués dans modules/authentification/js/src/codes.js (parité vérifiée par CodesTests.cs).

/// <summary>Codes d'erreur testés par l'interface.</summary>
public static class ErreursAuthentification
{
    public const string SessionRequise = "SESSION_REQUISE";
    public const string MdpAChanger = "MDP_A_CHANGER";
    /// <summary>Jeton Bearer (identifiant d'API ou jeton délégué) inconnu, révoqué, échu, ou compte inutilisable.</summary>
    public const string JetonInvalide = "JETON_INVALIDE";
}
