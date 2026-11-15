using System.Reflection;
using System.Text.Json;
using LogiBTP.Socle.Web;
using LogiBTP.Socle;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using Npgsql;

namespace LogiBTP.Installation.Web;

/// <summary>Base d'une société ; Chiffree : connexion de l'API en TLS (lot 11, A35).</summary>
public sealed record EtatBase(string? Code, string Libelle, string? Base, bool Joignable, int Scripts, int EnAttente, string? Erreur, bool Chiffree = false,
    IReadOnlyList<EtatVersionModule>? Versions = null, string? VersionProduitBase = null, string? Statut = null, bool? AvecDemo = null,
    DateTimeOffset? DerniereMiseAJour = null, IReadOnlyList<EtatForcage>? Forcages = null);
/// <summary>Version d'un module dans la base ; Attendue : version attendue par l'application (null : module inconnu du plan) ; EnRetard : Attendue non atteinte.</summary>
public sealed record EtatVersionModule(string Module, string Version, DateTimeOffset AppliqueLe, string? Attendue = null, bool EnRetard = false);
public sealed record EtatForcage(DateTimeOffset Le, string Utilisateur, string Motif, IReadOnlyList<string> Objets);
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
        api.MapGet("/installation/etat", async (IConfiguration c, IOptions<OptionsSocietes> s, DossierCertificats d, CertificatServeur cs, ControleVersionBase controle, CancellationToken ct) =>
            Results.Ok(await LireAsync(c, s.Value, d, cs, ct, controle.Attendues)));
        return api;
    }

    private static readonly JsonSerializerOptions Json = JsonSerializerOptions.Web;

    public static async Task<Etat> LireAsync(IConfiguration c, OptionsSocietes societes, DossierCertificats d, CertificatServeur cs, CancellationToken ct, VersionsAttendues? versionsAttendues = null)
    {
        var infos = d.Infos();
        var certificat = infos is null ? null : new EtatCertificat(infos.Origine, infos.Noms, infos.Emetteur, infos.Fin,
            (int)Math.Floor((infos.Fin - DateTimeOffset.Now).TotalDays), infos.EmpreinteRacine);
        var racineSql = Environment.GetEnvironmentVariable(VariablesEnv.Sql);
        var manifeste = racineSql is not null && File.Exists(Path.Combine(racineSql, ManifesteScripts.CheminRelatif)) ? ManifesteScripts.Lire(racineSql) : null;
        var attendus = manifeste?.Scripts.Where(x => !x.Rejouable).Select(x => x.Chemin).ToHashSet();
        var demos = manifeste?.Scripts.Where(x => x.Demo).Select(x => x.Chemin).ToHashSet();
        var bases = new List<EtatBase>();
        foreach (var soc in societes.Societes()) bases.Add(await BaseAsync(soc, attendus, demos, versionsAttendues, ct));
        var dossierSauvegardes = Environment.GetEnvironmentVariable(VariablesEnv.Sauvegardes) ?? "/app/sauvegardes";
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
        return new Etat(version.Split('+')[0], c[VariablesEnv.Deploiement] ?? "LOCAL", c[VariablesEnv.Domaine], cs.Actif, certificat, bases, sauvegarde, disques);
    }

    private static async Task<EtatBase> BaseAsync(SocieteCourante s, HashSet<string>? attendus, HashSet<string>? demos, VersionsAttendues? versionsAttendues, CancellationToken ct)
    {
        try
        {
            var appliques = await BaseDonnees.ScriptsAppliquesAsync(s.Connexion, ct);
            var enAttente = attendus is null || appliques.Count == 0 ? 0 : attendus.Except(appliques.Select(a => a.Chemin)).Count();
            await using var cnx = new NpgsqlConnection(s.Connexion);
            await cnx.OpenAsync(ct);
            await using var cmd = new NpgsqlCommand("SELECT coalesce((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false)", cnx);
            var chiffree = await cmd.ExecuteScalarAsync(ct) is true;
            var reelles = await VersionsModules.VersionsModulesAsync(cnx, ct);
            var versions = reelles.Select(v =>
            {
                VersionModule? attendue = versionsAttendues is not null && versionsAttendues.ParModule.TryGetValue(v.Module, out var a) ? a : null;
                return new EtatVersionModule(v.Module, v.Version.ToString(), v.AppliqueLe, attendue?.ToString(), attendue is { } x && v.Version < x);
            }).ToList();
            // Modules attendus mais absents de la base : listés avec une version vide, en retard.
            if (versionsAttendues is not null)
                versions.AddRange(versionsAttendues.ParModule.Where(p => reelles.All(r => r.Module != p.Key) && appliques.Count > 0)
                    .Select(p => new EtatVersionModule(p.Key, "", default, p.Value.ToString(), true)));
            var statut = versionsAttendues is null ? null : (await versionsAttendues.LireAsync(cnx, ct)).Statut.ToString();
            bool? avecDemo = demos is not null && appliques.Count > 0 ? appliques.Any(a => demos.Contains(a.Chemin)) : null;
            var forcages = (await JournalSchema.ForcagesAsync(cnx, ct)).Select(f => new EtatForcage(f.Le, f.Utilisateur, f.Motif, f.Objets)).ToList();
            return new EtatBase(s.Code, s.Libelle, s.Base, true, appliques.Count, enAttente, null, chiffree, versions.OrderBy(v => v.Module, StringComparer.Ordinal).ToList(),
                await VersionsModules.VersionProduitBaseAsync(cnx, ct), statut, avecDemo, appliques.Count == 0 ? null : appliques.Max(a => a.AppliqueLe), forcages);
        }
        catch (Exception e) when (e is NpgsqlException or InvalidOperationException)
        {
            return new EtatBase(s.Code, s.Libelle, s.Base, false, 0, 0, LogiBTP.Socle.Masquage.Texte(e.Message));
        }
    }
}
