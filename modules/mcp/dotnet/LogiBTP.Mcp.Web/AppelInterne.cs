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
/// Appel interne par HTTP vers l'adresse locale du serveur (Kestrel, <see cref="IServerAddressesFeature"/>) : l'adresse de
/// l'URL est l'hôte de la requête MCP (même société, même nom pour TLS), la connexion est ouverte sur le port local de la
/// machine. HTTP local préféré quand Kestrel en écoute un (pas de certificat à faire reconnaître par le conteneur) ;
/// redirigé vers HTTPS (certificat de l'installation actif : UseHttpsInstallation), l'appel bascule une fois pour toutes
/// sur l'adresse HTTPS locale. Aucune redirection suivie.
/// </summary>
public sealed class AppelInterneHttp(IServer serveur) : IAppelInterne, IDisposable
{
    private readonly Dictionary<string, HttpClient> clients = [];
    private IReadOnlyList<Uri>? locales;
    private bool basculeHttps;
    private readonly Lock verrou = new();

    /// <summary>Adresses locales du serveur, hôte joker ramené à la boucle locale : HTTP d'abord, puis HTTPS.</summary>
    public static IReadOnlyList<Uri> AdressesLocales(IEnumerable<string> adresses)
    {
        var liste = adresses.Select(a => a.Replace("://+", "://127.0.0.1").Replace("://*", "://127.0.0.1").Replace("://0.0.0.0", "://127.0.0.1")
                .Replace("://[::]", "://[::1]"))
            .Select(a => Uri.TryCreate(a, UriKind.Absolute, out var u) ? u : null).OfType<Uri>().ToList();
        return [.. liste.Where(u => u.Scheme == Uri.UriSchemeHttp), .. liste.Where(u => u.Scheme == Uri.UriSchemeHttps)];
    }

    /// <summary>Adresse locale retenue : HTTP si Kestrel en écoute une, sinon HTTPS.</summary>
    public static Uri? AdresseLocale(IEnumerable<string> adresses) => AdressesLocales(adresses).FirstOrDefault();

    /// <summary>Réponse de redirection vers HTTPS (HTTP refusé par l'installation) : l'appel doit passer en HTTPS.</summary>
    public static bool RedirigeVersHttps(int statut, Uri? location) =>
        statut is 301 or 302 or 307 or 308 && location is { IsAbsoluteUri: true } l && l.Scheme == Uri.UriSchemeHttps;

    private (HttpClient, Uri) Client()
    {
        lock (verrou)
        {
            locales ??= AdressesLocales(serveur.Features.Get<IServerAddressesFeature>()?.Addresses ?? []);
            var cible = (basculeHttps ? locales.FirstOrDefault(u => u.Scheme == Uri.UriSchemeHttps) : null) ?? locales.FirstOrDefault()
                ?? throw new InvalidOperationException("MCP : adresse locale du serveur inconnue (Kestrel non démarré)");
            var cle = cible.ToString();
            if (clients.TryGetValue(cle, out var existant)) return (existant, cible);
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
            var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(100) };
            clients[cle] = client;
            return (client, cible);
        }
    }

    public async Task<ReponseInterne> EnvoyerAsync(RequeteInterne requete, CancellationToken ct)
    {
        for (var essai = 0; ; essai++)
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
            if (essai == 0 && adresse.Scheme == Uri.UriSchemeHttp && RedirigeVersHttps((int)reponse.StatusCode, reponse.Headers.Location))
            {
                lock (verrou)
                {
                    if (locales?.Any(u => u.Scheme == Uri.UriSchemeHttps) == true)
                    {
                        basculeHttps = true;
                        continue;
                    }
                }
            }
            return new ReponseInterne((int)reponse.StatusCode, await reponse.Content.ReadAsStringAsync(ct));
        }
    }

    public void Dispose()
    {
        foreach (var c in clients.Values) c.Dispose();
    }
}
