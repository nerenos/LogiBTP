using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace LogiBTP.Notifications.Web;

/// <summary>Réglages du planificateur (section « Notifications ») : Actif, intervalle de réveil (secondes), purge (jours).</summary>
public sealed class OptionsNotifications
{
    public bool Actif { get; set; } = true;
    public int IntervalleSecondes { get; set; } = 60;
    public int PurgeJours { get; set; } = 90;
}

/// <summary>
/// Planificateur de fond (sur le modèle d'ArchivageGed) : à chaque réveil, pour la base principale puis chaque société,
/// exécute les sources dont la période est écoulée (dernière exécution par base dans notification_execution) et publie
/// leurs notifications ; une fois par jour, purge les notifications traitées anciennes. Une base ou une source en erreur
/// n'empêche pas les suivantes (erreur notée).
/// </summary>
public class PlanificateurNotifications(IServiceProvider services, IOptions<OptionsNotifications> options, IOptions<OptionsSocietes> societes,
    ILogger<PlanificateurNotifications> journal, TimeProvider horloge) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var o = options.Value;
        if (!o.Actif)
        {
            journal.LogInformation("Planificateur des notifications désactivé (Notifications:Actif)");
            return;
        }
        try { await Task.Delay(TimeSpan.FromSeconds(10), horloge, ct); } catch (OperationCanceledException) { return; }
        while (!ct.IsCancellationRequested)
        {
            await ExecuterAsync(ct);
            try { await Task.Delay(TimeSpan.FromSeconds(Math.Max(10, o.IntervalleSecondes)), horloge, ct); } catch (OperationCanceledException) { return; }
        }
    }

    /// <summary>Un passage sur toutes les bases (aussi appelé par les tests et l'administration).</summary>
    public async Task ExecuterAsync(CancellationToken ct)
    {
        foreach (var societe in societes.Value.Societes())
        {
            try
            {
                await using var portee = services.CreerPorteeSociete(societe);
                await ExecuterBaseAsync(portee.ServiceProvider, ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                journal.LogWarning(e, "Notifications : base {Societe} non traitée", societe.Libelle);
            }
        }
    }

    public async Task ExecuterBaseAsync(IServiceProvider portee, CancellationToken ct)
    {
        var db = portee.GetRequiredService<NotificationDbContext>();
        var service = portee.GetRequiredService<ServiceNotification>();
        var maintenant = horloge.GetUtcNow();
        var executions = await db.Executions.ToDictionaryAsync(x => x.NexSource, ct);
        foreach (var source in portee.GetServices<ISourceNotifications>())
        {
            if (executions.TryGetValue(source.Code, out var e) && e.NexDerniere is { } d && maintenant - d < source.Periode) continue;
            if (e is null) db.Executions.Add(e = new ExecutionEntite { NexSource = source.Code });
            try
            {
                e.NexPubliees = await service.PublierAsync(await source.ProduireAsync(portee, maintenant, ct), ct);
                e.NexErreur = null;
            }
            catch (Exception x) when (x is not OperationCanceledException)
            {
                e.NexErreur = x.Message.Length > 2000 ? x.Message[..2000] : x.Message;
                journal.LogWarning(x, "Notifications : source {Source} en erreur", source.Code);
            }
            e.NexDerniere = maintenant;
            await db.SaveChangesAsync(ct);
        }
        // Purge quotidienne des notifications traitées anciennes.
        if (!executions.TryGetValue("purge", out var p) || p.NexDerniere is not { } dp || maintenant - dp > TimeSpan.FromDays(1))
        {
            if (p is null) db.Executions.Add(p = new ExecutionEntite { NexSource = "purge" });
            p.NexPubliees = await service.PurgerAsync(options.Value.PurgeJours, ct);
            p.NexDerniere = maintenant;
            await db.SaveChangesAsync(ct);
        }
    }
}
