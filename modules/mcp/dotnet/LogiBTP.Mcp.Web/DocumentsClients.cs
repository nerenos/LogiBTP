using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;

namespace LogiBTP.Mcp.Web;

/// <summary>
/// Lecture des documents de métadonnées des clients OAuth (CIMD : le <c>client_id</c> est l'adresse https du document).
/// Substituable (enregistrer une autre implémentation avant <c>AddModuleMcp</c>) : tests, installation sans accès sortant.
/// Appelé seulement pour un client de la liste blanche de la société (jamais une adresse quelconque : pas de requête
/// sortante imposée par un inconnu).
/// </summary>
public interface IDocumentsClients
{
    /// <summary>Document du client lu à son adresse (null : injoignable, trop gros, non JSON).</summary>
    Task<DocumentClient?> LireAsync(string clientId, CancellationToken ct);
}

/// <summary>
/// Documents des clients lus en HTTPS (5 s, 16 Kio au plus, sans redirection suivie), gardés 10 minutes en mémoire (les
/// documents sont publics et communs à toutes les sociétés).
/// </summary>
public sealed class DocumentsClientsHttp : IDocumentsClients
{
    private static readonly HttpClient Http = new(new SocketsHttpHandler { AllowAutoRedirect = false, PooledConnectionLifetime = TimeSpan.FromMinutes(5) })
    {
        Timeout = TimeSpan.FromSeconds(5),
    };
    private static readonly ConcurrentDictionary<string, (DocumentClient Document, DateTimeOffset Lu)> Cache = new();
    private static readonly TimeSpan Duree = TimeSpan.FromMinutes(10);

    public async Task<DocumentClient?> LireAsync(string clientId, CancellationToken ct)
    {
        if (!ReglesOAuth.ClientIdValide(clientId)) return null;
        if (Cache.TryGetValue(clientId, out var c) && DateTimeOffset.UtcNow - c.Lu < Duree) return c.Document;
        try
        {
            using var requete = new HttpRequestMessage(HttpMethod.Get, clientId);
            requete.Headers.Accept.ParseAdd("application/json");
            using var r = await Http.SendAsync(requete, HttpCompletionOption.ResponseHeadersRead, ct);
            if (r.StatusCode != HttpStatusCode.OK || r.Content.Headers.ContentLength > ReglesOAuth.TailleDocumentMax) return null;
            await using var flux = await r.Content.ReadAsStreamAsync(ct);
            var tampon = new byte[ReglesOAuth.TailleDocumentMax + 1];
            var lus = 0;
            int n;
            while (lus < tampon.Length && (n = await flux.ReadAsync(tampon.AsMemory(lus), ct)) > 0) lus += n;
            if (lus > ReglesOAuth.TailleDocumentMax) return null;
            var d = Analyser(tampon.AsSpan(0, lus));
            if (d is not null) Cache[clientId] = (d, DateTimeOffset.UtcNow);
            return d;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException)
        {
            return null;
        }
    }

    /// <summary>Document de client depuis son JSON (champs de la RFC 7591) ; null s'il n'est pas un objet.</summary>
    public static DocumentClient? Analyser(ReadOnlySpan<byte> json)
    {
        using var doc = JsonDocument.Parse(json.ToArray());
        var r = doc.RootElement;
        if (r.ValueKind != JsonValueKind.Object) return null;
        static string? Texte(JsonElement o, string cle) => o.TryGetProperty(cle, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        static IReadOnlyList<string>? Liste(JsonElement o, string cle) => o.TryGetProperty(cle, out var v) && v.ValueKind == JsonValueKind.Array
            ? v.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToList() : null;
        return new DocumentClient(Texte(r, "client_id") ?? "", Texte(r, "client_name") ?? "", Liste(r, "redirect_uris") ?? [],
            Texte(r, "token_endpoint_auth_method"), Liste(r, "grant_types"), Liste(r, "response_types"));
    }
}
