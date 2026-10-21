using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Calendrier.Web;

public class CalendrierEntite
{
    public int CalId { get; set; }
    public string CalCode { get; set; } = "";
    public string CalLibelle { get; set; } = "";
    public int CalCycleSemaines { get; set; } = 1;
    public DateOnly? CalReference { get; set; }
    public bool CalDefaut { get; set; }
    public bool CalActif { get; set; } = true;
    public string? CalMajPar { get; set; }
    public DateTimeOffset CalMajLe { get; set; } = DateTimeOffset.UtcNow;
}

public class PlageEntite
{
    public int PlgId { get; set; }
    public int PlgCalId { get; set; }
    public int PlgSemaine { get; set; } = 1;
    public int PlgJour { get; set; }
    public int PlgDebut { get; set; }
    public int PlgFin { get; set; }
    public DateOnly? PlgDu { get; set; }
    public DateOnly? PlgAu { get; set; }
}

public class JourFermeEntite
{
    public int JfeId { get; set; }
    public string? JfeCode { get; set; }
    public string JfeLibelle { get; set; } = "";
    public string JfeRegle { get; set; } = "ANNUEL";
    public DateOnly? JfeDate { get; set; }
    public int? JfeMois { get; set; }
    public int? JfeJour { get; set; }
    public int? JfeRang { get; set; }
    public int? JfeDecalage { get; set; }
    public DateOnly? JfeDu { get; set; }
    public DateOnly? JfeAu { get; set; }
    public string? JfeZone { get; set; }
    public string? JfeTypeElement { get; set; }
    public string? JfeIdElement { get; set; }
    public bool JfeActif { get; set; } = true;
    public string? JfeMajPar { get; set; }
    public DateTimeOffset JfeMajLe { get; set; } = DateTimeOffset.UtcNow;

    public RegleFerme Regle() => new(JfeRegle, JfeLibelle, JfeDate, JfeMois, JfeJour, JfeRang, JfeDecalage, JfeDu, JfeAu, JfeActif);
}

public class CalendrierDbContext(DbContextOptions<CalendrierDbContext> options) : DbContext(options)
{
    public DbSet<CalendrierEntite> Calendriers => Set<CalendrierEntite>();
    public DbSet<PlageEntite> Plages => Set<PlageEntite>();
    public DbSet<JourFermeEntite> JoursFermes => Set<JourFermeEntite>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<CalendrierEntite>().ToTable("calendrier").HasKey(x => x.CalId);
        b.Entity<PlageEntite>().ToTable("calendrier_plage").HasKey(x => x.PlgId);
        b.Entity<JourFermeEntite>().ToTable("jour_ferme").HasKey(x => x.JfeId);
    }
}

/// <summary>Portée de jours fermés : un élément de l'application (service…) ou un calendrier ; null pour la société.</summary>
public sealed record Portee(string Type, string Id)
{
    /// <summary>« service:7 » → (service, 7).</summary>
    public static Portee? Lire(string? p) => p?.Split(':', 2) is [var t, var i] && t.Length > 0 && i.Length > 0 ? new Portee(t, i) : null;
}

public sealed record PlageDto(int Semaine, int Jour, int Debut, int Fin, DateOnly? Du, DateOnly? Au);
public sealed record CalendrierDto(int? Id, string Code, string Libelle, int CycleSemaines, DateOnly? Reference, bool Defaut, bool Actif, List<PlageDto> Plages, int Utilisations = 0);
public sealed record JourFermeDto(int? Id, string? Code, string Libelle, string Regle, DateOnly? Date, int? Mois, int? Jour, int? Rang, int? Decalage,
    DateOnly? Du, DateOnly? Au, string? Zone, bool Actif);
public sealed record JoursFermesSaisis(string? Type, string? Id, List<JourFermeDto> Regles);

/// <summary>
/// Calendriers de travail et jours fermés : lecture, écriture (contrôles de <see cref="ReglesCalendrier"/>, administrateur),
/// journées d'un calendrier sur une période avec les jours fermés de la société, du calendrier et des portées demandées.
/// Utilisé aussi directement par l'application (calendrier d'une ressource) via <see cref="ChargerAsync"/> et <see cref="FermesAsync"/>.
/// </summary>
public sealed class ServiceCalendrier(CalendrierDbContext db, SpecialisationCalendrier specialisation)
{
    private static void Admin(Utilisateur u)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
    }

    private static CalendrierTravail Travail(CalendrierEntite c, IEnumerable<PlageEntite> plages) =>
        new(c.CalCycleSemaines, c.CalReference, plages.Select(p => new Plage(p.PlgJour, p.PlgDebut, p.PlgFin, p.PlgSemaine, p.PlgDu, p.PlgAu)).ToList());

    public async Task<List<CalendrierDto>> ListeAsync(CancellationToken ct)
    {
        var cals = await db.Calendriers.AsNoTracking().OrderByDescending(c => c.CalDefaut).ThenBy(c => c.CalCode).ToListAsync(ct);
        var plages = await db.Plages.AsNoTracking().ToListAsync(ct);
        var res = new List<CalendrierDto>();
        foreach (var c in cals)
        {
            res.Add(Dto(c, plages.Where(p => p.PlgCalId == c.CalId), await specialisation.UtilisationsAsync(db, c.CalId, ct)));
        }
        return res;
    }

    private static CalendrierDto Dto(CalendrierEntite c, IEnumerable<PlageEntite> plages, int utilisations) => new(c.CalId, c.CalCode, c.CalLibelle, c.CalCycleSemaines,
        c.CalReference, c.CalDefaut, c.CalActif,
        plages.OrderBy(p => p.PlgDu.HasValue).ThenBy(p => p.PlgDu).ThenBy(p => p.PlgSemaine).ThenBy(p => p.PlgJour).ThenBy(p => p.PlgDebut)
            .Select(p => new PlageDto(p.PlgSemaine, p.PlgJour, p.PlgDebut, p.PlgFin, p.PlgDu, p.PlgAu)).ToList(), utilisations);

    /// <summary>Calendrier de travail (null : inconnu ; sans identifiant : calendrier par défaut).</summary>
    public async Task<(int Id, CalendrierTravail Travail)?> ChargerAsync(int? id, CancellationToken ct)
    {
        var c = id is int i ? await db.Calendriers.AsNoTracking().FirstOrDefaultAsync(x => x.CalId == i, ct)
            : await db.Calendriers.AsNoTracking().FirstOrDefaultAsync(x => x.CalDefaut, ct);
        if (c is null) return null;
        return (c.CalId, Travail(c, await db.Plages.AsNoTracking().Where(p => p.PlgCalId == c.CalId).ToListAsync(ct)));
    }

    /// <summary>Jours fermés de [du, au] : société, calendrier et portées (services…).</summary>
    public async Task<List<JourFerme>> FermesAsync(int? calendrier, IEnumerable<Portee> portees, DateOnly du, DateOnly au, CancellationToken ct)
    {
        var cles = portees.Select(p => p.Type + ":" + p.Id).ToList();
        if (calendrier is int c) cles.Add("calendrier:" + c);
        var regles = await db.JoursFermes.AsNoTracking()
            .Where(j => j.JfeActif && (j.JfeTypeElement == null || cles.Contains(j.JfeTypeElement + ":" + j.JfeIdElement)))
            .OrderBy(j => j.JfeTypeElement != null).ThenBy(j => j.JfeId).ToListAsync(ct);
        return ReglesCalendrier.JoursFermes(regles.Select(r => r.Regle()), du, au);
    }

    public async Task<List<Journee>> JourneesAsync(int? id, DateOnly du, DateOnly au, IEnumerable<Portee> portees, CancellationToken ct)
    {
        if (au < du || au.DayNumber - du.DayNumber > 400) throw ExceptionMetier.Invalide("PERIODE", "Période de 400 jours au plus, fin après le début");
        var c = await ChargerAsync(id, ct) ?? throw ExceptionMetier.Introuvable($"Calendrier {id}");
        return ReglesCalendrier.Journees(c.Travail, await FermesAsync(c.Id, portees, du, au, ct), du, au);
    }

    public async Task<CalendrierDto> EnregistrerAsync(int? id, CalendrierDto s, Utilisateur u, CancellationToken ct)
    {
        Admin(u);
        if (string.IsNullOrWhiteSpace(s.Code) || string.IsNullOrWhiteSpace(s.Libelle)) throw ExceptionMetier.Invalide("CALENDRIER", "Code et libellé obligatoires");
        var travail = new CalendrierTravail(s.CycleSemaines, s.Reference, s.Plages.Select(p => new Plage(p.Jour, p.Debut, p.Fin, p.Semaine, p.Du, p.Au)).ToList());
        var erreurs = ReglesCalendrier.ControlerCalendrier(travail);
        if (erreurs.Count > 0) throw ExceptionMetier.Invalide(erreurs[0], string.Join(" · ", erreurs.Select(e => ReglesCalendrier.Messages[e])), erreurs);
        var code = s.Code.Trim().ToUpperInvariant();
        if (await db.Calendriers.AnyAsync(c => c.CalCode == code && c.CalId != (id ?? 0), ct)) throw ExceptionMetier.Conflit("CALENDRIER_CODE", $"Code {code} déjà utilisé");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var c = id is int i ? await db.Calendriers.FirstOrDefaultAsync(x => x.CalId == i, ct) ?? throw ExceptionMetier.Introuvable($"Calendrier {i}") : new CalendrierEntite();
        if (s.Defaut && !c.CalDefaut) await db.Calendriers.Where(x => x.CalDefaut).ExecuteUpdateAsync(x => x.SetProperty(y => y.CalDefaut, false), ct);
        c.CalCode = code;
        c.CalLibelle = s.Libelle.Trim();
        c.CalCycleSemaines = s.CycleSemaines;
        c.CalReference = s.Reference;
        c.CalDefaut = s.Defaut || c.CalDefaut && !await db.Calendriers.AnyAsync(x => x.CalDefaut && x.CalId != c.CalId, ct);
        c.CalActif = s.Actif || c.CalDefaut;
        c.CalMajPar = u.Code;
        c.CalMajLe = DateTimeOffset.UtcNow;
        if (id is null) db.Calendriers.Add(c);
        await db.SaveChangesAsync(ct);
        await db.Plages.Where(p => p.PlgCalId == c.CalId).ExecuteDeleteAsync(ct);
        db.Plages.AddRange(s.Plages.Select(p => new PlageEntite { PlgCalId = c.CalId, PlgSemaine = p.Semaine, PlgJour = p.Jour, PlgDebut = p.Debut, PlgFin = p.Fin, PlgDu = p.Du, PlgAu = p.Au }));
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Dto(c, await db.Plages.AsNoTracking().Where(p => p.PlgCalId == c.CalId).ToListAsync(ct), await specialisation.UtilisationsAsync(db, c.CalId, ct));
    }

    public async Task SupprimerAsync(int id, Utilisateur u, CancellationToken ct)
    {
        Admin(u);
        var c = await db.Calendriers.FirstOrDefaultAsync(x => x.CalId == id, ct) ?? throw ExceptionMetier.Introuvable($"Calendrier {id}");
        if (c.CalDefaut) throw ExceptionMetier.Conflit("CALENDRIER_DEFAUT", "Le calendrier par défaut ne se supprime pas");
        if (await specialisation.UtilisationsAsync(db, id, ct) > 0) throw ExceptionMetier.Conflit("CALENDRIER_UTILISE", "Calendrier utilisé (services, ressources) : désactivez-le");
        db.Calendriers.Remove(c);
        await db.JoursFermes.Where(j => j.JfeTypeElement == "calendrier" && j.JfeIdElement == id.ToString()).ExecuteDeleteAsync(ct);
        await db.SaveChangesAsync(ct);
    }

    public async Task<List<JourFermeDto>> JoursFermesAsync(Portee? portee, CancellationToken ct)
    {
        var q = db.JoursFermes.AsNoTracking();
        q = portee is null ? q.Where(j => j.JfeTypeElement == null) : q.Where(j => j.JfeTypeElement == portee.Type && j.JfeIdElement == portee.Id);
        return (await q.OrderBy(j => j.JfeZone == null).ThenBy(j => j.JfeZone).ThenBy(j => j.JfeId).ToListAsync(ct)).Select(Dto).ToList();
    }

    private static JourFermeDto Dto(JourFermeEntite j) => new(j.JfeId, j.JfeCode, j.JfeLibelle, j.JfeRegle, j.JfeDate, j.JfeMois, j.JfeJour, j.JfeRang, j.JfeDecalage, j.JfeDu, j.JfeAu, j.JfeZone, j.JfeActif);

    /// <summary>
    /// Remplace les règles d'une portée (société : les règles du catalogue retirées sont désactivées, jamais supprimées).
    /// </summary>
    public async Task<List<JourFermeDto>> EnregistrerJoursFermesAsync(JoursFermesSaisis s, Utilisateur u, CancellationToken ct)
    {
        Admin(u);
        var portee = s.Type is null ? null : new Portee(s.Type, s.Id ?? "");
        foreach (var r in s.Regles)
        {
            if (string.IsNullOrWhiteSpace(r.Libelle)) throw ExceptionMetier.Invalide("FER_LIBELLE", "Libellé obligatoire");
            var e = ReglesCalendrier.ControlerRegle(new RegleFerme(r.Regle, r.Libelle, r.Date, r.Mois, r.Jour, r.Rang, r.Decalage, r.Du, r.Au));
            if (e.Count > 0) throw ExceptionMetier.Invalide(e[0], $"{r.Libelle} : {string.Join(", ", e.Select(x => ReglesCalendrier.Messages[x]))}", e);
        }
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var existants = await (portee is null ? db.JoursFermes.Where(j => j.JfeTypeElement == null)
            : db.JoursFermes.Where(j => j.JfeTypeElement == portee.Type && j.JfeIdElement == portee.Id)).ToListAsync(ct);
        var gardes = s.Regles.Where(r => r.Id is not null).Select(r => r.Id!.Value).ToHashSet();
        foreach (var x in existants.Where(x => !gardes.Contains(x.JfeId)))
        {
            if (x.JfeCode is not null) x.JfeActif = false; else db.JoursFermes.Remove(x);
        }
        foreach (var r in s.Regles)
        {
            var x = r.Id is int id ? existants.FirstOrDefault(e => e.JfeId == id) ?? throw ExceptionMetier.Introuvable($"Jour fermé {id}") : new JourFermeEntite();
            if (r.Id is null) { x.JfeTypeElement = portee?.Type; x.JfeIdElement = portee?.Id; db.JoursFermes.Add(x); }
            x.JfeLibelle = r.Libelle.Trim();
            x.JfeRegle = r.Regle;
            (x.JfeDate, x.JfeMois, x.JfeJour, x.JfeRang, x.JfeDecalage, x.JfeDu, x.JfeAu) = (r.Date, r.Mois, r.Jour, r.Rang, r.Decalage, r.Du, r.Au);
            x.JfeActif = r.Actif;
            x.JfeMajPar = u.Code;
            x.JfeMajLe = DateTimeOffset.UtcNow;
        }
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await JoursFermesAsync(portee, ct);
    }
}

/// <summary>Spécialisation par l'application : utilisations d'un calendrier (services, ressources) pour refuser sa suppression.</summary>
public abstract class SpecialisationCalendrier
{
    public virtual Task<int> UtilisationsAsync(CalendrierDbContext db, int calendrier, CancellationToken ct) => Task.FromResult(0);
}
