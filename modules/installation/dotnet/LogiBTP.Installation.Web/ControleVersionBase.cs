using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;
using System.Collections.Concurrent;

namespace LogiBTP.Installation.Web;

/// <summary>
/// Contrôle par société de la version de la base (plan versionnement-schema, lot 6 ; analyse P33, P34).
/// <list type="bullet">
/// <item>Base en retard (une version attendue manque dans <c>v_version_module</c>) : toutes les routes /api de la société
/// répondent 503 avec le code d'erreur configuré, sauf en développement (modifications manuelles admises, P37) où la base est
/// seulement signalée (avertissement au journal et en-tête <see cref="EnteteEnRetard"/>). Les autres sociétés sont servies.</item>
/// <item>Base sans journal <c>installation_script</c> (base de développement, e2e, démonstration Vercel) : jamais bloquée,
/// avertissement journalisé une fois.</item>
/// <item>Résultat gardé par base (clé : connexion) et relu au plus tous les <see cref="Intervalle"/> ; quand l'empreinte du
/// journal change (une mise à jour a eu lieu), les caches enregistrés sous <see cref="IPurgeCacheBase"/> sont vidés pour cette base.</item>
/// <item>Base injoignable : rien n'est mis en cache, la requête suit son cours (l'erreur technique habituelle).</item>
/// </list>
/// Sans versions attendues (aucun manifeste), le contrôle est inactif.
/// </summary>
public sealed class ControleVersionBase(VersionsAttendues attendues, string codeErreur, IEnumerable<IPurgeCacheBase> purges, IHostEnvironment environnement,
    ILogger<ControleVersionBase> journal, TimeProvider? temps = null)
{
    public const string EnteteEnRetard = "X-LogiBTP-Base-En-Retard";
    public const string CommandeMiseAJour = "installation base mettre-a-jour";

    private sealed record Entree(EtatVersionsBase Etat, DateTimeOffset LuLe);

    private readonly ConcurrentDictionary<string, Entree> _etats = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, byte> _signales = new(StringComparer.Ordinal);
    private readonly TimeProvider _temps = temps ?? TimeProvider.System;

    /// <summary>Délai entre deux lectures du journal d'une base.</summary>
    public TimeSpan Intervalle { get; set; } = TimeSpan.FromSeconds(15);

    public VersionsAttendues Attendues => attendues;
    public string CodeErreur => codeErreur;
    public bool Bloquant => !environnement.IsDevelopment();

    /// <summary>Oublie le résultat d'une base (ou de toutes) : relecture à la prochaine requête.</summary>
    public void Invalider(string? connexion = null)
    {
        if (connexion is null) _etats.Clear();
        else _etats.TryRemove(connexion, out _);
    }

    /// <summary>État de la base d'une société, relu si le délai est passé ; null si la base est injoignable.</summary>
    public async Task<EtatVersionsBase?> EtatAsync(SocieteCourante societe, CancellationToken ct)
    {
        if (attendues.ParModule.Count == 0 || string.IsNullOrEmpty(societe.Connexion)) return null;
        var maintenant = _temps.GetUtcNow();
        var connu = _etats.TryGetValue(societe.Connexion, out var e) ? e : null;
        if (connu is not null && maintenant - connu.LuLe < Intervalle) return connu.Etat;
        EtatVersionsBase lu;
        try { lu = await attendues.LireAsync(societe.Connexion, ct); }
        catch (Exception ex) when (ex is NpgsqlException or InvalidOperationException or TimeoutException)
        {
            journal.LogWarning("Contrôle de version de la base de la société « {Societe} » impossible : {Erreur}", societe.Libelle, Masquage.Texte(ex.Message));
            return null;
        }
        _etats[societe.Connexion] = new Entree(lu, maintenant);
        if (connu is not null && connu.Etat.Empreinte != lu.Empreinte)
        {
            foreach (var p in purges) p.Purger(societe.Connexion);
            _signales.TryRemove(societe.Connexion, out _);
            journal.LogInformation("Base de la société « {Societe} » mise à jour : caches du schéma vidés", societe.Libelle);
        }
        Signaler(societe, lu);
        return lu;
    }

    /// <summary>Message d'une base en retard : modules et versions manquantes, commande à lancer.</summary>
    public static string Message(SocieteCourante societe, EtatVersionsBase etat) =>
        $"La base de la société « {societe.Libelle} » n'est pas à la version attendue par cette application ({string.Join(", ", etat.Manquantes)}). " +
        $"Un administrateur doit lancer la commande « {CommandeMiseAJour} » (sauvegarde préalable recommandée) puis réessayer.";

    private void Signaler(SocieteCourante societe, EtatVersionsBase etat)
    {
        if (etat.Statut == StatutVersionsBase.AJour || !_signales.TryAdd(societe.Connexion, 0)) return;
        if (etat.Statut == StatutVersionsBase.SansJournal)
            journal.LogWarning("Base de la société « {Societe} » sans journal des scripts ({Table}) : version du schéma non contrôlée (base de développement, d'essai ou de démonstration)",
                societe.Libelle, BaseDonnees.TableJournal);
        else if (Bloquant)
            journal.LogError("{Code} : {Message}", codeErreur, Message(societe, etat));
        else
            journal.LogWarning("Base de la société « {Societe} » en retard ({Manquantes}) : non bloquée en développement", societe.Libelle, string.Join(", ", etat.Manquantes));
    }

    /// <summary>Intergiciel : à placer après <c>UseSocietes</c> et avant l'authentification.</summary>
    public async Task InvoquerAsync(HttpContext http, RequestDelegate suite)
    {
        var chemin = http.Request.Path;
        if (!chemin.StartsWithSegments("/api") || chemin.StartsWithSegments("/api/sante") || chemin.StartsWithSegments("/api/societe"))
        {
            await suite(http);
            return;
        }
        var societe = http.RequestServices.GetRequiredService<SocieteCourante>();
        var etat = await EtatAsync(societe, http.RequestAborted);
        if (etat is { Statut: StatutVersionsBase.EnRetard })
        {
            if (Bloquant)
            {
                http.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
                await http.Response.WriteAsJsonAsync(new
                {
                    status = 503,
                    code = codeErreur,
                    title = Message(societe, etat),
                    details = new { commande = CommandeMiseAJour, manquantes = etat.Manquantes.Select(m => new { module = m.Module, attendue = m.Attendue.ToString(), trouvee = m.Trouvee?.ToString() }) },
                }, JsonCalcul.Options);
                return;
            }
            http.Response.Headers[EnteteEnRetard] = string.Join(", ", etat.Manquantes);
        }
        await suite(http);
    }
}

/// <summary>Vérification au démarrage : base principale lue une fois (avertissement ou erreur au journal), sans jamais empêcher le démarrage.</summary>
public sealed class ControleVersionDemarrage(ControleVersionBase controle, Microsoft.Extensions.Options.IOptions<OptionsSocietes> societes) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        var principale = societes.Value.Societes().FirstOrDefault(s => s.Principale);
        // En tâche de fond : une base lente ou injoignable ne retarde pas le démarrage (le contrôle par requête suit).
        if (principale is not null) _ = Task.Run(async () => { try { await controle.EtatAsync(principale, CancellationToken.None); } catch (Exception) { } }, CancellationToken.None);
        await Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}

public static class ExtensionsControleVersionBase
{
    /// <summary>Enregistre le contrôle (versions attendues, code d'erreur du 503) et la vérification au démarrage.</summary>
    public static IServiceCollection AddControleVersionBase(this IServiceCollection services, VersionsAttendues attendues, string codeErreur)
    {
        services.AddSingleton(sp => new ControleVersionBase(attendues, codeErreur, sp.GetServices<IPurgeCacheBase>(), sp.GetRequiredService<IHostEnvironment>(),
            sp.GetRequiredService<ILogger<ControleVersionBase>>()));
        services.AddHostedService<ControleVersionDemarrage>();
        return services;
    }

    public static IApplicationBuilder UseControleVersionBase(this IApplicationBuilder app) =>
        app.Use((http, suite) => http.RequestServices.GetRequiredService<ControleVersionBase>().InvoquerAsync(http, suite));
}
