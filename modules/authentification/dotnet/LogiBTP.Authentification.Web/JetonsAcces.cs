using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using LogiBTP.Socle;

namespace LogiBTP.Authentification.Web;

/// <summary>
/// Jetons d'accès (D1) : JWT HMAC-SHA256 de courte durée (5 min ; identifiant d'API : 15 min) portant la session lue, vérifié
/// sans lecture de la base. Clé dérivée de la chaîne de l'installation (aléatoire par processus si elle manque : les jetons
/// sont alors refaits par le rafraîchissement après un redémarrage). Révocation immédiate (D26) : toute fermeture, tout
/// changement de compte relève l'époque ; un jeton d'une époque antérieure n'est plus reçu et la session est relue en base.
/// Lié à la base de la société (un jeton d'une autre société est refusé).
/// </summary>
public sealed class JetonsAcces
{
    public static readonly TimeSpan Duree = TimeSpan.FromMinutes(5);
    public static readonly TimeSpan DureeApi = TimeSpan.FromMinutes(15);

    private static long epoque = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    private readonly byte[] cle;

    /// <summary>Relève l'époque : les jetons déjà émis ne sont plus reçus (sessions relues en base au prochain appel).</summary>
    public static void Invalider() => Interlocked.Increment(ref epoque);

    public JetonsAcces(Chiffrement chiffrement)
    {
        cle = chiffrement.EstConfigure
            ? SHA256.HashData(Encoding.UTF8.GetBytes(chiffrement.Empreinte("logibtp:jetons-acces")!))
            : RandomNumberGenerator.GetBytes(32);
    }

    private sealed record Charge(
        [property: JsonPropertyName("sid")] long SesId, [property: JsonPropertyName("cpt")] long CptId, [property: JsonPropertyName("cod")] string Code,
        [property: JsonPropertyName("lib")] string? Libelle, [property: JsonPropertyName("pro")] string Profil, [property: JsonPropertyName("mdp")] bool MdpAChanger,
        [property: JsonPropertyName("te")] string? TypeElement, [property: JsonPropertyName("ie")] string? IdElement,
        [property: JsonPropertyName("fin")] DateTimeOffset ExpireLe, [property: JsonPropertyName("per")] bool Persistante,
        [property: JsonPropertyName("us")] UsurpationLue? Usurpation, [property: JsonPropertyName("api")] bool Api,
        [property: JsonPropertyName("bas")] string Base, [property: JsonPropertyName("ep")] long Epoque,
        [property: JsonPropertyName("iat")] long Emis, [property: JsonPropertyName("exp")] long Expire);

    private static string B64(byte[] o) => Convert.ToBase64String(o).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] DeB64(string s)
    {
        var t = s.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(t + new string('=', (4 - t.Length % 4) % 4));
    }

    private static readonly string Entete = B64(Encoding.UTF8.GetBytes("""{"alg":"HS256","typ":"JWT"}"""));

    public string Emettre(SessionLue s, string? baseSociete, bool api = false)
    {
        var maintenant = DateTimeOffset.UtcNow;
        var charge = new Charge(s.SesId, s.CptId, s.Code, s.Libelle, s.Profil, s.MdpAChanger, s.TypeElement, s.IdElement, s.ExpireLe, s.Persistante,
            s.Usurpation, api, baseSociete ?? "", Interlocked.Read(ref epoque), maintenant.ToUnixTimeSeconds(), (maintenant + (api ? DureeApi : Duree)).ToUnixTimeSeconds());
        var corps = Entete + "." + B64(JsonSerializer.SerializeToUtf8Bytes(charge));
        return corps + "." + B64(HMACSHA256.HashData(cle, Encoding.ASCII.GetBytes(corps)));
    }

    /// <summary>Session du jeton (null : signature fausse, expiré, autre base, époque dépassée, illisible).</summary>
    public SessionLue? Lire(string? jeton, string? baseSociete, out bool api)
    {
        api = false;
        var parties = jeton?.Split('.');
        if (parties is not { Length: 3 } || parties[0] != Entete) return null;
        try
        {
            var attendue = HMACSHA256.HashData(cle, Encoding.ASCII.GetBytes(parties[0] + "." + parties[1]));
            if (!CryptographicOperations.FixedTimeEquals(attendue, DeB64(parties[2]))) return null;
            var c = JsonSerializer.Deserialize<Charge>(DeB64(parties[1]));
            if (c is null || c.Base != (baseSociete ?? "") || c.Epoque < Interlocked.Read(ref epoque)
                || DateTimeOffset.UtcNow.ToUnixTimeSeconds() >= c.Expire || c.ExpireLe <= DateTimeOffset.UtcNow) return null;
            api = c.Api;
            return new SessionLue(c.SesId, c.CptId, c.Code, c.Libelle, c.Profil, c.MdpAChanger, c.TypeElement, c.IdElement, c.ExpireLe, c.Persistante,
                DateTimeOffset.FromUnixTimeSeconds(c.Emis), c.Usurpation);
        }
        catch (Exception e) when (e is FormatException or JsonException)
        {
            return null;
        }
    }
}
