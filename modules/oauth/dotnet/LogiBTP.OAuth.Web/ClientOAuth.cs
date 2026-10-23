namespace LogiBTP.OAuth.Web;

/// <summary>
/// Client du fournisseur (valeur déchiffrée de oco_client) : identifiant, secret ou certificat (PKCS#12 en base64 et son
/// mot de passe), locataire (Microsoft), clé d'un compte de service (JSON Google) et boîte déléguée (sujet), points de
/// terminaison propres (fournisseur générique).
/// </summary>
public sealed record ClientFournisseur(string IdentifiantClient, string? Secret, string? Locataire, string? Certificat = null, string? MotDePasseCertificat = null,
    string? CleCompteService = null, string? Sujet = null, string? UrlAutorisation = null, string? UrlJeton = null, string? UrlRevocation = null);

/// <summary>Jetons d'une connexion : valeur déchiffrée de oco_jetons.</summary>
public sealed record JetonsConnexion(string Acces, string? Rafraichissement, string Type);

/// <summary>
/// Appels HTTP aux points de jeton et de révocation (RFC 6749, RFC 7009) : échange du code (avec le vérificateur PKCE),
/// renouvellement par le jeton de rafraîchissement, révocation. Formulaires encodés, réponse JSON lue par
/// <see cref="ReglesOAuth.LireReponseJeton"/>.
/// </summary>
public class ClientOAuth(HttpClient http)
{
    public virtual Task<ReponseJeton> EchangerCodeAsync(FournisseurEntite f, ClientFournisseur c, string code, string verificateur, string adresseRetour, CancellationToken ct) =>
        PosterAsync(UrlJeton(f, c), Formulaire(f, c, ("grant_type", "authorization_code"), ("code", code), ("code_verifier", verificateur), ("redirect_uri", adresseRetour)), ct);

    public virtual Task<ReponseJeton> RafraichirAsync(FournisseurEntite f, ClientFournisseur c, string rafraichissement, string? portees, CancellationToken ct) =>
        PosterAsync(UrlJeton(f, c), Formulaire(f, c, ("grant_type", "refresh_token"), ("refresh_token", rafraichissement), ("scope", portees)), ct);

    /// <summary>Jeton d'application (client credentials) : secret ou assertion signée par le certificat.</summary>
    public virtual Task<ReponseJeton> ClientCredentialsAsync(FournisseurEntite f, ClientFournisseur c, string portees, CancellationToken ct) =>
        PosterAsync(UrlJeton(f, c), Formulaire(f, c, ("grant_type", "client_credentials"), ("scope", portees)), ct);

    /// <summary>Jeton d'un compte de service (grant jwt-bearer, assertion signée par sa clé, boîte déléguée).</summary>
    public virtual Task<ReponseJeton> CompteServiceAsync(FournisseurEntite f, ClientFournisseur c, string portees, CancellationToken ct)
    {
        var cle = AssertionsOAuth.LireCleCompteService(c.CleCompteService ?? throw new ErreurOAuth("cle_absente", "Clé du compte de service absente"));
        var url = c.UrlJeton ?? cle.TokenUri ?? Url(f.OfoUrlJeton, c);
        var assertion = AssertionsOAuth.AssertionCompteService(cle, portees, url, c.Sujet, DateTimeOffset.UtcNow);
        return PosterAsync(url, new FormUrlEncodedContent([new("grant_type", AssertionsOAuth.GrantJwtBearer), new("assertion", assertion)]), ct);
    }

    public static string UrlJeton(FournisseurEntite f, ClientFournisseur c) => c.UrlJeton ?? Url(f.OfoUrlJeton, c);
    public static string UrlAutorisation(FournisseurEntite f, ClientFournisseur c) => c.UrlAutorisation ?? Url(f.OfoUrlAutorisation, c);

    /// <summary>Révocation du jeton auprès du fournisseur (sans effet si le fournisseur n'en a pas) ; une erreur est ignorée.</summary>
    public virtual async Task RevoquerAsync(FournisseurEntite f, ClientFournisseur c, string jeton, CancellationToken ct)
    {
        var url = c.UrlRevocation ?? (string.IsNullOrEmpty(f.OfoUrlRevocation) ? null : Url(f.OfoUrlRevocation, c));
        if (url is null) return;
        try
        {
            using var r = await http.PostAsync(url, new FormUrlEncodedContent([new("token", jeton)]), ct);
        }
        catch (HttpRequestException)
        {
            // Jeton effacé de notre côté de toute façon.
        }
    }

    /// <summary>Points de terminaison paramétrés par le locataire (Microsoft : {locataire}).</summary>
    public static string Url(string modele, ClientFournisseur c) => modele.Replace("{locataire}", string.IsNullOrEmpty(c.Locataire) ? "common" : c.Locataire);

    /// <summary>Formulaire du point de jeton : identifiant du client, puis assertion signée par le certificat s'il y en a un, sinon le secret.</summary>
    private static FormUrlEncodedContent Formulaire(FournisseurEntite f, ClientFournisseur c, params (string Cle, string? Valeur)[] champs)
    {
        var l = champs.Where(x => !string.IsNullOrEmpty(x.Valeur)).Select(x => new KeyValuePair<string, string>(x.Cle, x.Valeur!)).ToList();
        l.Add(new("client_id", c.IdentifiantClient));
        if (!string.IsNullOrEmpty(c.Certificat))
        {
            using var cert = AssertionsOAuth.LireCertificat(c.Certificat, c.MotDePasseCertificat);
            l.Add(new("client_assertion_type", AssertionsOAuth.TypeClientAssertion));
            l.Add(new("client_assertion", AssertionsOAuth.AssertionClient(cert, c.IdentifiantClient, UrlJeton(f, c), DateTimeOffset.UtcNow)));
        }
        else if (!string.IsNullOrEmpty(c.Secret))
        {
            l.Add(new("client_secret", c.Secret));
        }
        return new FormUrlEncodedContent(l);
    }

    private async Task<ReponseJeton> PosterAsync(string url, FormUrlEncodedContent corps, CancellationToken ct)
    {
        using var r = await http.PostAsync(url, corps, ct);
        var texte = await r.Content.ReadAsStringAsync(ct);
        if (string.IsNullOrWhiteSpace(texte) || !texte.TrimStart().StartsWith('{'))
        {
            throw new ErreurOAuth("reponse_invalide", $"Réponse HTTP {(int)r.StatusCode} du fournisseur");
        }
        return ReglesOAuth.LireReponseJeton(texte);
    }
}
