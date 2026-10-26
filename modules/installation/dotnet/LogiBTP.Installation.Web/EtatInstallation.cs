using System.Reflection;
using System.Text.Json;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using Npgsql;

namespace LogiBTP.Installation.Web;

/// <summary>Base d'une société ; Chiffree : connexion de l'API en TLS (lot 11, A35).</summary>
public sealed record EtatBase(string? Code, string Libelle, string? Base, bool Joignable, int Scripts, int EnAttente, string? Erreur, bool Chiffree = false);
public sealed record EtatDisque(string Usage, long LibreMo, long TotalMo);
public sealed record DerniereSauvegarde(DateTimeOffset Le, IReadOnlyList<string> Bases, long TailleMo, bool Chiffree, string? Erreur);
public sealed record EtatCertificat(string Origine, IReadOnlyList<string> Noms, string Emetteur, DateTimeOffset Fin, int JoursRestants, string? EmpreinteRacine);
public sealed record Etat(string Version, string Deploiement, string? Domaine, bool Https, EtatCertificat? Certificat,
    IReadOnlyList<EtatBase> Bases, DerniereSauvegarde? Sauvegarde, IReadOnlyList<EtatDisque> Disques);

/// <summary>
/// État de l'installation (ANALYSE-MODULE-INSTALLATION.md § 7.3) : version, certificat et échéance, bases des sociétés
/// (joignables, scripts appliqués, scripts du manifeste en attente), dernière sauvegarde (derniere-sauvegarde.json du
/// volume des sauvegardes), espace disque. Aucun chemin ni secret n'est renvoyé. Route GET /api/installation/etat,
/// rattachée par le cœur au nœud de droits de l'administration.
/// </summary>
public static class EtatInstallation
{
    public static RouteGroupBuilder MapModuleInstallation(this RouteGroupBuilder api)
    {
        api.MapGet("/installation/etat", async (IConfiguration c, IOptions<OptionsSocietes> s, DossierCertificats d, CertificatServeur cs, CancellationToken ct) =>
            Results.Ok(await LireAsync(c, s.Value, d, cs, ct)));
        return api;
    }

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static async Task<Etat> LireAsync(IConfiguration c, OptionsSocietes societes, DossierCertificats d, CertificatServeur cs, CancellationToken ct)
    {
        var infos = d.Infos();
        var certificat = infos is null ? null : new EtatCertificat(infos.Origine, infos.Noms, infos.Emetteur, infos.Fin,
            (int)Math.Floor((infos.Fin - DateTimeOffset.Now).TotalDays), infos.EmpreinteRacine);
        var racineSql = Environment.GetEnvironmentVariable("LOGIBTP_SQL");
        var attendus = racineSql is not null && File.Exists(Path.Combine(racineSql, ManifesteScripts.CheminRelatif))
            ? ManifesteScripts.Lire(racineSql).Scripts.Where(x => !x.Rejouable).Select(x => x.Chemin).ToHashSet() : null;
        var bases = new List<EtatBase>();
        foreach (var soc in societes.Societes()) bases.Add(await BaseAsync(soc, attendus, ct));
        var dossierSauvegardes = Environment.GetEnvironmentVariable("LOGIBTP_SAUVEGARDES") ?? "/app/sauvegardes";
        var fichier = Path.Combine(dossierSauvegardes, "derniere-sauvegarde.json");
        DerniereSauvegarde? sauvegarde = null;
        try { if (File.Exists(fichier)) sauvegarde = JsonSerializer.Deserialize<DerniereSauvegarde>(await File.ReadAllTextAsync(fichier, ct), Json); }
        catch (JsonException) { }
        var disques = new List<EtatDisque>();
        foreach (var (usage, chemin) in new[] { ("Documents (GED)", c["Ged:Repertoire"] ?? "stockage-ged"), ("Sauvegardes", dossierSauvegardes) })
        {
            if (!Directory.Exists(chemin)) continue;
            var lecteur = new DriveInfo(Path.GetFullPath(chemin));
            disques.Add(new EtatDisque(usage, lecteur.AvailableFreeSpace / 1048576, lecteur.TotalSize / 1048576));
        }
        var version = Assembly.GetEntryAssembly()?.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "?";
        return new Etat(version.Split('+')[0], c["LOGIBTP_DEPLOIEMENT"] ?? "LOCAL", c["LOGIBTP_DOMAINE"], cs.Actif, certificat, bases, sauvegarde, disques);
    }

    private static async Task<EtatBase> BaseAsync(SocieteCourante s, HashSet<string>? attendus, CancellationToken ct)
    {
        try
        {
            var appliques = await BaseDonnees.ScriptsAppliquesAsync(s.Connexion, ct);
            var enAttente = attendus is null || appliques.Count == 0 ? 0 : attendus.Except(appliques.Select(a => a.Chemin)).Count();
            await using var cnx = new NpgsqlConnection(s.Connexion);
            await cnx.OpenAsync(ct);
            await using var cmd = new NpgsqlCommand("SELECT coalesce((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false)", cnx);
            var chiffree = await cmd.ExecuteScalarAsync(ct) is true;
            return new EtatBase(s.Code, s.Libelle, s.Base, true, appliques.Count, enAttente, null, chiffree);
        }
        catch (Exception e) when (e is NpgsqlException or InvalidOperationException)
        {
            return new EtatBase(s.Code, s.Libelle, s.Base, false, 0, 0, LogiBTP.Socle.Masquage.Texte(e.Message));
        }
    }
}
