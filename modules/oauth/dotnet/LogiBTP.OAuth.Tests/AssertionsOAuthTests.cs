using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json.Nodes;
using Xunit;

namespace LogiBTP.OAuth.Tests;

public class AssertionsOAuthTests
{
    private static readonly DateTimeOffset Maintenant = new(2026, 10, 23, 10, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Assertion_du_client_par_certificat()
    {
        using var rsa = RSA.Create(2048);
        var demande = new CertificateRequest("CN=LogiBTP essai", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var cert = demande.CreateSelfSigned(Maintenant.AddDays(-1), Maintenant.AddYears(1));
        var pfx = Convert.ToBase64String(cert.Export(X509ContentType.Pkcs12, "mdp"));
        using var lu = AssertionsOAuth.LireCertificat(pfx, "mdp");
        Assert.Equal(cert.NotAfter, lu.NotAfter);
        var jwt = AssertionsOAuth.AssertionClient(lu, "client-1", "https://login.microsoftonline.com/l/oauth2/v2.0/token", Maintenant);
        var charge = AssertionsOAuth.Verifier(jwt, rsa);
        Assert.Equal(("client-1", "client-1", "https://login.microsoftonline.com/l/oauth2/v2.0/token"),
            (charge["iss"]!.GetValue<string>(), charge["sub"]!.GetValue<string>(), charge["aud"]!.GetValue<string>()));
        Assert.Equal(Maintenant.AddMinutes(10).ToUnixTimeSeconds(), charge["exp"]!.GetValue<long>());
        var entete = JsonNode.Parse(ReglesOAuth.DepuisBase64Url(jwt.Split('.')[0]))!;
        Assert.Equal(ReglesOAuth.Base64Url(cert.GetCertHash()), entete["x5t"]!.GetValue<string>());
        using var autre = RSA.Create(2048);
        Assert.Throws<ErreurOAuth>(() => AssertionsOAuth.Verifier(jwt, autre));
    }

    [Fact]
    public void Assertion_d_un_compte_de_service_avec_delegation()
    {
        using var rsa = RSA.Create(2048);
        var cle = new JsonObject { ["client_email"] = "logibtp@projet.iam.gserviceaccount.com", ["private_key"] = rsa.ExportPkcs8PrivateKeyPem(), ["token_uri"] = "https://oauth2.googleapis.com/token" };
        var lue = AssertionsOAuth.LireCleCompteService(cle.ToJsonString());
        Assert.Equal("https://oauth2.googleapis.com/token", lue.TokenUri);
        var charge = AssertionsOAuth.Verifier(AssertionsOAuth.AssertionCompteService(lue, " https://mail.google.com/ ", lue.TokenUri!, "boite@societe.fr", Maintenant), rsa);
        Assert.Equal(("logibtp@projet.iam.gserviceaccount.com", "https://mail.google.com/", "boite@societe.fr"),
            (charge["iss"]!.GetValue<string>(), charge["scope"]!.GetValue<string>(), charge["sub"]!.GetValue<string>()));
        Assert.Throws<ErreurOAuth>(() => AssertionsOAuth.LireCleCompteService("""{"client_email":"x"}"""));
    }
}
