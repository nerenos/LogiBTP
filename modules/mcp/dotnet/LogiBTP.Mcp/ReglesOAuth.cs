using System.Security.Cryptography;
using System.Text;

namespace LogiBTP.Mcp;

/// <summary>
/// Document de métadonnées d'un client OAuth (CIMD : <c>client_id</c> = adresse https du document) : nom affiché, adresses
/// de retour permises, méthode d'authentification au point de jeton (« none » seulement : client public), types d'octroi.
/// </summary>
public sealed record DocumentClient(string ClientId, string Nom, IReadOnlyList<string> Redirections, string? Authentification = null,
    IReadOnlyList<string>? Octrois = null, IReadOnlyList<string>? Reponses = null);

/// <summary>Erreurs du protocole OAuth 2.1 (RFC 6749 § 5.2, RFC 8707) : codes techniques imposés par la norme.</summary>
public static class ErreurOAuth
{
    public const string RequeteInvalide = "invalid_request";
    public const string ClientInvalide = "invalid_client";
    public const string OctroiInvalide = "invalid_grant";
    public const string ClientNonAutorise = "unauthorized_client";
    public const string OctroiNonPris = "unsupported_grant_type";
    public const string ReponseNonPrise = "unsupported_response_type";
    public const string CibleInvalide = "invalid_target";
    public const string AccesRefuse = "access_denied";
    public const string ErreurServeur = "server_error";
}

/// <summary>
/// Règles du serveur d'autorisation OAuth 2.1 du point /mcp (plan MCP, lot 12), sans base ni HTTP : forme des
/// identifiants de client (CIMD), contrôle du document d'un client, adresse de retour exacte, PKCE S256, audience
/// (RFC 8707), durées. Côté serveur seulement (pas de miroir JS : le navigateur ne voit ni code ni jeton).
/// </summary>
public static class ReglesOAuth
{
    /// <summary>Durée de vie du jeton d'accès (minutes) : court (R6), renouvelé par le jeton de rafraîchissement rotatif.</summary>
    public const int MinutesAcces = 15;

    /// <summary>Durée de vie d'une demande d'autorisation en attente du consentement (minutes).</summary>
    public const int MinutesDemande = 10;

    /// <summary>Durée de vie d'un code d'autorisation (minutes) ; usage unique.</summary>
    public const int MinutesCode = 5;

    /// <summary>Portée unique annoncée (aucune portée fine : le plafond est celui de la délégation consentie).</summary>
    public const string Portee = "mcp";

    /// <summary>Seule méthode PKCE acceptée.</summary>
    public const string MethodePkce = "S256";

    /// <summary>Préfixe du jeton de rafraîchissement (jamais confondu avec un jeton délégué « lbtp_agent_ »).</summary>
    public const string PrefixeRafraichissement = "lbtp_rafr_";

    /// <summary>Préfixe du code d'autorisation.</summary>
    public const string PrefixeCode = "lbtp_code_";

    /// <summary>Taille maximale d'un document de client lu (octets).</summary>
    public const int TailleDocumentMax = 16 * 1024;

    /// <summary>Empreinte SHA-256 (hexadécimal minuscule) : seule conservée en base pour un code ou un jeton.</summary>
    public static string Empreinte(string valeur) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(valeur)));

    /// <summary>Secret aléatoire (32 octets, base64 URL) précédé du préfixe.</summary>
    public static string Nouveau(string prefixe) => prefixe + Base64Url(RandomNumberGenerator.GetBytes(32));

    private static string Base64Url(byte[] octets) => Convert.ToBase64String(octets).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>
    /// Identifiant de client CIMD : adresse absolue https, avec un chemin (pas la racine), sans fragment, sans identifiants,
    /// sans segment « . » ni « .. ».
    /// </summary>
    public static bool ClientIdValide(string? clientId)
    {
        if (string.IsNullOrWhiteSpace(clientId) || clientId.Length > 500 || !Uri.TryCreate(clientId, UriKind.Absolute, out var u)) return false;
        if (u.Scheme != Uri.UriSchemeHttps || !string.IsNullOrEmpty(u.UserInfo) || clientId.Contains('#')) return false;
        var chemin = clientId[(clientId.IndexOf("//", StringComparison.Ordinal) + 2)..];
        var i = chemin.IndexOf('/');
        if (i < 0 || i == chemin.Length - 1) return false;
        var segments = chemin[(i + 1)..].Split('?')[0].Split('/');
        return !segments.Any(s => s is "." or "..");
    }

    /// <summary>Adresse de retour acceptable dans un document de client : https, ou http sur la boucle locale (application native, RFC 8252).</summary>
    public static bool RedirectionAcceptable(string? redirection)
    {
        if (string.IsNullOrWhiteSpace(redirection) || redirection.Contains('#') || !Uri.TryCreate(redirection, UriKind.Absolute, out var u)) return false;
        if (u.Scheme == Uri.UriSchemeHttps) return true;
        return u.Scheme == Uri.UriSchemeHttp && (u.IsLoopback || u.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Contrôle du document d'un client lu à son adresse : <c>client_id</c> identique à l'adresse, au moins une adresse de
    /// retour (toutes acceptables), client public (méthode « none » ou absente), octroi « authorization_code » permis.
    /// Rend la raison du refus, sinon null.
    /// </summary>
    public static string? ControlerDocument(string clientId, DocumentClient? d)
    {
        if (d is null) return "document absent";
        if (!string.Equals(d.ClientId, clientId, StringComparison.Ordinal)) return "client_id différent de l'adresse du document";
        if (d.Redirections.Count == 0 || !d.Redirections.All(RedirectionAcceptable)) return "adresses de retour absentes ou invalides";
        if (d.Authentification is { } a && a != "none") return "client confidentiel non pris en charge";
        if (d.Octrois is { } o && !o.Contains("authorization_code")) return "octroi authorization_code absent";
        if (d.Reponses is { } r && !r.Contains("code")) return "type de réponse code absent";
        return null;
    }

    /// <summary>Adresse de retour demandée exactement égale (caractère pour caractère) à l'une de celles du document du client.</summary>
    public static bool RedirectionPermise(string? redirection, IReadOnlyList<string> permises) =>
        !string.IsNullOrEmpty(redirection) && permises.Any(p => string.Equals(p, redirection, StringComparison.Ordinal));

    private static bool CaractereNonReserve(char c) => c is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '-' or '.' or '_' or '~';

    /// <summary>Défi PKCE S256 : 43 caractères base64 URL (empreinte SHA-256 encodée).</summary>
    public static bool DefiValide(string? defi) =>
        defi is { Length: 43 } && defi.All(c => c is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '-' or '_');

    /// <summary>Vérificateur PKCE : 43 à 128 caractères non réservés (RFC 7636 § 4.1).</summary>
    public static bool VerificateurValide(string? verificateur) =>
        verificateur is { Length: >= 43 and <= 128 } && verificateur.All(CaractereNonReserve);

    /// <summary>Défi S256 d'un vérificateur : BASE64URL(SHA256(ASCII(vérificateur))).</summary>
    public static string Defi(string verificateur) => Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verificateur)));

    /// <summary>PKCE S256 vérifié en temps constant ; vérificateur mal formé refusé.</summary>
    public static bool PkceValide(string? verificateur, string defi) =>
        VerificateurValide(verificateur)
        && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Defi(verificateur!)), Encoding.ASCII.GetBytes(defi));

    /// <summary>Ressource protégée (audience, RFC 8707) : le point /mcp de la société servie à <paramref name="origine"/>.</summary>
    public static string Ressource(string origine) => origine.TrimEnd('/') + "/mcp";

    /// <summary>
    /// Ressource demandée égale à celle attendue : même schéma, hôte (sans casse), port et chemin (barre finale ignorée),
    /// sans requête ni fragment. Une autre société (autre sous-domaine) est donc refusée.
    /// </summary>
    public static bool RessourceEgale(string? demandee, string attendue)
    {
        if (string.IsNullOrWhiteSpace(demandee) || !Uri.TryCreate(demandee, UriKind.Absolute, out var d) || !Uri.TryCreate(attendue, UriKind.Absolute, out var a)) return false;
        if (!string.IsNullOrEmpty(d.Query) || !string.IsNullOrEmpty(d.Fragment)) return false;
        return d.Scheme == a.Scheme && string.Equals(d.Host, a.Host, StringComparison.OrdinalIgnoreCase) && d.Port == a.Port
            && string.Equals(d.AbsolutePath.TrimEnd('/'), a.AbsolutePath.TrimEnd('/'), StringComparison.Ordinal);
    }

    /// <summary>Adresse de retour complétée de paramètres (encodés), après ceux qu'elle porte déjà.</summary>
    public static string Redirection(string redirection, IEnumerable<KeyValuePair<string, string?>> parametres)
    {
        var p = string.Join("&", parametres.Where(kv => kv.Value is not null).Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value!)}"));
        if (p.Length == 0) return redirection;
        return redirection + (redirection.Contains('?') ? "&" : "?") + p;
    }

    /// <summary>
    /// Échéance d'un jeton d'accès : maintenant + <see cref="MinutesAcces"/>, jamais au-delà de la fin de la délégation
    /// (<paramref name="finDelegation"/> : premier instant sans délégation).
    /// </summary>
    public static DateTimeOffset EcheanceAcces(DateTimeOffset maintenant, DateTimeOffset finDelegation)
    {
        var e = maintenant.AddMinutes(MinutesAcces);
        return e < finDelegation ? e : finDelegation;
    }
}
