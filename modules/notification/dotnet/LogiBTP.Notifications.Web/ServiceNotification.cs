using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Notifications.Web;

/// <summary>Notification à publier pour un utilisateur (code du compte) ; la clé évite les doublons.</summary>
public sealed record NouvelleNotification(string Utilisateur, string Module, string Type, string Titre, string? Texte = null, string Niveau = "INFO",
    string? Url = null, string? TypeElement = null, string? IdElement = null, string? Cle = null);

/// <summary>Type de notification proposé dans les préférences.</summary>
public sealed record TypeNotification(string Module, string Type, string Libelle);

public sealed record NotificationDto(long Id, string Module, string Type, string Niveau, string Titre, string? Texte, string? Url,
    string? TypeElement, string? IdElement, DateTimeOffset CreeLe, DateTimeOffset? LueLe, DateTimeOffset? TraiteeLe);

public sealed record Compteur(int NonLues, int ATraiter, int Urgentes);
public sealed record Marquage(List<long>? Ids, bool Tout = false);
public sealed record PreferenceNotification(string Module, string Type, bool Ecran, bool Courriel);

/// <summary>
/// Source de notifications exécutée périodiquement par le planificateur, une fois par base de société (portée de
/// services de cette base) : l'application la déclare (rappels du CRM, habilitations, incohérences du planning…).
/// </summary>
public interface ISourceNotifications
{
    string Code { get; }
    TimeSpan Periode { get; }
    IReadOnlyList<TypeNotification> Types { get; }
    Task<IEnumerable<NouvelleNotification>> ProduireAsync(IServiceProvider portee, DateTimeOffset maintenant, CancellationToken ct);
}

/// <summary>
/// Boîte de notifications : publication (préférences appliquées, doublons ignorés par la clé), lecture, compteur du
/// bandeau, marquage lu / traité, préférences par module et type, purge des notifications traitées anciennes.
/// </summary>
public sealed class ServiceNotification(NotificationDbContext db, IEnumerable<ISourceNotifications> sources, IModulesActifs? modules = null)
{
    public static readonly HashSet<string> Niveaux = ["INFO", "ATTENTION", "URGENT"];

    /// <summary>Publie les notifications (préférence « écran » désactivée : ignorée) ; renvoie le nombre de nouvelles.</summary>
    public async Task<int> PublierAsync(IEnumerable<NouvelleNotification> notifications, CancellationToken ct)
    {
        var liste = notifications.Where(n => !string.IsNullOrWhiteSpace(n.Utilisateur)).ToList();
        if (liste.Count == 0) return 0;
        var utilisateurs = liste.Select(n => n.Utilisateur.ToLowerInvariant()).Distinct().ToArray();
        var refus = (await db.Preferences.AsNoTracking().Where(p => !p.NprEcran && utilisateurs.Contains(p.NprUtilisateur.ToLower())).ToListAsync(ct))
            .Select(p => (p.NprUtilisateur.ToLowerInvariant(), p.NprModule, p.NprType)).ToHashSet();
        var publiees = 0;
        foreach (var n in liste)
        {
            var u = n.Utilisateur.ToLowerInvariant();
            if (refus.Contains((u, n.Module, n.Type)) || refus.Contains((u, n.Module, "*"))) continue;
            publiees += await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO notification (ntf_utilisateur, ntf_module, ntf_type, ntf_niveau, ntf_titre, ntf_texte, ntf_url, ntf_type_element, ntf_id_element, ntf_cle)
                VALUES (@u, @m, @t, @n, left(@titre, 200), @texte, left(@url, 300), @te, @ie, left(@cle, 200))
                ON CONFLICT DO NOTHING
                """,
                [
                    new NpgsqlParameter("u", n.Utilisateur), new NpgsqlParameter("m", n.Module), new NpgsqlParameter("t", n.Type),
                    new NpgsqlParameter("n", Niveaux.Contains(n.Niveau) ? n.Niveau : "INFO"), new NpgsqlParameter("titre", n.Titre),
                    Texte("texte", n.Texte), Texte("url", n.Url), Texte("te", n.TypeElement), Texte("ie", n.IdElement), Texte("cle", n.Cle),
                ], ct);
        }
        return publiees;
    }

    private static NpgsqlParameter Texte(string nom, string? v) => new(nom, NpgsqlDbType.Text) { Value = (object?)v ?? DBNull.Value };

    private IQueryable<NotificationEntite> Boite(string utilisateur) => db.Notifications.Where(n => n.NtfUtilisateur.ToLower() == utilisateur.ToLower());

    /// <summary>Modules désactivés pour la société parmi ceux de la boîte : leurs notifications sont masquées (règle commune E24).</summary>
    private async Task<List<string>> ModulesMasquesAsync(string utilisateur, CancellationToken ct)
    {
        if (modules is null) return [];
        var res = new List<string>();
        foreach (var m in await Boite(utilisateur).Select(n => n.NtfModule).Distinct().ToListAsync(ct))
        {
            if (!await modules.EstActifAsync(m, ct)) res.Add(m);
        }
        return res;
    }

    /// <summary>Boîte de l'utilisateur : à traiter (défaut), non lues ou toutes ; filtre par module ; les plus récentes d'abord.</summary>
    public async Task<List<NotificationDto>> BoiteAsync(Utilisateur u, string? etat, string? module, int page, int taille, CancellationToken ct)
    {
        var masques = await ModulesMasquesAsync(u.Code, ct);
        var q = Boite(u.Code).AsNoTracking().Where(n => !masques.Contains(n.NtfModule));
        q = etat switch
        {
            "non_lues" => q.Where(n => n.NtfLueLe == null && n.NtfTraiteeLe == null),
            "toutes" => q,
            _ => q.Where(n => n.NtfTraiteeLe == null),
        };
        if (!string.IsNullOrEmpty(module)) q = q.Where(n => n.NtfModule == module);
        taille = Math.Clamp(taille, 1, 200);
        return await q.OrderByDescending(n => n.NtfCreeLe).Skip((Math.Max(page, 1) - 1) * taille).Take(taille)
            .Select(n => new NotificationDto(n.NtfId, n.NtfModule, n.NtfType, n.NtfNiveau, n.NtfTitre, n.NtfTexte, n.NtfUrl, n.NtfTypeElement, n.NtfIdElement,
                n.NtfCreeLe, n.NtfLueLe, n.NtfTraiteeLe)).ToListAsync(ct);
    }

    public async Task<Compteur> CompteurAsync(Utilisateur u, CancellationToken ct)
    {
        var masques = await ModulesMasquesAsync(u.Code, ct);
        var q = Boite(u.Code).AsNoTracking().Where(n => n.NtfTraiteeLe == null && !masques.Contains(n.NtfModule));
        var c = await q.GroupBy(_ => 1).Select(g => new Compteur(g.Count(n => n.NtfLueLe == null), g.Count(), g.Count(n => n.NtfNiveau == "URGENT"))).FirstOrDefaultAsync(ct);
        return c ?? new Compteur(0, 0, 0);
    }

    /// <summary>Marque lues (ou traitées, donc lues) les notifications désignées, ou toutes celles de la boîte.</summary>
    public async Task<Compteur> MarquerAsync(Utilisateur u, Marquage m, bool traitees, CancellationToken ct)
    {
        var maintenant = DateTimeOffset.UtcNow;
        var q = Boite(u.Code).Where(n => n.NtfTraiteeLe == null);
        if (!m.Tout) q = q.Where(n => (m.Ids ?? new List<long>()).Contains(n.NtfId));
        if (traitees) await q.ExecuteUpdateAsync(x => x.SetProperty(n => n.NtfTraiteeLe, maintenant).SetProperty(n => n.NtfLueLe, n => n.NtfLueLe ?? maintenant), ct);
        else await q.Where(n => n.NtfLueLe == null).ExecuteUpdateAsync(x => x.SetProperty(n => n.NtfLueLe, maintenant), ct);
        return await CompteurAsync(u, ct);
    }

    /// <summary>Types connus (sources déclarées) et préférences de l'utilisateur (défaut : écran oui, courriel non).</summary>
    public async Task<object> PreferencesAsync(Utilisateur u, CancellationToken ct)
    {
        var prefs = await db.Preferences.AsNoTracking().Where(p => p.NprUtilisateur.ToLower() == u.Code.ToLower()).ToListAsync(ct);
        var types = sources.SelectMany(s => s.Types).Concat(TypesDirects).DistinctBy(t => (t.Module, t.Type)).OrderBy(t => t.Module).ThenBy(t => t.Libelle).ToList();
        return types.Select(t =>
        {
            var p = prefs.FirstOrDefault(x => x.NprModule == t.Module && x.NprType == t.Type) ?? prefs.FirstOrDefault(x => x.NprModule == t.Module && x.NprType == "*");
            return new { module = t.Module, type = t.Type, libelle = t.Libelle, ecran = p?.NprEcran ?? true, courriel = p?.NprCourriel ?? false };
        }).ToList();
    }

    /// <summary>Types publiés directement par l'application (hors planificateur), déclarés pour les préférences.</summary>
    public static List<TypeNotification> TypesDirects { get; } = [];

    public async Task EnregistrerPreferencesAsync(Utilisateur u, List<PreferenceNotification> l, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Preferences.Where(p => p.NprUtilisateur.ToLower() == u.Code.ToLower()).ExecuteDeleteAsync(ct);
        db.Preferences.AddRange(l.Where(p => !p.Ecran || p.Courriel).Select(p => new PreferenceEntite
        {
            NprUtilisateur = u.Code, NprModule = p.Module, NprType = string.IsNullOrEmpty(p.Type) ? "*" : p.Type, NprEcran = p.Ecran, NprCourriel = p.Courriel,
        }));
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    /// <summary>Purge : notifications traitées depuis plus de <paramref name="jours"/> jours.</summary>
    public Task<int> PurgerAsync(int jours, CancellationToken ct)
    {
        var limite = DateTimeOffset.UtcNow.AddDays(-jours);
        return db.Notifications.Where(n => n.NtfTraiteeLe != null && n.NtfTraiteeLe < limite).ExecuteDeleteAsync(ct);
    }
}

public class NotificationEntite
{
    public long NtfId { get; set; }
    public string NtfUtilisateur { get; set; } = "";
    public string NtfModule { get; set; } = "";
    public string NtfType { get; set; } = "";
    public string NtfNiveau { get; set; } = "INFO";
    public string NtfTitre { get; set; } = "";
    public string? NtfTexte { get; set; }
    public string? NtfUrl { get; set; }
    public string? NtfTypeElement { get; set; }
    public string? NtfIdElement { get; set; }
    public string? NtfCle { get; set; }
    public DateTimeOffset NtfCreeLe { get; set; }
    public DateTimeOffset? NtfLueLe { get; set; }
    public DateTimeOffset? NtfTraiteeLe { get; set; }
}

public class PreferenceEntite
{
    public string NprUtilisateur { get; set; } = "";
    public string NprModule { get; set; } = "";
    public string NprType { get; set; } = "*";
    public bool NprEcran { get; set; } = true;
    public bool NprCourriel { get; set; }
}

public class ExecutionEntite
{
    public string NexSource { get; set; } = "";
    public DateTimeOffset? NexDerniere { get; set; }
    public int NexPubliees { get; set; }
    public string? NexErreur { get; set; }
}

public class NotificationDbContext(DbContextOptions<NotificationDbContext> options) : DbContext(options)
{
    public DbSet<NotificationEntite> Notifications => Set<NotificationEntite>();
    public DbSet<PreferenceEntite> Preferences => Set<PreferenceEntite>();
    public DbSet<ExecutionEntite> Executions => Set<ExecutionEntite>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<NotificationEntite>().ToTable("notification").HasKey(x => x.NtfId);
        b.Entity<PreferenceEntite>().ToTable("notification_preference").HasKey(x => new { x.NprUtilisateur, x.NprModule, x.NprType });
        b.Entity<ExecutionEntite>().ToTable("notification_execution").HasKey(x => x.NexSource);
    }
}
