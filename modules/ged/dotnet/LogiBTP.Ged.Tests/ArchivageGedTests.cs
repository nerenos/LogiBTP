using LogiBTP.Ged.Web;
using LogiBTP.Socle.Web;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace LogiBTP.Ged.Tests;

/// <summary>Archivage automatique planifié : une portée par base de société, utilisateur système administrateur.</summary>
public class ArchivageGedTests
{
    /// <summary>Service factice : note la société de sa portée et l'utilisateur ; la société « panne » échoue.</summary>
    private sealed class ServiceFactice(SocieteCourante societe, List<(string? Societe, string Connexion, Utilisateur U)> appels)
        : ServiceGed(null!, null!, null!)
    {
        public override Task<ResultatRetentionDto> AppliquerRetention(Utilisateur u, CancellationToken ct)
        {
            if (societe.Code == "panne") throw new InvalidOperationException("Base inaccessible");
            appels.Add((societe.Code, societe.Connexion, u));
            return Task.FromResult(new ResultatRetentionDto(2, 3, [10, 11]));
        }
    }

    private static (ServiceProvider Services, List<(string? Societe, string Connexion, Utilisateur U)> Appels) Construire(Dictionary<string, string?> config)
    {
        var appels = new List<(string? Societe, string Connexion, Utilisateur U)>();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:LogiBTP"] = "Host=x;Database=logibtp",
            ["Societes:Liste:demo:Libelle"] = "Démo",
            ["Societes:Liste:demo:Connexion"] = "Host=x;Database=logibtp_demo",
            ["Societes:Liste:panne:Connexion"] = "Host=x;Database=logibtp_panne",
            ["Societes:Liste:vide:Libelle"] = "Sans connexion",
        }.Concat(config).ToDictionary()).Build();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSocietes(configuration);
        services.AddScoped<ServiceGed>(sp => new ServiceFactice(sp.GetRequiredService<SocieteCourante>(), appels));
        services.AddArchivageGed(configuration.GetSection("Ged:Archivage"));
        return (services.BuildServiceProvider(), appels);
    }

    [Fact]
    public async Task Retention_appliquee_a_chaque_base_par_un_administrateur_systeme()
    {
        var (sp, appels) = Construire(new() { ["Ged:Archivage:Utilisateur"] = "robot" });
        var tache = sp.GetServices<IHostedService>().OfType<ArchivageGed>().Single();
        var resultats = await tache.ArchiverAsync(CancellationToken.None);

        // Principale, demo, panne (en erreur, sans arrêter les autres) ; la société sans connexion est ignorée.
        Assert.Equal(["principale", "demo", "panne"], resultats.Select(r => r.Societe));
        Assert.Equal([(null, "Host=x;Database=logibtp"), ("demo", "Host=x;Database=logibtp_demo")], appels.Select(a => (a.Societe, a.Connexion)));
        Assert.All(appels, a => { Assert.Equal("robot", a.U.Code); Assert.True(a.U.EstAdmin); });
        Assert.Equal(3, resultats[0].Resultat!.Archives);
        Assert.Null(resultats[2].Resultat);
        Assert.Equal("Base inaccessible", resultats[2].Erreur);
    }

    [Fact]
    public async Task Desactivee_par_la_configuration()
    {
        var (sp, appels) = Construire(new() { ["Ged:Archivage:Actif"] = "false" });
        var tache = sp.GetServices<IHostedService>().OfType<ArchivageGed>().Single();
        await tache.StartAsync(CancellationToken.None);
        // Sans attente du prochain passage : la tâche se termine aussitôt.
        await tache.ExecuteTask!.WaitAsync(TimeSpan.FromSeconds(5));
        await tache.StopAsync(CancellationToken.None);
        Assert.Empty(appels);
    }

    [Theory]
    [InlineData("2026-10-16 01:00", "02:30", 90)]
    [InlineData("2026-10-16 02:30", "02:30", 24 * 60)]
    [InlineData("2026-10-16 23:00", "02:30", 210)]
    public void Prochain_passage_a_l_heure_configuree(string maintenant, string heure, int minutes) =>
        Assert.Equal(TimeSpan.FromMinutes(minutes), ArchivageGed.DelaiAvant(DateTime.Parse(maintenant, System.Globalization.CultureInfo.InvariantCulture),
            new OptionsArchivageGed { Heure = heure }.HeureExecution));
}
