using System.Globalization;
using LogiBTP.Socle.Web;
using LogiBTP.Socle;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace LogiBTP.Ged.Web;

/// <summary>
/// Archivage automatique (section « Ged:Archivage » de la configuration) : Actif (désactivable), Heure (heure locale
/// du serveur, « HH:mm »), Utilisateur (code inscrit au journal de l'archive, profil ADMIN).
/// </summary>
public sealed class OptionsArchivageGed
{
    public bool Actif { get; set; } = true;
    public string Heure { get; set; } = "02:30";
    public string Utilisateur { get; set; } = "systeme";

    public TimeOnly HeureExecution => TimeOnly.ParseExact(Heure, "HH:mm", CultureInfo.InvariantCulture);
}

/// <summary>Résultat de l'archivage d'une base : Erreur renseignée si la base n'a pas pu être traitée.</summary>
public sealed record ArchivageBaseGed(string Societe, ResultatRetentionDto? Resultat, string? Erreur);

/// <summary>
/// Tâche de fond : chaque nuit, pour la base principale et chaque société configurée (une portée de services par
/// base, CreerPorteeSociete), applique la rétention (ServiceGed.AppliquerRetention) avec un utilisateur système
/// administrateur. Mêmes règles que le bouton ⏳ de la GED globale ; une base en erreur n'empêche pas les suivantes.
/// </summary>
public class ArchivageGed(IServiceProvider services, IOptions<OptionsArchivageGed> options, IOptions<OptionsSocietes> societes,
    ILogger<ArchivageGed> journal, TimeProvider horloge) : BackgroundService
{
    /// <summary>Délai jusqu'au prochain passage à l'heure donnée (le jour même si elle n'est pas passée, sinon le lendemain).</summary>
    public static TimeSpan DelaiAvant(DateTime maintenantLocal, TimeOnly heure)
    {
        var prochaine = maintenantLocal.Date + heure.ToTimeSpan();
        if (prochaine <= maintenantLocal) prochaine = prochaine.AddDays(1);
        return prochaine - maintenantLocal;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var o = options.Value;
        if (!o.Actif)
        {
            journal.LogInformation("Archivage automatique de la GED désactivé (Ged:Archivage:Actif)");
            return;
        }
        var heure = o.HeureExecution;
        while (!ct.IsCancellationRequested)
        {
            var delai = DelaiAvant(horloge.GetLocalNow().DateTime, heure);
            try { await Task.Delay(delai, horloge, ct); }
            catch (OperationCanceledException) { return; }
            await ArchiverAsync(ct);
        }
    }

    /// <summary>Un passage d'archivage sur toutes les bases (appelé chaque nuit ; public pour les tests).</summary>
    public virtual async Task<List<ArchivageBaseGed>> ArchiverAsync(CancellationToken ct)
    {
        var u = new Utilisateur(options.Value.Utilisateur, Profils.Admin);
        var resultats = new List<ArchivageBaseGed>();
        foreach (var societe in societes.Value.Societes())
        {
            var nom = societe.Code ?? "principale";
            try
            {
                await using var portee = services.CreerPorteeSociete(societe);
                var r = await portee.ServiceProvider.GetRequiredService<ServiceGed>().AppliquerRetentionSysteme(u, ct);
                resultats.Add(new ArchivageBaseGed(nom, r, null));
                if (r.Documents > 0) journal.LogInformation("GED ({Base}) : rétention appliquée, {Documents} document(s) échu(s), {Archives} archivé(s)", nom, r.Documents, r.Archives);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                resultats.Add(new ArchivageBaseGed(nom, null, e.Message));
                journal.LogError(e, "GED ({Base}) : archivage automatique impossible", nom);
            }
        }
        return resultats;
    }
}

public static class ExtensionsArchivageGed
{
    /// <summary>Archivage automatique planifié (section de configuration « Ged:Archivage »), après AddSocietes et AddModuleGed.</summary>
    public static IServiceCollection AddArchivageGed(this IServiceCollection services, IConfiguration section)
    {
        services.Configure<OptionsArchivageGed>(section);
        services.TryAddSingleton(TimeProvider.System);
        services.AddHostedService<ArchivageGed>();
        return services;
    }
}
