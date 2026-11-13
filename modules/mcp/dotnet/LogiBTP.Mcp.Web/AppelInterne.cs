using System.Net;
using System.Net.Sockets;
using System.Text;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;

namespace LogiBTP.Mcp.Web;

/// <summary>
/// Requête interne d'un outil : méthode, chemin /api (avec ses paramètres), corps JSON, en-tête Host de la requête MCP
/// (société du sous-domaine) et Authorization du jeton délégué (jamais d'autre identité : R1).
/// </summary>
public sealed record RequeteInterne(string Methode, string Chemin, string? Corps, string Hote, string Authorization);

/// <summary>Réponse d'une requête interne : statut HTTP et corps (texte).</summary>
public sealed record ReponseInterne(int Statut, string Corps);

/// <summary>Exécution des outils par la route /api existante (pipeline complet) ; substituable en test.</summary>
public interface IAppelInterne
{
    Task<ReponseInterne> EnvoyerAsync(RequeteInterne requete, CancellationToken ct);
}

/// <summary>
/// Appel interne par HTTP vers l'adresse locale du serveur (Kestrel, <see cref="IServerAddressesFeature"/>, HTTPS
/// préféré) : l'adresse de l'URL est l'hôte de la requête MCP (même société, même nom pour TLS), la connexion est
/// ouverte sur le port local de la machine. Aucune redirection suivie.
/// </summary>
public sealed class AppelInterneHttp(IServer serveur) : IAppelInterne, IDisposable
{
    private HttpClient? client;
    private Uri? locale;
    private readonly Lock verrou = new();

    /// <summary>Adresse locale retenue parmi celles du serveur : HTTPS d'abord, hôte joker ramené à la boucle locale.</summary>
    public static Uri? AdresseLocale(IEnumerable<string> adresses)
    {
        var liste = adresses.Select(a => a.Replace("://+", "://127.0.0.1").Replace("://*", "://127.0.0.1").Replace("://0.0.0.0", "://127.0.0.1")
                .Replace("://[::]", "://[::1]"))
            .Select(a => Uri.TryCreate(a, UriKind.Absolute, out var u) ? u : null).OfType<Uri>().ToList();
        return liste.FirstOrDefault(u => u.Scheme == Uri.UriSchemeHttps) ?? liste.FirstOrDefault(u => u.Scheme == Uri.UriSchemeHttp);
    }

    private (HttpClient, Uri) Client()
    {
        lock (verrou)
        {
            if (client is not null && locale is not null) return (client, locale);
            var adresses = serveur.Features.Get<IServerAddressesFeature>()?.Addresses ?? [];
            locale = AdresseLocale(adresses) ?? throw new InvalidOperationException("MCP : adresse locale du serveur inconnue (Kestrel non démarré)");
            var cible = locale;
            var handler = new SocketsHttpHandler
            {
                AllowAutoRedirect = false,
                UseCookies = false,
                // L'URL porte l'hôte de la requête (Host, SNI) ; la connexion part vers le port local du serveur.
                ConnectCallback = async (contexte, jeton) =>
                {
                    var adresses = IPAddress.TryParse(cible.DnsSafeHost, out var ip) ? [ip] : await Dns.GetHostAddressesAsync(cible.DnsSafeHost, jeton);
                    var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
                    try
                    {
                        await socket.ConnectAsync(adresses, cible.Port, jeton);
                        return new NetworkStream(socket, ownsSocket: true);
                    }
                    catch
                    {
                        socket.Dispose();
                        throw;
                    }
                },
            };
            client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(100) };
            return (client, locale);
        }
    }

    public async Task<ReponseInterne> EnvoyerAsync(RequeteInterne requete, CancellationToken ct)
    {
        var (http, adresse) = Client();
        var hote = new HostString(requete.Hote).Host;
        if (string.IsNullOrEmpty(hote)) hote = adresse.Host;
        var url = new UriBuilder(adresse.Scheme, hote, adresse.Port).Uri;
        using var message = new HttpRequestMessage(new HttpMethod(requete.Methode), new Uri(url, requete.Chemin));
        message.Headers.Host = string.IsNullOrEmpty(requete.Hote) ? null : requete.Hote;
        message.Headers.TryAddWithoutValidation("Authorization", requete.Authorization);
        message.Headers.Accept.ParseAdd("application/json");
        if (requete.Corps is not null) message.Content = new StringContent(requete.Corps, Encoding.UTF8, "application/json");
        using var reponse = await http.SendAsync(message, ct);
        return new ReponseInterne((int)reponse.StatusCode, await reponse.Content.ReadAsStringAsync(ct));
    }

    public void Dispose() => client?.Dispose();
}
