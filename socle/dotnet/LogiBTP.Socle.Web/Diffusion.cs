using System.Collections.Concurrent;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Socle.Web;

/// <summary>
/// Diffusion en temps réel aux navigateurs (événements envoyés par le serveur, flux text/event-stream) : un abonné
/// reçoit les événements des sujets demandés (planning, crm…) de la base de sa société. Mémoire du processus : une
/// instance de l'API (plusieurs instances : à relayer par la base, par exemple LISTEN / NOTIFY).
/// </summary>
public sealed class Diffuseur
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };
    private readonly ConcurrentDictionary<Guid, Abonne> abonnes = new();

    private sealed record Abonne(string Base, HashSet<string> Sujets, Channel<string> Canal);

    /// <summary>Envoie un événement aux abonnés du sujet dans la base de la société.</summary>
    public void Publier(SocieteCourante societe, string sujet, object donnees)
    {
        var texte = JsonSerializer.Serialize(new { sujet, donnees, le = DateTimeOffset.UtcNow }, Json);
        var b = societe.Base ?? "";
        foreach (var a in abonnes.Values)
        {
            if (a.Base == b && a.Sujets.Contains(sujet)) a.Canal.Writer.TryWrite(texte);
        }
    }

    internal (Guid Id, ChannelReader<string> Lecteur) Abonner(SocieteCourante societe, IEnumerable<string> sujets)
    {
        var id = Guid.NewGuid();
        var canal = Channel.CreateBounded<string>(new BoundedChannelOptions(500) { FullMode = BoundedChannelFullMode.DropOldest });
        abonnes[id] = new Abonne(societe.Base ?? "", [.. sujets], canal);
        return (id, canal.Reader);
    }

    internal void Desabonner(Guid id) => abonnes.TryRemove(id, out _);

    public int NombreAbonnes => abonnes.Count;
}

public static class ExtensionsDiffusion
{
    public static IServiceCollection AddDiffusion(this IServiceCollection services) => services.AddSingleton<Diffuseur>();

    /// <summary>GET /diffusion?sujets=a,b : flux d'événements (« data: … »), commentaire de maintien toutes les 25 s.</summary>
    public static RouteGroupBuilder MapDiffusion(this RouteGroupBuilder api)
    {
        api.MapGet("/diffusion", async (string sujets, HttpContext http, Diffuseur d, SocieteCourante societe, CancellationToken ct) =>
        {
            http.Response.Headers.ContentType = "text/event-stream";
            http.Response.Headers.CacheControl = "no-cache";
            http.Response.Headers["X-Accel-Buffering"] = "no";
            var (id, lecteur) = d.Abonner(societe, sujets.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
            try
            {
                await http.Response.WriteAsync(": ouvert\n\n", ct);
                await http.Response.Body.FlushAsync(ct);
                while (!ct.IsCancellationRequested)
                {
                    using var delai = CancellationTokenSource.CreateLinkedTokenSource(ct);
                    delai.CancelAfter(TimeSpan.FromSeconds(25));
                    try
                    {
                        if (await lecteur.WaitToReadAsync(delai.Token))
                        {
                            while (lecteur.TryRead(out var e)) await http.Response.WriteAsync($"data: {e}\n\n", ct);
                        }
                    }
                    catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                    {
                        await http.Response.WriteAsync(": maintien\n\n", ct);
                    }
                    await http.Response.Body.FlushAsync(ct);
                }
            }
            catch (OperationCanceledException)
            {
                // Navigateur fermé ou page quittée.
            }
            finally
            {
                d.Desabonner(id);
            }
        });
        return api;
    }
}
