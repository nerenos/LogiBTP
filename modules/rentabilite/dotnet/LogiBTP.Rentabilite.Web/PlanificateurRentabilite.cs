using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace LogiBTP.Rentabilite.Web;

/// <summary>Réglages du planificateur (section « Rentabilite ») : actif, réveil (secondes), chantiers par passage, heure du recalcul de nuit.</summary>
public sealed class OptionsRentabilite
{
    public bool Actif { get; set; } = true;
    public int IntervalleSecondes { get; set; } = 5;
    public int ChantiersParPassage { get; set; } = 20;
    public int HeureNuit { get; set; } = 2;
}

/// <summary>
/// Planificateur de fond (sur le modèle de PlanificateurNotifications) : à chaque réveil, pour chaque base où le module
/// est actif, vide une partie de la file des chantiers à recalculer ; une fois par jour, à partir de l'heure de nuit,
/// recalcule les chantiers ouverts avec comparaison à l'existant (écarts journalisés : V63). Une base en erreur
/// n'empêche pas les suivantes.
/// </summary>
public class PlanificateurRentabilite(IServiceProvider services, IOptions<OptionsRentabilite> options, IOptions<OptionsSocietes> societes,
    ILogger<PlanificateurRentabilite> journal, TimeProvider horloge) : BackgroundService
{
    public const string TacheNuit = "nuit";
    public const string TacheVersion = "version";
    public const string TachePhotos = "photos";

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var o = options.Value;
        if (!o.Actif)
        {
            journal.LogInformation("Planificateur de la rentabilité désactivé (Rentabilite:Actif)");
            return;
        }
        try { await Task.Delay(TimeSpan.FromSeconds(15), horloge, ct); } catch (OperationCanceledException) { return; }
        while (!ct.IsCancellationRequested)
        {
            await ExecuterAsync(ct);
            try { await Task.Delay(TimeSpan.FromSeconds(Math.Max(1, o.IntervalleSecondes)), horloge, ct); } catch (OperationCanceledException) { return; }
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
                await ExecuterBaseAsync(portee.ServiceProvider, ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                journal.LogWarning(e, "Rentabilité : base {Societe} non traitée", societe.Libelle);
            }
        }
    }

    public async Task ExecuterBaseAsync(IServiceProvider portee, CancellationToken ct)
    {
        var db = portee.GetRequiredService<RentabiliteDbContext>();
        if (!await portee.GetRequiredService<SpecialisationRentabilite>().ActifAsync(db, ct)) return;
        var service = portee.GetRequiredService<ServiceRentabilite>();
        // Nouvelle version des règles (V64) : tous les chantiers ouverts remis dans la file, une fois.
        var version = portee.GetRequiredService<SpecialisationRentabilite>().VersionRegles.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var connue = (await db.Database.SqlQuery<string?>($"SELECT rex_resultat AS \"Value\" FROM rentabilite_execution WHERE rex_tache = {TacheVersion}")
            .ToListAsync(ct)).FirstOrDefault();
        if (connue != version)
        {
            var spec = portee.GetRequiredService<SpecialisationRentabilite>();
            await service.SignalerAsync(await spec.ChantiersOuvertsAsync(db, ct), $"Règles de calcul en version {version}", false, ct);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO rentabilite_execution (rex_tache, rex_derniere, rex_resultat) VALUES ({TacheVersion}, now(), {version})
                ON CONFLICT (rex_tache) DO UPDATE SET rex_derniere = now(), rex_resultat = EXCLUDED.rex_resultat
                """, ct);
        }
        await service.TraiterFileAsync(Math.Max(1, options.Value.ChantiersParPassage), ct);
        var maintenant = horloge.GetLocalNow();
        if (maintenant.Hour < options.Value.HeureNuit) return;
        var derniere = (await db.Database.SqlQuery<DateTimeOffset?>($"SELECT rex_derniere AS \"Value\" FROM rentabilite_execution WHERE rex_tache = {TacheNuit}")
            .ToListAsync(ct)).FirstOrDefault();
        if (derniere is { } d && d.ToLocalTime().Date >= maintenant.Date) return;
        // Marquée avant le passage : une nuit interrompue n'est pas relancée en boucle (le passage suivant la reprendra).
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO rentabilite_execution (rex_tache, rex_derniere) VALUES ({TacheNuit}, now())
            ON CONFLICT (rex_tache) DO UPDATE SET rex_derniere = now()
            """, ct);
        var (chantiers, enEcart, erreurs) = await service.NuitAsync(ct);
        var resultat = $"{chantiers} chantiers recalculés, {enEcart} en écart, {erreurs} en erreur";
        if (enEcart > 0 || erreurs > 0) journal.LogWarning("Rentabilité, recalcul de nuit : {Resultat}", resultat);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE rentabilite_execution SET rex_resultat = {resultat} WHERE rex_tache = {TacheNuit}", ct);
        // Photos de fin de mois (§ 10.3) : la première nuit d'un mois, après le recalcul, photo de chaque chantier ouvert au
        // dernier jour du mois précédent.
        var jour = DateOnly.FromDateTime(maintenant.DateTime);
        var finMois = new DateOnly(jour.Year, jour.Month, 1).AddDays(-1);
        var dernierePhoto = (await db.Database.SqlQuery<string?>($"SELECT rex_resultat AS \"Value\" FROM rentabilite_execution WHERE rex_tache = {TachePhotos}")
            .ToListAsync(ct)).FirstOrDefault();
        var cle = finMois.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        if (dernierePhoto != cle)
        {
            var n = await service.PhotosMoisAsync(finMois, ct);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO rentabilite_execution (rex_tache, rex_derniere, rex_resultat) VALUES ({TachePhotos}, now(), {cle})
                ON CONFLICT (rex_tache) DO UPDATE SET rex_derniere = now(), rex_resultat = EXCLUDED.rex_resultat
                """, ct);
            journal.LogInformation("Rentabilité : {Nombre} photos de fin de mois au {Date}", n, cle);
        }
    }
}
