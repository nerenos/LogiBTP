using LogiBTP.Socle.Web;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace LogiBTP.Editions.Web;

/// <summary>Production des éditions (section « Edition:Production ») : Actif, Intervalle (secondes), Lot (tâches par passage et par base).</summary>
public sealed class OptionsProductionEdition
{
    public bool Actif { get; set; } = true;
    public int Intervalle { get; set; } = 5;
    public int Lot { get; set; } = 10;
}

/// <summary>
/// Tâche de fond (Q15) : à intervalle régulier, pour la base principale et chaque société (une portée de services
/// par base, CreerPorteeSociete), traite la file edition_tache : PDF produit par le moteur JS dans Jint puis déposé
/// par l'application (GED, coffre-fort). Une base en erreur n'empêche pas les suivantes.
/// </summary>
public sealed class ProductionEdition(IServiceProvider services, IOptions<OptionsProductionEdition> options, IOptions<OptionsSocietes> societes,
    ILogger<ProductionEdition> journal) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var o = options.Value;
        if (!o.Actif) { journal.LogInformation("Production des éditions désactivée (Edition:Production:Actif)"); return; }
        while (!ct.IsCancellationRequested)
        {
            await PasserAsync(ct);
            try { await Task.Delay(TimeSpan.FromSeconds(Math.Max(1, o.Intervalle)), ct); }
            catch (OperationCanceledException) { return; }
        }
    }

    /// <summary>Un passage sur toutes les bases (public pour les tests).</summary>
    public async Task<int> PasserAsync(CancellationToken ct)
    {
        var total = 0;
        foreach (var societe in societes.Value.Societes())
        {
            try
            {
                await using var portee = services.CreerPorteeSociete(societe);
                var n = await portee.ServiceProvider.GetRequiredService<ServiceEdition>().TraiterEnAttente(portee.ServiceProvider, options.Value.Lot, ct);
                if (n > 0) journal.LogInformation("Éditions ({Base}) : {Nombre} production(s) traitée(s)", societe.Code ?? "principale", n);
                total += n;
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                journal.LogError(e, "Éditions ({Base}) : file de production inaccessible", societe.Code ?? "principale");
            }
        }
        return total;
    }
}
