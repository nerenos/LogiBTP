using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace LogiBTP.OAuth;

/// <summary>Clé d'un compte de service Google (fichier JSON fourni par la console) : adresse du compte, clé privée PEM, point de jeton.</summary>
public sealed record CleCompteService(string ClientEmail, string PrivateKey, string? TokenUri);

/// <summary>
/// Assertions JWT signées RS256 des flux sans utilisateur : authentification d'un client par certificat (Microsoft,
/// RFC 7523 client_assertion, en-tête x5t) et compte de service Google (grant jwt-bearer, délégation sur le domaine par
/// « sub »). Sans bibliothèque externe.
/// </summary>
public static class AssertionsOAuth
{
    public const string TypeClientAssertion = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
    public const string GrantJwtBearer = "urn:ietf:params:oauth:grant-type:jwt-bearer";

    /// <summary>Certificat PKCS#12 (base64) avec sa clé privée ; mot de passe facultatif.</summary>
    public static X509Certificate2 LireCertificat(string pfxBase64, string? motDePasse) =>
        X509CertificateLoader.LoadPkcs12(Convert.FromBase64String(pfxBase64), motDePasse, X509KeyStorageFlags.EphemeralKeySet);

    /// <summary>Assertion du client signée par son certificat (10 minutes de validité) pour le point de jeton.</summary>
    public static string AssertionClient(X509Certificate2 certificat, string identifiantClient, string urlJeton, DateTimeOffset maintenant)
    {
        var entete = new JsonObject { ["alg"] = "RS256", ["typ"] = "JWT", ["x5t"] = ReglesOAuth.Base64Url(certificat.GetCertHash()) };
        var charge = new JsonObject
        {
            ["aud"] = urlJeton, ["iss"] = identifiantClient, ["sub"] = identifiantClient, ["jti"] = Guid.NewGuid().ToString(),
            ["nbf"] = maintenant.ToUnixTimeSeconds(), ["iat"] = maintenant.ToUnixTimeSeconds(), ["exp"] = maintenant.AddMinutes(10).ToUnixTimeSeconds(),
        };
        using var rsa = certificat.GetRSAPrivateKey() ?? throw new ErreurOAuth("certificat_invalide", "Le certificat n'a pas de clé privée RSA");
        return Signer(entete, charge, rsa);
    }

    /// <summary>Lit le fichier JSON de la clé d'un compte de service Google.</summary>
    public static CleCompteService LireCleCompteService(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var r = doc.RootElement;
        string? Texte(string n) => r.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        return new CleCompteService(Texte("client_email") ?? throw new ErreurOAuth("cle_invalide", "client_email absent de la clé"),
            Texte("private_key") ?? throw new ErreurOAuth("cle_invalide", "private_key absent de la clé"), Texte("token_uri"));
    }

    /// <summary>Assertion d'un compte de service (1 heure) : portées, point de jeton, boîte déléguée (sub).</summary>
    public static string AssertionCompteService(CleCompteService cle, string portees, string urlJeton, string? sujet, DateTimeOffset maintenant)
    {
        var entete = new JsonObject { ["alg"] = "RS256", ["typ"] = "JWT" };
        var charge = new JsonObject
        {
            ["iss"] = cle.ClientEmail, ["scope"] = portees.Trim(), ["aud"] = urlJeton, ["iat"] = maintenant.ToUnixTimeSeconds(), ["exp"] = maintenant.AddHours(1).ToUnixTimeSeconds(),
        };
        if (!string.IsNullOrWhiteSpace(sujet)) charge["sub"] = sujet.Trim();
        using var rsa = RSA.Create();
        rsa.ImportFromPem(cle.PrivateKey);
        return Signer(entete, charge, rsa);
    }

    private static string Signer(JsonObject entete, JsonObject charge, RSA rsa)
    {
        var contenu = $"{ReglesOAuth.Base64Url(Encoding.UTF8.GetBytes(entete.ToJsonString()))}.{ReglesOAuth.Base64Url(Encoding.UTF8.GetBytes(charge.ToJsonString()))}";
        var signature = rsa.SignData(Encoding.ASCII.GetBytes(contenu), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        return $"{contenu}.{ReglesOAuth.Base64Url(signature)}";
    }

    /// <summary>Vérifie la signature RS256 d'une assertion (tests, contrôle d'une clé saisie) et renvoie sa charge.</summary>
    public static JsonObject Verifier(string jwt, RSA cle)
    {
        var p = jwt.Split('.');
        if (p.Length != 3 || !cle.VerifyData(Encoding.ASCII.GetBytes($"{p[0]}.{p[1]}"), ReglesOAuth.DepuisBase64Url(p[2]), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1))
            throw new ErreurOAuth("signature_invalide", "Signature de l'assertion invalide");
        return JsonNode.Parse(ReglesOAuth.DepuisBase64Url(p[1]))!.AsObject();
    }
}
