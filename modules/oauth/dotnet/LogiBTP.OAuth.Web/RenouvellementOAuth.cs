using LogiBTP.Socle.Web;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace LogiBTP.OAuth.Web;

/// <summary>
/// Tâche de fond (sur le modèle du planificateur des notifications) : à chaque réveil (60 min par défaut), pour la base
/// principale puis chaque société, <see cref="ServiceOAuth.PasserAsync"/> (renouvellement préventif, rappels
/// d'échéance). Une base en erreur n'empêche pas les suivantes.
/// </summary>
public sealed class RenouvellementOAuth(IServiceProvider services, IOptions<OptionsOAuth> options, IOptions<OptionsSocietes> societes,
    ILogger<RenouvellementOAuth> journal, TimeProvider horloge) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var o = options.Value;
        if (!o.Actif)
        {
            journal.LogInformation("Renouvellement des connexions OAuth désactivé (OAuth:Actif)");
            return;
        }
        try { await Task.Delay(TimeSpan.FromSeconds(20), horloge, ct); } catch (OperationCanceledException) { return; }
        while (!ct.IsCancellationRequested)
        {
            await ExecuterAsync(ct);
            try { await Task.Delay(TimeSpan.FromMinutes(Math.Max(1, o.IntervalleMinutes)), horloge, ct); } catch (OperationCanceledException) { return; }
        }
    }

    /// <summary>Un passage sur toutes les bases.</summary>
    public async Task ExecuterAsync(CancellationToken ct)
    {
        foreach (var societe in societes.Value.Societes())
        {
            try
            {
                await using var portee = services.CreerPorteeSociete(societe);
                await portee.ServiceProvider.GetRequiredService<ServiceOAuth>().PasserAsync(ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                journal.LogWarning(e, "OAuth : base {Societe} non traitée", societe.Libelle);
            }
        }
    }
}
