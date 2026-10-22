using System.Globalization;
using System.Text.Json;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Planning.Web;

public class TacheEntite
{
    public long TacId { get; set; }
    public short TacCalcul { get; set; } = 1;
    public DateTime TacDebut { get; set; }
    public DateTime TacFin { get; set; }
    public int TacHeures { get; set; }
    public short TacNbRessources { get; set; } = 1;
    public int? TacSrvId { get; set; }
    public string TacTypeElement { get; set; } = "chantier";
    public string? TacIdElement { get; set; }
    public string? TacOrigineType { get; set; }
    public string? TacOrigineId { get; set; }
    public long? TacParentId { get; set; }
    public string TacLibelle { get; set; } = "";
    public string? TacMemo { get; set; }
    public short TacAvancement { get; set; }
    public string? TacCouleur { get; set; }
    public string TacEtat { get; set; } = "PREVUE";
    public string TacMobile { get; set; } = "{}";
    public string[] TacHabilitations { get; set; } = [];
    public Guid? TacSerie { get; set; }
    public int TacVersion { get; set; } = 1;
    public string TacCreePar { get; set; } = "";
    public DateTimeOffset TacCreeLe { get; set; } = DateTimeOffset.UtcNow;
    public string? TacMajPar { get; set; }
    public DateTimeOffset? TacMajLe { get; set; }
}

public class AffectationEntite
{
    public long AffId { get; set; }
    public long AffTacId { get; set; }
    public string AffResType { get; set; } = "";
    public string AffResId { get; set; } = "";
    public int? AffEquipeId { get; set; }
    public int AffHeures { get; set; }
    public decimal? AffQuantite { get; set; }
}

public class VueEntite
{
    public int PvuId { get; set; }
    public string PvuCode { get; set; } = "";
    public string PvuLibelle { get; set; } = "";
    public string? PvuUtilisateur { get; set; }
    public string PvuDefinition { get; set; } = "{}";
    public int PvuOrdre { get; set; }
}

public class PlanningDbContext(DbContextOptions<PlanningDbContext> options) : DbContext(options)
{
    public DbSet<TacheEntite> Taches => Set<TacheEntite>();
    public DbSet<AffectationEntite> Affectations => Set<AffectationEntite>();
    public DbSet<VueEntite> Vues => Set<VueEntite>();
    public DbSet<ParametrePlanningEntite> Parametres => Set<ParametrePlanningEntite>();
    public DbSet<NotificationEntite> Notifications => Set<NotificationEntite>();
    public DbSet<DependanceEntite> Dependances => Set<DependanceEntite>();
    public DbSet<JalonEntite> Jalons => Set<JalonEntite>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<TacheEntite>().ToTable("pla_tache").HasKey(x => x.TacId);
        b.Entity<TacheEntite>().Property(x => x.TacDebut).HasColumnType("timestamp(0)");
        b.Entity<TacheEntite>().Property(x => x.TacFin).HasColumnType("timestamp(0)");
        b.Entity<TacheEntite>().Property(x => x.TacMobile).HasColumnType("jsonb");
        b.Entity<AffectationEntite>().ToTable("pla_affectation").HasKey(x => x.AffId);
        b.Entity<VueEntite>().ToTable("pla_vue").HasKey(x => x.PvuId);
        b.Entity<VueEntite>().Property(x => x.PvuDefinition).HasColumnType("jsonb");
        b.Entity<ParametrePlanningEntite>().ToTable("pla_parametre").HasKey(x => x.PplId);
        b.Entity<NotificationEntite>().ToTable("pla_notification").HasKey(x => x.PnoCle);
        b.Entity<DependanceEntite>().ToTable("pla_dependance").HasKey(x => x.DepId);
        b.Entity<JalonEntite>().ToTable("pla_jalon").HasKey(x => x.JalId);
        b.Entity<JalonEntite>().Property(x => x.JalQuand).HasColumnType("timestamp(0)");
    }
}

/// <summary>Ressource planifiable (fournie par l'application) ; clé « TYPE:id ».</summary>
public sealed record RessourcePlanning(string Type, string Id, string Libelle, int? SrvId, string? Service, bool Capacite, decimal? Quantite)
{
    public string Cle => $"{Type}:{Id}";
}
public sealed record ServicePlanningDto(int Id, string Code, string Libelle, int? ParentId);
public sealed record ElementPlanning(string Type, string Id, string Code, string Libelle, string? Url);
public sealed record BudgetPlanning(string Type, string Id, int SrvId, int Minutes);
public sealed record EquipePlanning(int Id, string Code, string Libelle, int? SrvId);
public sealed record FiltreRessources(IReadOnlyCollection<int>? Services, IReadOnlyCollection<string>? Types, string? Recherche, IReadOnlyCollection<string>? Cles = null);

public sealed record DefinitionVue(string Regroupement = "RESSOURCE", string Echelle = "JOUR", int Avant = 7, int Apres = 21, List<string>? Services = null,
    List<string>? Types = null, bool HauteurAdaptee = true);
public sealed record AffectationSaisie(string Type, string Id, int? EquipeId = null, decimal? Quantite = null);
public sealed record TacheSaisie(int Calcul, string Debut, string? Fin, int? Heures, int NbRessources, int? SrvId, string TypeElement, string? IdElement,
    string Libelle, List<AffectationSaisie>? Affectations, string? OrigineType = null, string? OrigineId = null, string? Memo = null, int Avancement = 0,
    string? Couleur = null, string Etat = "PREVUE", int? Version = null, List<string>? Habilitations = null, long? ParentId = null, Guid? Serie = null,
    Dictionary<string, string?>? Mobile = null);
public sealed record DeplacementSaisi(string Debut, string Fin, string Mode, string? De, string? Vers, bool Copie, int Version);
public sealed record ScissionSaisie(string Instant, int Version);

/// <summary>
/// Spécialisation par l'application (méthode patron) : ressources (type, service, capacité), plages travaillées des
/// ressources et des services (calendriers), équipes et leurs membres à une date, éléments (chantiers), budgets
/// d'heures par élément et service, services.
/// </summary>
public abstract class SpecialisationPlanning
{
    public abstract Task<List<RessourcePlanning>> RessourcesAsync(PlanningDbContext db, FiltreRessources f, CancellationToken ct);
    public abstract Task<Dictionary<string, List<(long Debut, long Fin)>>> PlagesAsync(PlanningDbContext db, IReadOnlyCollection<RessourcePlanning> ressources, DateOnly du, DateOnly au, CancellationToken ct);
    public abstract Task<List<(long Debut, long Fin)>> PlagesServiceAsync(PlanningDbContext db, int? service, DateOnly du, DateOnly au, CancellationToken ct);
    public abstract Task<List<EquipePlanning>> EquipesAsync(PlanningDbContext db, CancellationToken ct);
    public abstract Task<List<(string Type, string Id)>> MembresAsync(PlanningDbContext db, int equipe, DateOnly date, CancellationToken ct);
    public abstract Task<List<ElementPlanning>> ElementsAsync(PlanningDbContext db, string type, IReadOnlyCollection<string>? ids, string? recherche, CancellationToken ct);
    public abstract Task<List<BudgetPlanning>> BudgetsAsync(PlanningDbContext db, IReadOnlyCollection<int>? services, string? recherche, CancellationToken ct);
    public abstract Task<List<ServicePlanningDto>> ServicesAsync(PlanningDbContext db, CancellationToken ct);
    /// <summary>Codes des habilitations valables à une date, par ressource (lot 4, P19).</summary>
    public abstract Task<Dictionary<string, HashSet<string>>> HabilitationsAsync(PlanningDbContext db, IReadOnlyCollection<string> ressources, DateOnly date, CancellationToken ct);
    /// <summary>Jalons calculés d'une période (fins de chantier, d'ordre…), lot 5.</summary>
    public abstract Task<List<JalonPlanning>> JalonsAsync(PlanningDbContext db, DateOnly du, DateOnly au, CancellationToken ct);
    /// <summary>Types d'habilitations exigibles par une tâche (code, libellé).</summary>
    public abstract Task<List<(string Code, string Libelle)>> TypesHabilitationAsync(PlanningDbContext db, CancellationToken ct);
}

/// <summary>
/// Tâches du planning : vues, données d'une période selon le regroupement de la vue, création, modification (verrou
/// optimiste par version), déplacement et redimensionnement (recalcul selon le mode), scission, suppression, calcul
/// côté serveur (<see cref="ReglesPlanning"/>), tâches à planifier (budget − planifié par élément et service).
/// </summary>
public sealed class ServicePlanning(PlanningDbContext db, SpecialisationPlanning specialisation, Diffuseur diffuseur, SocieteCourante societe)
{
    /// <summary>Événement « planning » diffusé aux navigateurs de la société (lot 3, temps réel).</summary>
    private void Publier(string action, IEnumerable<long> taches, Utilisateur u) =>
        diffuseur.Publier(societe, "planning", new { action, taches = taches.ToList(), par = u.Code });

    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };
    private const int HorizonJours = 120;

    private static DateTime Lire(string s) => Temps.DateHeureDe(Temps.VersMinutes(s));
    private static string Ecrire(DateTime d) => d.ToString("yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture);

    public async Task<List<object>> VuesAsync(Utilisateur u, CancellationToken ct) =>
        (await db.Vues.AsNoTracking().Where(v => v.PvuUtilisateur == null || v.PvuUtilisateur == u.Code).OrderBy(v => v.PvuOrdre).ThenBy(v => v.PvuLibelle).ToListAsync(ct))
        .Select(v => (object)new { code = v.PvuCode, libelle = v.PvuLibelle, personnelle = v.PvuUtilisateur != null, definition = JsonSerializer.Deserialize<JsonElement>(v.PvuDefinition) }).ToList();

    /// <summary>Enregistre une vue personnelle (code libre préfixé par l'utilisateur) ou globale (administrateur).</summary>
    public async Task<object> EnregistrerVueAsync(string code, string libelle, DefinitionVue d, bool globale, Utilisateur u, CancellationToken ct)
    {
        if (globale && !u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
        var e = await db.Vues.FirstOrDefaultAsync(v => v.PvuCode == code, ct);
        if (e is not null && e.PvuUtilisateur != (globale ? null : u.Code)) throw ExceptionMetier.Conflit("PLA_VUE", "Vue d'un autre utilisateur ou vue globale");
        if (e is null) db.Vues.Add(e = new VueEntite { PvuCode = code, PvuOrdre = 100 });
        e.PvuLibelle = libelle;
        e.PvuUtilisateur = globale ? null : u.Code;
        e.PvuDefinition = JsonSerializer.Serialize(d, Json);
        await db.SaveChangesAsync(ct);
        return new { code };
    }

    internal async Task<DefinitionVue> DefinitionAsync(string? code, CancellationToken ct)
    {
        var v = code is null ? null : await db.Vues.AsNoTracking().FirstOrDefaultAsync(x => x.PvuCode == code, ct);
        return v is null ? new DefinitionVue() : JsonSerializer.Deserialize<DefinitionVue>(v.PvuDefinition, Json) ?? new DefinitionVue();
    }

    internal async Task<List<int>?> ServicesDeAsync(IEnumerable<string>? codes, CancellationToken ct)
    {
        var l = codes?.ToList();
        if (l is null || l.Count == 0) return null;
        return (await specialisation.ServicesAsync(db, ct)).Where(s => l.Contains(s.Code)).Select(s => s.Id).ToList();
    }

    /// <summary>
    /// Données d'une période pour une vue : lignes (ressources groupées par service, chantiers ou services) et barres
    /// (une par affectation en vue ressources, tâches théoriques sur la ligne de leur service ; une par tâche sinon).
    /// </summary>
    public async Task<object> DonneesAsync(string? vue, string du, string au, string? recherche, CancellationToken ct)
    {
        var d = await DefinitionAsync(vue, ct);
        var debut = Lire(du);
        var fin = Lire(au);
        var services = await specialisation.ServicesAsync(db, ct);
        var filtreSrv = await ServicesDeAsync(d.Services, ct);
        var taches = await db.Taches.AsNoTracking().Where(t => t.TacDebut < fin && t.TacFin > debut).ToListAsync(ct);
        if (filtreSrv is not null && d.Regroupement != "RESSOURCE") taches = taches.Where(t => t.TacSrvId is int s && filtreSrv.Contains(s)).ToList();
        var ids = taches.Select(t => t.TacId).ToList();
        var affectations = await db.Affectations.AsNoTracking().Where(a => ids.Contains(a.AffTacId)).ToListAsync(ct);
        var elements = (await specialisation.ElementsAsync(db, "chantier", taches.Where(t => t.TacTypeElement == "chantier" && t.TacIdElement != null)
            .Select(t => t.TacIdElement!).Distinct().ToList(), null, ct)).ToDictionary(e => e.Id);
        var cles = affectations.Select(a => $"{a.AffResType}:{a.AffResId}").Distinct().ToList();
        var ressources = d.Regroupement == "RESSOURCE"
            ? await specialisation.RessourcesAsync(db, new FiltreRessources(filtreSrv, d.Types, recherche), ct)
            : await specialisation.RessourcesAsync(db, new FiltreRessources(null, null, null, cles), ct);
        var libRes = (await specialisation.RessourcesAsync(db, new FiltreRessources(null, null, null, cles), ct)).ToDictionary(r => r.Cle, r => r.Libelle);
        object Barre(TacheEntite t, string cle, string ligne, bool theorique) => new
        {
            cle, tache = t.TacId, ligne, debut = Ecrire(t.TacDebut), fin = Ecrire(t.TacFin), libelle = t.TacLibelle, heures = t.TacHeures, etat = t.TacEtat, couleur = t.TacCouleur,
            srv_id = t.TacSrvId, calcul = t.TacCalcul, version = t.TacVersion, theorique, type_element = t.TacTypeElement,
            element = t.TacIdElement is not null && elements.TryGetValue(t.TacIdElement, out var e) ? new { e.Code, e.Libelle } : null,
            ressources = affectations.Where(a => a.AffTacId == t.TacId).Select(a => libRes.GetValueOrDefault($"{a.AffResType}:{a.AffResId}") ?? $"{a.AffResType} {a.AffResId}").ToList(),
        };
        var lignes = new List<object>();
        var barres = new List<object>();
        if (d.Regroupement == "RESSOURCE")
        {
            var parService = ressources.GroupBy(r => r.SrvId).ToList();
            var connues = ressources.Select(r => r.Cle).ToHashSet();
            foreach (var s in services.Where(s => filtreSrv is null ? parService.Any(g => g.Key == s.Id) : filtreSrv.Contains(s.Id)))
            {
                lignes.Add(new { cle = $"srv:{s.Id}", libelle = s.Libelle, classe = "groupe", ligne_fixe = true, srv_id = s.Id });
                foreach (var r in ressources.Where(r => r.SrvId == s.Id).OrderBy(r => r.Type == "MATERIEL").ThenBy(r => r.Libelle))
                {
                    lignes.Add(new { cle = r.Cle, libelle = r.Libelle, type = r.Type, srv_id = s.Id, capacite = r.Capacite, quantite = r.Quantite });
                }
            }
            var sansService = ressources.Where(r => r.SrvId is null || services.All(s => s.Id != r.SrvId)).ToList();
            if (sansService.Count > 0 && filtreSrv is null)
            {
                lignes.Add(new { cle = "srv:0", libelle = "Sans service", classe = "groupe", ligne_fixe = true, srv_id = (int?)null });
                foreach (var r in sansService.OrderBy(r => r.Libelle)) lignes.Add(new { cle = r.Cle, libelle = r.Libelle, type = r.Type, srv_id = (int?)null, capacite = r.Capacite, quantite = r.Quantite });
            }
            foreach (var t in taches)
            {
                var affs = affectations.Where(a => a.AffTacId == t.TacId).ToList();
                if (affs.Count == 0)
                {
                    if (filtreSrv is null || t.TacSrvId is int s && filtreSrv.Contains(s)) barres.Add(Barre(t, t.TacId.ToString(CultureInfo.InvariantCulture), $"srv:{t.TacSrvId ?? 0}", true));
                    continue;
                }
                foreach (var a in affs)
                {
                    var cle = $"{a.AffResType}:{a.AffResId}";
                    if (connues.Contains(cle)) barres.Add(Barre(t, $"{t.TacId}/{cle}", cle, false));
                }
            }
        }
        else if (d.Regroupement == "CHANTIER")
        {
            foreach (var e in elements.Values.OrderBy(e => e.Code)) lignes.Add(new { cle = $"chantier:{e.Id}", libelle = $"{e.Code} {e.Libelle}", url = e.Url });
            var autres = taches.Where(t => t.TacTypeElement != "chantier" || t.TacIdElement is null).ToList();
            if (autres.Count > 0) lignes.Add(new { cle = "autres", libelle = "Autres tâches (absences, internes…)", url = (string?)null });
            foreach (var t in taches) barres.Add(Barre(t, t.TacId.ToString(CultureInfo.InvariantCulture), t.TacTypeElement == "chantier" && t.TacIdElement is not null ? $"chantier:{t.TacIdElement}" : "autres", affectations.All(a => a.AffTacId != t.TacId)));
        }
        else
        {
            foreach (var s in services.Where(s => filtreSrv is null || filtreSrv.Contains(s.Id))) lignes.Add(new { cle = $"srv:{s.Id}", libelle = s.Libelle, srv_id = s.Id });
            lignes.Add(new { cle = "srv:0", libelle = "Sans service", srv_id = (int?)null });
            foreach (var t in taches) barres.Add(Barre(t, t.TacId.ToString(CultureInfo.InvariantCulture), $"srv:{t.TacSrvId ?? 0}", affectations.All(a => a.AffTacId != t.TacId)));
        }
        return new { definition = d, lignes, barres };
    }

    /// <summary>Ressources à capacité ou non des affectations (équipes développées en membres à la date de début).</summary>
    private async Task<List<(AffectationSaisie Saisie, RessourcePlanning? Ressource)>> DevelopperAsync(IEnumerable<AffectationSaisie> l, DateOnly date, CancellationToken ct)
    {
        var r = new List<AffectationSaisie>();
        foreach (var a in l)
        {
            if (a.Type == "EQUIPE")
            {
                var equipe = int.Parse(a.Id, CultureInfo.InvariantCulture);
                r.AddRange((await specialisation.MembresAsync(db, equipe, date, ct)).Select(m => new AffectationSaisie(m.Type, m.Id, equipe)));
            }
            else r.Add(a);
        }
        r = r.GroupBy(a => $"{a.Type}:{a.Id}").Select(g => g.First()).ToList();
        var ressources = (await specialisation.RessourcesAsync(db, new FiltreRessources(null, null, null, r.Select(a => $"{a.Type}:{a.Id}").ToList()), ct)).ToDictionary(x => x.Cle);
        return r.Select(a => (a, ressources.GetValueOrDefault($"{a.Type}:{a.Id}"))).ToList();
    }

    /// <summary>Calcule une tâche : plages des ressources (horizon de 120 jours en mode 1), absences des tâches d'absence.</summary>
    private async Task<ResultatCalcul> CalculerAsync(int mode, long debut, long? fin, int? heures, int nb, int? srv, List<(AffectationSaisie Saisie, RessourcePlanning? Ressource)> affs, long? exclure, CancellationToken ct)
    {
        var du = Temps.DateDe(debut);
        var au = mode == 1 || fin is null ? du.AddDays(HorizonJours) : Temps.DateDe(fin.Value);
        var ressources = affs.Where(a => a.Ressource is not null).Select(a => a.Ressource!).ToList();
        var plages = await specialisation.PlagesAsync(db, ressources, du, au, ct);
        var defaut = await specialisation.PlagesServiceAsync(db, srv, du, au, ct);
        var cles = ressources.Select(r => r.Cle).ToList();
        var debutDt = Temps.DateHeureDe(Temps.VersMinutes(du));
        var finDt = Temps.DateHeureDe(Temps.VersMinutes(au.AddDays(1)));
        var absences = await (from a in db.Affectations
                              join t in db.Taches on a.AffTacId equals t.TacId
                              where t.TacTypeElement == "absence" && t.TacId != (exclure ?? 0) && t.TacDebut < finDt && t.TacFin > debutDt
                              select new { a.AffResType, a.AffResId, t.TacDebut, t.TacFin }).AsNoTracking().ToListAsync(ct);
        return ReglesPlanning.Calculer(new TacheCalcul(mode, debut, fin, heures,
            ressources.Select(r => new RessourceCalcul(r.Cle, plages.GetValueOrDefault(r.Cle) ?? [], r.Capacite)).ToList(),
            absences.Where(a => cles.Contains($"{a.AffResType}:{a.AffResId}")).Select(a => new AbsenceCalcul($"{a.AffResType}:{a.AffResId}", Temps.VersMinutes(a.TacDebut), Temps.VersMinutes(a.TacFin))).ToList(),
            defaut, nb));
    }

    private static void Verifier(ResultatCalcul r)
    {
        if (r.Erreurs.Count > 0) throw ExceptionMetier.Invalide(r.Erreurs[0], ReglesPlanning.Messages[r.Erreurs[0]], r.Erreurs);
    }

    /// <summary>Aperçu du calcul d'une tâche saisie (fin ou heures, heures par ressource, ventilation).</summary>
    public async Task<object> ApercuAsync(TacheSaisie s, CancellationToken ct)
    {
        var debut = Temps.VersMinutes(s.Debut);
        var affs = await DevelopperAsync(s.Affectations ?? [], Temps.DateDe(debut), ct);
        var r = await CalculerAsync(s.Calcul, debut, s.Fin is null ? null : Temps.VersMinutes(s.Fin), s.Heures, s.NbRessources, s.SrvId, affs, null, ct);
        return new { fin = r.Fin is long f ? Temps.Ecrire(f) : null, heures = r.Heures, par_ressource = r.ParRessource, ventilation = r.Ventilation, erreurs = r.Erreurs };
    }

    private async Task AppliquerAsync(TacheEntite t, TacheSaisie s, Utilisateur u, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(s.Libelle)) throw ExceptionMetier.Invalide("PLA_LIBELLE", "Libellé obligatoire");
        if (s.Calcul is < 1 or > 3) throw ExceptionMetier.Invalide("PLA_MODE", "Mode de calcul inconnu");
        var debut = Temps.VersMinutes(s.Debut);
        var affs = await DevelopperAsync(s.Affectations ?? [], Temps.DateDe(debut), ct);
        if (affs.Any(a => a.Ressource is null)) throw ExceptionMetier.Invalide("PLA_RESSOURCE", "Ressource inconnue");
        var r = await CalculerAsync(s.Calcul, debut, s.Fin is null ? null : Temps.VersMinutes(s.Fin), s.Heures, s.NbRessources, s.SrvId, affs, t.TacId == 0 ? null : t.TacId, ct);
        Verifier(r);
        t.TacCalcul = (short)s.Calcul;
        t.TacDebut = Temps.DateHeureDe(debut);
        t.TacFin = Temps.DateHeureDe(r.Fin!.Value);
        t.TacHeures = r.Heures ?? 0;
        t.TacNbRessources = (short)Math.Max(1, s.NbRessources);
        t.TacSrvId = s.SrvId;
        t.TacTypeElement = s.TypeElement;
        t.TacIdElement = s.IdElement;
        t.TacOrigineType = s.OrigineType;
        t.TacOrigineId = s.OrigineId;
        t.TacLibelle = s.Libelle.Trim();
        t.TacMemo = s.Memo;
        t.TacAvancement = (short)Math.Clamp(s.Avancement, 0, 100);
        t.TacCouleur = s.Couleur;
        t.TacEtat = s.Etat;
        t.TacHabilitations = [.. (s.Habilitations ?? []).Select(h => h.Trim()).Where(h => h.Length > 0).Distinct()];
        if (s.ParentId == t.TacId && t.TacId != 0) throw ExceptionMetier.Invalide("PLA_PARENT", "Une tâche ne peut pas être sa propre tâche principale");
        t.TacParentId = s.ParentId;
        if (s.Serie is not null) t.TacSerie = s.Serie;
        // Partie mobile (adresse, contact, commentaire, liens) : absente de la saisie = inchangée.
        if (s.Mobile is not null) t.TacMobile = JsonSerializer.Serialize(s.Mobile.Where(x => !string.IsNullOrWhiteSpace(x.Value)).ToDictionary(x => x.Key, x => x.Value!.Trim()));
        t.TacMajPar = u.Code;
        t.TacMajLe = DateTimeOffset.UtcNow;
        if (t.TacId == 0)
        {
            t.TacCreePar = u.Code;
            db.Taches.Add(t);
            await db.SaveChangesAsync(ct);
        }
        await db.Affectations.Where(a => a.AffTacId == t.TacId).ExecuteDeleteAsync(ct);
        db.Affectations.AddRange(affs.Select(a => new AffectationEntite
        {
            AffTacId = t.TacId, AffResType = a.Saisie.Type, AffResId = a.Saisie.Id, AffEquipeId = a.Saisie.EquipeId, AffQuantite = a.Saisie.Quantite,
            AffHeures = a.Ressource!.Capacite ? r.ParRessource.GetValueOrDefault(a.Ressource.Cle)
                : (int)Math.Min(int.MaxValue, Temps.VersMinutes(t.TacFin) - Temps.VersMinutes(t.TacDebut)),
        }));
    }

    public async Task<object> TacheAsync(long id, CancellationToken ct)
    {
        var t = await db.Taches.AsNoTracking().FirstOrDefaultAsync(x => x.TacId == id, ct) ?? throw ExceptionMetier.Introuvable($"Tâche {id}");
        var affs = await db.Affectations.AsNoTracking().Where(a => a.AffTacId == id).ToListAsync(ct);
        var res = (await specialisation.RessourcesAsync(db, new FiltreRessources(null, null, null, affs.Select(a => $"{a.AffResType}:{a.AffResId}").ToList()), ct)).ToDictionary(r => r.Cle);
        var element = t.TacIdElement is null ? null : (await specialisation.ElementsAsync(db, t.TacTypeElement, [t.TacIdElement], null, ct)).FirstOrDefault();
        return new
        {
            id = t.TacId, calcul = t.TacCalcul, debut = Ecrire(t.TacDebut), fin = Ecrire(t.TacFin), heures = t.TacHeures, nb_ressources = t.TacNbRessources, srv_id = t.TacSrvId,
            type_element = t.TacTypeElement, id_element = t.TacIdElement, element, origine_type = t.TacOrigineType, origine_id = t.TacOrigineId, libelle = t.TacLibelle,
            memo = t.TacMemo, avancement = t.TacAvancement, couleur = t.TacCouleur, etat = t.TacEtat, version = t.TacVersion, maj_par = t.TacMajPar, maj_le = t.TacMajLe,
            habilitations = t.TacHabilitations, parent_id = t.TacParentId, serie = t.TacSerie, mobile = Mobile(t),
            parent = t.TacParentId is long p ? await db.Taches.AsNoTracking().Where(x => x.TacId == p).Select(x => x.TacLibelle).FirstOrDefaultAsync(ct) : null,
            affectations = affs.Select(a => new
            {
                type = a.AffResType, id = a.AffResId, equipe_id = a.AffEquipeId, heures = a.AffHeures, quantite = a.AffQuantite,
                libelle = res.GetValueOrDefault($"{a.AffResType}:{a.AffResId}")?.Libelle, capacite = res.GetValueOrDefault($"{a.AffResType}:{a.AffResId}")?.Capacite,
            }),
        };
    }

    public async Task<object> CreerAsync(TacheSaisie s, Utilisateur u, CancellationToken ct) => await TacheAsync(await CreerIdAsync(s, u, ct), ct);

    public async Task<long> CreerIdAsync(TacheSaisie s, Utilisateur u, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = new TacheEntite();
        await AppliquerAsync(t, s, u, ct);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        Publier("creee", [t.TacId], u);
        return t.TacId;
    }

    private async Task<TacheEntite> VerrouAsync(long id, int version, CancellationToken ct)
    {
        var t = await db.Taches.FirstOrDefaultAsync(x => x.TacId == id, ct) ?? throw ExceptionMetier.Introuvable($"Tâche {id}");
        if (t.TacVersion != version) throw ExceptionMetier.Conflit("PLA_VERSION", "La tâche a été modifiée par ailleurs : elle est rechargée", new { version = t.TacVersion });
        t.TacVersion++;
        return t;
    }

    public async Task<object> ModifierAsync(long id, TacheSaisie s, Utilisateur u, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = await VerrouAsync(id, s.Version ?? -1, ct);
        await AppliquerAsync(t, s, u, ct);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        Publier("modifiee", [id], u);
        return await TacheAsync(id, ct);
    }

    public async Task SupprimerAsync(long id, int version, Utilisateur u, CancellationToken ct)
    {
        await VerrouAsync(id, version, ct);
        await db.Taches.Where(x => x.TacId == id).ExecuteDeleteAsync(ct);
        Publier("supprimee", [id], u);
    }

    /// <summary>Partie mobile de la tâche (textes : adresse, contact, commentaire, liens).</summary>
    private static Dictionary<string, string?> Mobile(TacheEntite t)
    {
        try { return JsonSerializer.Deserialize<Dictionary<string, string?>>(t.TacMobile) ?? []; }
        catch (JsonException) { return []; }
    }

    private async Task<TacheSaisie> SaisieDeAsync(TacheEntite t, CancellationToken ct)
    {
        var affs = await db.Affectations.AsNoTracking().Where(a => a.AffTacId == t.TacId).ToListAsync(ct);
        return new TacheSaisie(t.TacCalcul, Ecrire(t.TacDebut), Ecrire(t.TacFin), t.TacHeures, t.TacNbRessources, t.TacSrvId, t.TacTypeElement, t.TacIdElement, t.TacLibelle,
            affs.Select(a => new AffectationSaisie(a.AffResType, a.AffResId, a.AffEquipeId, a.AffQuantite)).ToList(), t.TacOrigineType, t.TacOrigineId, t.TacMemo, t.TacAvancement,
            t.TacCouleur, t.TacEtat, t.TacVersion, [.. t.TacHabilitations], t.TacParentId, t.TacSerie, Mobile(t));
    }

    /// <summary>Saisie d'une tâche enregistrée (recalculs du lot 4).</summary>
    internal async Task<TacheSaisie> SaisieAsync(long id, CancellationToken ct) =>
        await SaisieDeAsync(await db.Taches.AsNoTracking().FirstOrDefaultAsync(x => x.TacId == id, ct) ?? throw ExceptionMetier.Introuvable($"Tâche {id}"), ct);

    /// <summary>
    /// Glisser : déplacement (heures gardées : fin recalculée en mode 1, durée gardée sinon, heures recalculées en mode
    /// 2), redimensionnement (heures recalculées, le mode reste), changement de ressource (affectation de → vers),
    /// copie (Ctrl : nouvelle tâche à l'endroit du dépôt).
    /// </summary>
    public async Task<object> DeplacerAsync(long id, DeplacementSaisi d, Utilisateur u, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = d.Copie ? await db.Taches.FirstOrDefaultAsync(x => x.TacId == id, ct) ?? throw ExceptionMetier.Introuvable($"Tâche {id}") : await VerrouAsync(id, d.Version, ct);
        var s = await SaisieDeAsync(t, ct);
        var modeOrigine = t.TacCalcul;
        var affs = s.Affectations!;
        if (d.De is not null && d.Vers is not null && d.De != d.Vers && d.Vers.Contains(':') && !d.Vers.StartsWith("srv:", StringComparison.Ordinal))
        {
            var i = affs.FindIndex(a => $"{a.Type}:{a.Id}" == d.De);
            var p = d.Vers.Split(':', 2);
            var nouvelle = new AffectationSaisie(p[0], p[1], null, i >= 0 ? affs[i].Quantite : null);
            if (i >= 0) affs[i] = nouvelle; else if (!affs.Any(a => $"{a.Type}:{a.Id}" == d.Vers)) affs.Add(nouvelle);
            if (d.Copie) affs = [nouvelle];
        }
        var duree = Temps.VersMinutes(s.Fin!) - Temps.VersMinutes(s.Debut);
        s = d.Mode switch
        {
            "deplacer" => s.Calcul == 1 ? s with { Debut = d.Debut, Fin = null }
                : s with { Debut = d.Debut, Fin = Temps.Ecrire(Temps.VersMinutes(d.Debut) + duree), Heures = s.Calcul == 2 ? null : s.Heures },
            _ => s with { Debut = d.Debut, Fin = d.Fin, Calcul = s.Calcul == 3 ? 3 : 2, Heures = s.Calcul == 3 ? s.Heures : null },
        };
        s = s with { Affectations = affs };
        var cible = d.Copie ? new TacheEntite() : t;
        await AppliquerAsync(cible, s, u, ct);
        if (d.Mode != "deplacer") cible.TacCalcul = modeOrigine;
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        Publier(d.Copie ? "creee" : "modifiee", [cible.TacId], u);
        return await TacheAsync(cible.TacId, ct);
    }

    /// <summary>Scinde une tâche à un instant : deux tâches indépendantes de même origine, heures recalculées (mode 2).</summary>
    public async Task<object> ScinderAsync(long id, ScissionSaisie sc, Utilisateur u, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = await VerrouAsync(id, sc.Version, ct);
        var s = await SaisieDeAsync(t, ct);
        var instant = Temps.VersMinutes(sc.Instant);
        if (instant <= Temps.VersMinutes(s.Debut) || instant >= Temps.VersMinutes(s.Fin!)) throw ExceptionMetier.Invalide("PLA_SCISSION", "Instant hors de la tâche");
        await AppliquerAsync(t, s with { Calcul = 2, Fin = Temps.Ecrire(instant), Heures = null }, u, ct);
        var suite = new TacheEntite();
        await AppliquerAsync(suite, s with { Calcul = 2, Debut = Temps.Ecrire(instant), Heures = null }, u, ct);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        Publier("scindee", [t.TacId, suite.TacId], u);
        return new { premiere = await TacheAsync(t.TacId, ct), seconde = await TacheAsync(suite.TacId, ct) };
    }

    /// <summary>Tâches à planifier : budget d'heures par élément et service moins les heures des tâches qui les consomment (P16).</summary>
    public async Task<object> APlanifierAsync(string? services, string? recherche, CancellationToken ct)
    {
        var srv = await ServicesDeAsync(services?.Split(',', StringSplitOptions.RemoveEmptyEntries), ct);
        var budgets = await specialisation.BudgetsAsync(db, srv, recherche, ct);
        var ids = budgets.Select(b => b.Id).Distinct().ToList();
        var planifie = await db.Taches.AsNoTracking().Where(t => t.TacTypeElement == "chantier" && t.TacIdElement != null && ids.Contains(t.TacIdElement))
            .GroupBy(t => new { t.TacIdElement, t.TacSrvId }).Select(g => new { g.Key.TacIdElement, g.Key.TacSrvId, Minutes = g.Sum(t => t.TacHeures) }).ToListAsync(ct);
        var elements = (await specialisation.ElementsAsync(db, "chantier", ids, null, ct)).ToDictionary(e => e.Id);
        var libSrv = (await specialisation.ServicesAsync(db, ct)).ToDictionary(s => s.Id, s => s.Libelle);
        return budgets.Where(b => elements.ContainsKey(b.Id)).Select(b =>
        {
            var p = planifie.FirstOrDefault(x => x.TacIdElement == b.Id && x.TacSrvId == b.SrvId)?.Minutes ?? 0;
            var e = elements[b.Id];
            return new { type = b.Type, id = b.Id, code = e.Code, libelle = e.Libelle, srv_id = b.SrvId, service = libSrv.GetValueOrDefault(b.SrvId), budget = b.Minutes, planifie = p, reste = b.Minutes - p };
        }).OrderByDescending(x => x.reste).ToList();
    }

    public async Task<object> ReferentielsAsync(CancellationToken ct) => new
    {
        services = await specialisation.ServicesAsync(db, ct),
        equipes = await specialisation.EquipesAsync(db, ct),
        habilitations = (await specialisation.TypesHabilitationAsync(db, ct)).Select(h => new { code = h.Code, libelle = h.Libelle }),
    };

    public async Task<List<RessourcePlanning>> RessourcesAsync(string? services, string? types, string? recherche, CancellationToken ct) =>
        await specialisation.RessourcesAsync(db, new FiltreRessources(await ServicesDeAsync(services?.Split(',', StringSplitOptions.RemoveEmptyEntries), ct),
            types?.Split(',', StringSplitOptions.RemoveEmptyEntries), recherche), ct);

    public Task<List<ElementPlanning>> ElementsAsync(string? recherche, CancellationToken ct) => specialisation.ElementsAsync(db, "chantier", null, recherche, ct);
}
