using System.Net;
using LogiBTP.OAuth.Web;
using Xunit;

namespace LogiBTP.OAuth.Tests;

/// <summary>
/// Flux CLIENT (client_credentials) d'un fournisseur GENERIQUE : adresse du jeton saisie, client_id / secret, portées.
/// Faux point de jeton en mémoire, aucun appel réseau.
/// </summary>
public sealed class ClientOAuthGeneriqueTests
{
    private sealed class FauxJeton : HttpMessageHandler
    {
        public Uri? Adresse { get; private set; }
        public string? Corps { get; private set; }
        public int Appels { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage requete, CancellationToken ct)
        {
            Adresse = requete.RequestUri;
            Corps = await requete.Content!.ReadAsStringAsync(ct);
            Appels++;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($$"""{"access_token":"jeton-{{Appels}}","token_type":"Bearer","expires_in":1800}""", System.Text.Encoding.UTF8, "application/json"),
            };
        }
    }

    private static readonly FournisseurEntite Generique = new() { OfoCode = "GENERIQUE", OfoLibelle = "Autre fournisseur", OfoActif = true };

    [Fact]
    public async Task Jeton_client_credentials_sur_l_adresse_saisie_avec_identifiant_secret_et_portees()
    {
        var faux = new FauxJeton();
        var client = new ClientOAuth(new HttpClient(faux));
        var saisi = new ClientFournisseur("client-9", "secret-9", null, UrlJeton: "https://auth.exemple.test/oauth/token");

        var r = await client.ClientCredentialsAsync(Generique, saisi, "lecture ecriture", default);

        Assert.Equal("jeton-1", r.Acces);
        Assert.Equal(1800, r.ExpireDans);
        Assert.Equal("https://auth.exemple.test/oauth/token", faux.Adresse!.ToString());
        Assert.Contains("grant_type=client_credentials", faux.Corps);
        Assert.Contains("client_id=client-9", faux.Corps);
        Assert.Contains("client_secret=secret-9", faux.Corps);
        Assert.Contains("scope=lecture+ecriture", faux.Corps);

        // Renouvellement : nouvel appel, nouveau jeton (pas de jeton de rafraîchissement dans ce flux).
        Assert.Equal("jeton-2", (await client.ClientCredentialsAsync(Generique, saisi, "lecture ecriture", default)).Acces);
    }
}
