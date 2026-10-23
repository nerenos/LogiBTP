using LogiBTP.Socle.Web;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace LogiBTP.Mail.Web;

/// <summary>Réglages du module (section « Mail ») : tâche d'envoi (intervalle en secondes, messages par compte et par passage).</summary>
public sealed class OptionsMail
{
    public bool Actif { get; set; } = true;
    public int IntervalleSecondes { get; set; } = 15;
    public int MessagesParPassage { get; set; } = 50;
}

/// <summary>
/// Tâche de fond de l'envoi : à chaque réveil, pour la base principale puis chaque société, traite la file
/// (<see cref="ServiceEnvoiMail.TraiterFileAsync"/>). Une base en erreur n'empêche pas les suivantes.
/// </summary>
public sealed class EnvoiMail(IServiceProvider services, IOptions<OptionsMail> options, IOptions<OptionsSocietes> societes,
    ILogger<EnvoiMail> journal, TimeProvider horloge) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var o = options.Value;
        if (!o.Actif)
        {
            journal.LogInformation("Envoi des courriels désactivé (Mail:Actif)");
            return;
        }
        try { await Task.Delay(TimeSpan.FromSeconds(15), horloge, ct); } catch (OperationCanceledException) { return; }
        while (!ct.IsCancellationRequested)
        {
            await ExecuterAsync(ct);
            try { await Task.Delay(TimeSpan.FromSeconds(Math.Max(5, o.IntervalleSecondes)), horloge, ct); } catch (OperationCanceledException) { return; }
        }
    }

    public async Task ExecuterAsync(CancellationToken ct)
    {
        foreach (var societe in societes.Value.Societes())
        {
            try
            {
                await using var portee = services.CreerPorteeSociete(societe);
                await portee.ServiceProvider.GetRequiredService<ServiceEnvoiMail>().TraiterFileAsync(options.Value.MessagesParPassage, ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                journal.LogWarning(e, "Mail : file de la base {Societe} non traitée", societe.Libelle);
            }
        }
    }
}
