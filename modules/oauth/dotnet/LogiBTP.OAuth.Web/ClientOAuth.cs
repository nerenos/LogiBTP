namespace LogiBTP.OAuth.Web;

/// <summary>Client du fournisseur (identifiant, secret, locataire) : valeur déchiffrée de oco_client.</summary>
public sealed record ClientFournisseur(string IdentifiantClient, string? Secret, string? Locataire);

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
        PosterAsync(Url(f.OfoUrlJeton, c), Formulaire(c, ("grant_type", "authorization_code"), ("code", code), ("code_verifier", verificateur), ("redirect_uri", adresseRetour)), ct);

    public virtual Task<ReponseJeton> RafraichirAsync(FournisseurEntite f, ClientFournisseur c, string rafraichissement, string? portees, CancellationToken ct) =>
        PosterAsync(Url(f.OfoUrlJeton, c), Formulaire(c, ("grant_type", "refresh_token"), ("refresh_token", rafraichissement), ("scope", portees)), ct);

    /// <summary>Révocation du jeton auprès du fournisseur (sans effet si le fournisseur n'en a pas) ; une erreur est ignorée.</summary>
    public virtual async Task RevoquerAsync(FournisseurEntite f, ClientFournisseur c, string jeton, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(f.OfoUrlRevocation)) return;
        try
        {
            using var r = await http.PostAsync(Url(f.OfoUrlRevocation, c), new FormUrlEncodedContent([new("token", jeton)]), ct);
        }
        catch (HttpRequestException)
        {
            // Jeton effacé de notre côté de toute façon.
        }
    }

    /// <summary>Points de terminaison paramétrés par le locataire (Microsoft : {locataire}).</summary>
    public static string Url(string modele, ClientFournisseur c) => modele.Replace("{locataire}", string.IsNullOrEmpty(c.Locataire) ? "common" : c.Locataire);

    private static FormUrlEncodedContent Formulaire(ClientFournisseur c, params (string Cle, string? Valeur)[] champs)
    {
        var l = champs.Where(x => !string.IsNullOrEmpty(x.Valeur)).Select(x => new KeyValuePair<string, string>(x.Cle, x.Valeur!)).ToList();
        l.Add(new("client_id", c.IdentifiantClient));
        if (!string.IsNullOrEmpty(c.Secret)) l.Add(new("client_secret", c.Secret));
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
