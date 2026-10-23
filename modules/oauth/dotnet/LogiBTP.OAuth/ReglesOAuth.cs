using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace LogiBTP.OAuth;

/// <summary>Couple PKCE (RFC 7636, méthode S256) : vérificateur gardé par le serveur, défi envoyé au fournisseur.</summary>
public sealed record Pkce(string Verificateur, string Defi);

/// <summary>Réponse du point de jeton (RFC 6749 § 5.1) ; le jeton de rafraîchissement peut manquer lors d'un renouvellement.</summary>
public sealed record ReponseJeton(string Acces, string? Rafraichissement, string Type, int? ExpireDans, int? RafraichissementExpireDans, string? Portees, string? IdToken);

/// <summary>Échéance d'une connexion à rappeler (secret du client ou jeton de rafraîchissement).</summary>
public sealed record RappelDu(string Echeance, DateTimeOffset Date, int Delai);

/// <summary>
/// Règles pures des connexions OAuth 2.0 (sans réseau ni base) : PKCE, state portant la société, adresse de la demande
/// d'autorisation, lecture des réponses de jeton et de l'id_token, état des échéances (pastille) et rappels dus.
/// </summary>
public static class ReglesOAuth
{
    public const string Vert = "VERT";
    public const string Orange = "ORANGE";
    public const string Rouge = "ROUGE";

    /// <summary>Seuils de la pastille d'échéance (jours) : orange à moins de 30 jours, rouge à moins de 7 ou dépassée.</summary>
    public const int SeuilOrange = 30;
    public const int SeuilRouge = 7;

    public static Pkce NouveauPkce()
    {
        var verificateur = Base64Url(RandomNumberGenerator.GetBytes(32));
        return new Pkce(verificateur, Defi(verificateur));
    }

    public static string Defi(string verificateur) => Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verificateur)));

    /// <summary>
    /// State à usage unique : « &lt;code de la société&gt;.&lt;aléatoire&gt; » (« _ » pour la base principale) ; l'adresse de
    /// retour est commune à l'installation, la société est retrouvée par le state.
    /// </summary>
    public static string NouveauState(string? societe) => $"{(string.IsNullOrEmpty(societe) ? "_" : societe)}.{Base64Url(RandomNumberGenerator.GetBytes(24))}";

    /// <summary>Code de la société porté par un state (null : base principale) ; state mal formé : exception.</summary>
    public static string? SocieteDuState(string? state)
    {
        var i = state?.IndexOf('.') ?? -1;
        if (state is null || i <= 0 || i == state.Length - 1) throw new FormatException("State invalide");
        var code = state[..i];
        return code == "_" ? null : code;
    }

    /// <summary>Adresse de la page d'autorisation du fournisseur (flux par code + PKCE).</summary>
    public static string UrlAutorisation(string urlFournisseur, string identifiantClient, string adresseRetour, string portees, string state,
        string defi, IReadOnlyDictionary<string, string>? parametres = null, string? compteSuggere = null)
    {
        var p = new List<KeyValuePair<string, string>>
        {
            new("client_id", identifiantClient), new("redirect_uri", adresseRetour), new("response_type", "code"),
            new("scope", portees.Trim()), new("state", state), new("code_challenge", defi), new("code_challenge_method", "S256"),
        };
        foreach (var (k, v) in parametres ?? new Dictionary<string, string>())
        {
            if (p.All(x => x.Key != k)) p.Add(new(k, v));
        }
        if (!string.IsNullOrWhiteSpace(compteSuggere)) p.Add(new("login_hint", compteSuggere.Trim()));
        var requete = string.Join('&', p.Select(x => $"{Uri.EscapeDataString(x.Key)}={Uri.EscapeDataString(x.Value)}"));
        return urlFournisseur + (urlFournisseur.Contains('?') ? '&' : '?') + requete;
    }

    /// <summary>Lit une réponse JSON du point de jeton ; erreur du fournisseur (« error ») ou jeton absent : exception explicite.</summary>
    public static ReponseJeton LireReponseJeton(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var r = doc.RootElement;
        if (r.TryGetProperty("error", out var err))
        {
            var description = r.TryGetProperty("error_description", out var d) ? d.GetString() : null;
            throw new ErreurOAuth(err.GetString() ?? "erreur", description);
        }
        var acces = Texte(r, "access_token") ?? throw new ErreurOAuth("reponse_invalide", "Jeton d'accès absent de la réponse");
        return new ReponseJeton(acces, Texte(r, "refresh_token"), Texte(r, "token_type") ?? "Bearer", Entier(r, "expires_in"),
            Entier(r, "refresh_token_expires_in"), Texte(r, "scope"), Texte(r, "id_token"));
    }

    /// <summary>
    /// Adresse du compte lue dans l'id_token (OpenID Connect, revendication « email », sinon « preferred_username » ou
    /// « upn ») : jeton reçu directement du point de jeton en TLS, sa signature n'a pas à être vérifiée ici.
    /// </summary>
    public static string? CompteDeIdToken(string? idToken)
    {
        var parties = idToken?.Split('.');
        if (parties is not { Length: >= 2 }) return null;
        try
        {
            using var doc = JsonDocument.Parse(DepuisBase64Url(parties[1]));
            return Texte(doc.RootElement, "email") ?? Texte(doc.RootElement, "preferred_username") ?? Texte(doc.RootElement, "upn");
        }
        catch (Exception e) when (e is FormatException or JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// Fin du jeton de rafraîchissement : durée renvoyée par le fournisseur si elle existe, sinon durée d'une application
    /// en mode test (Google : 7 jours), sinon inconnue (null).
    /// </summary>
    public static DateTimeOffset? FinRafraichissement(DateTimeOffset maintenant, int? renvoyeeSecondes, bool modeTest, int? dureeTestJours) =>
        renvoyeeSecondes is > 0 ? maintenant.AddSeconds(renvoyeeSecondes.Value)
        : modeTest && dureeTestJours is > 0 ? maintenant.AddDays(dureeTestJours.Value)
        : null;

    /// <summary>Pastille d'une échéance : VERT, ORANGE à moins de 30 jours, ROUGE à moins de 7 jours ou dépassée ; null sans échéance.</summary>
    public static string? Pastille(DateTimeOffset? echeance, DateTimeOffset maintenant)
    {
        if (echeance is not { } e) return null;
        var reste = e - maintenant;
        return reste < TimeSpan.FromDays(SeuilRouge) ? Rouge : reste < TimeSpan.FromDays(SeuilOrange) ? Orange : Vert;
    }

    /// <summary>
    /// Pastille d'une connexion : rouge si elle est à reconnecter ou à connecter, sinon la plus grave de ses échéances
    /// (secret du client, jeton de rafraîchissement) ; désactivée : null.
    /// </summary>
    public static string? PastilleConnexion(string etat, DateTimeOffset? secret, DateTimeOffset? rafraichissement, DateTimeOffset maintenant)
    {
        if (etat == "DESACTIVEE") return null;
        if (etat is "A_RECONNECTER" or "A_CONNECTER") return Rouge;
        var p = new[] { Pastille(secret, maintenant), Pastille(rafraichissement, maintenant) };
        return p.Contains(Rouge) ? Rouge : p.Contains(Orange) ? Orange : Vert;
    }

    /// <summary>
    /// Rappel dû pour une échéance : le plus petit délai (jours) déjà atteint, 0 si l'échéance est dépassée ; null si aucun
    /// délai n'est atteint. Un seul rappel par passage : une connexion créée tard ne reçoit pas tous les délais d'un coup.
    /// Un délai qui commence avant le début de la validité (<paramref name="debut"/> : autorisation de 7 jours et rappel
    /// à 7 ou 30 jours) est ignoré : il serait dû dès la connexion.
    /// </summary>
    public static int? DelaiAtteint(DateTimeOffset echeance, IEnumerable<int> delais, DateTimeOffset maintenant, DateTimeOffset? debut = null)
    {
        if (maintenant >= echeance) return 0;
        var atteints = delais.Where(d => d > 0 && maintenant >= echeance.AddDays(-d) && (debut is not { } x || echeance.AddDays(-d) > x)).ToList();
        return atteints.Count == 0 ? null : atteints.Min();
    }

    /// <summary>
    /// Rappels dus d'une connexion active (échéances du secret et du jeton de rafraîchissement ; ce dernier vaut depuis
    /// la connexion <paramref name="connexion"/>).
    /// </summary>
    public static List<RappelDu> RappelsDus(DateTimeOffset? secret, DateTimeOffset? rafraichissement, DateTimeOffset? connexion, IEnumerable<int> delais, DateTimeOffset maintenant)
    {
        var d = delais.ToList();
        var res = new List<RappelDu>();
        foreach (var (nom, date, debut) in new[] { ("SECRET", secret, (DateTimeOffset?)null), ("RAFRAICHISSEMENT", rafraichissement, connexion) })
        {
            if (date is { } e && DelaiAtteint(e, d, maintenant, debut) is { } delai) res.Add(new RappelDu(nom, e, delai));
        }
        return res;
    }

    public static string Base64Url(byte[] octets) => Convert.ToBase64String(octets).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static byte[] DepuisBase64Url(string texte)
    {
        var s = texte.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(s.PadRight(s.Length + (4 - s.Length % 4) % 4, '='));
    }

    private static string? Texte(JsonElement e, string nom) => e.TryGetProperty(nom, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static int? Entier(JsonElement e, string nom) => !e.TryGetProperty(nom, out var v) ? null
        : v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) ? n
        : v.ValueKind == JsonValueKind.String && int.TryParse(v.GetString(), out var s) ? s : null;
}

/// <summary>Erreur renvoyée par un fournisseur OAuth (code RFC 6749 : invalid_grant, invalid_client…).</summary>
public sealed class ErreurOAuth(string code, string? description) : Exception(description is null ? code : $"{code} : {description}")
{
    public string Code { get; } = code;

    /// <summary>Erreur qui exige une nouvelle autorisation par une personne (jeton révoqué ou expiré, client refusé).</summary>
    public bool AReconnecter => Code is "invalid_grant" or "invalid_client" or "unauthorized_client";
}
