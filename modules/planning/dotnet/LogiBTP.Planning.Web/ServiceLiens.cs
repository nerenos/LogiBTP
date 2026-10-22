using System.Globalization;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Planning.Web;

public class DependanceEntite
{
    public long DepId { get; set; }
    public long DepDe { get; set; }
    public long DepVers { get; set; }
    public string DepType { get; set; } = "FD";
    public short DepDecalage { get; set; }
    public string DepUnite { get; set; } = "CAL";
    public string DepMode { get; set; } = "FIXE";
}

public class JalonEntite
{
    public long JalId { get; set; }
    public DateTime JalQuand { get; set; }
    public string JalType { get; set; } = "AUTRE";
    public string JalLibelle { get; set; } = "";
    public string? JalTypeElement { get; set; }
    public string? JalIdElement { get; set; }
    public int? JalSrvId { get; set; }
    public string JalCreePar { get; set; } = "";
    public DateTimeOffset JalCreeLe { get; set; } = DateTimeOffset.UtcNow;
}

public sealed record DependanceSaisie(long De, string Type, int Decalage, string Unite, string Mode);
public sealed record RepetitionSaisie(string Frequence, int Nombre);
public sealed record JalonSaisi(string Quand, string Type, string Libelle, string? TypeElement, string? IdElement, int? SrvId);
/// <summary>Jalon calculé par l'application (fin de chantier, fin d'ordre, alerte du CRM…).</summary>
public sealed record JalonPlanning(string Cle, string Quand, string Type, string Libelle, string? TypeElement, string? IdElement, int? SrvId, string Source);

/// <summary>
/// Liens du planning (lot 5) : dépendances d'une tâche (contrôle de tout le graphe, propagation FIXE en cascade vers
/// les tâches suivantes : <see cref="ReglesDependances"/>), tâches liées (parent), tâches répétitives (série), jalons
/// saisis ou fournis par l'application.
/// </summary>
public sealed class ServiceLiens(PlanningDbContext db, SpecialisationPlanning specialisation, ServicePlanning planning)
{
    private const int MaxPropagation = 200;

    private static Dependance Regle(DependanceEntite d) =>
        new(d.DepDe.ToString(CultureInfo.InvariantCulture), d.DepVers.ToString(CultureInfo.InvariantCulture), d.DepType, d.DepDecalage, d.DepUnite, d.DepMode);

    public async Task<object> DependancesAsync(long id, CancellationToken ct)
    {
        var deps = await db.Dependances.AsNoTracking().Where(d => d.DepDe == id || d.DepVers == id).ToListAsync(ct);
        var ids = deps.SelectMany(d => new[] { d.DepDe, d.DepVers }).Distinct().ToList();
        var lib = await db.Taches.AsNoTracking().Where(t => ids.Contains(t.TacId)).ToDictionaryAsync(t => t.TacId, t => t.TacLibelle, ct);
        object Ligne(DependanceEntite d, long autre) => new { de = d.DepDe, vers = d.DepVers, tache = autre, libelle = lib.GetValueOrDefault(autre), type = d.DepType, decalage = d.DepDecalage, unite = d.DepUnite, mode = d.DepMode };
        return new
        {
            predecesseurs = deps.Where(d => d.DepVers == id).Select(d => Ligne(d, d.DepDe)),
            successeurs = deps.Where(d => d.DepDe == id).Select(d => Ligne(d, d.DepVers)),
        };
    }

    /// <summary>Remplace les dépendances entrantes d'une tâche ; graphe entier contrôlé (cycle, doublon), puis propagation.</summary>
    public async Task<object> EnregistrerDependancesAsync(long id, List<DependanceSaisie> l, Utilisateur u, CancellationToken ct)
    {
        if (!await db.Taches.AnyAsync(t => t.TacId == id, ct)) throw ExceptionMetier.Introuvable($"Tâche {id}");
        var autres = await db.Dependances.AsNoTracking().Where(d => d.DepVers != id).ToListAsync(ct);
        var nouvelles = l.Select(s => new DependanceEntite { DepDe = s.De, DepVers = id, DepType = s.Type, DepDecalage = (short)s.Decalage, DepUnite = s.Unite, DepMode = s.Mode }).ToList();
        var erreurs = ReglesDependances.Controler(autres.Concat(nouvelles).Select(Regle).ToList());
        if (erreurs.Count > 0) throw ExceptionMetier.Invalide(erreurs[0], string.Join(" · ", erreurs.Select(e => ReglesDependances.Messages[e])), erreurs);
        var ids = nouvelles.Select(d => d.DepDe).Distinct().ToList();
        if (await db.Taches.CountAsync(t => ids.Contains(t.TacId), ct) != ids.Count) throw ExceptionMetier.Invalide("DEP_TACHE", "Tâche précédente inconnue");
        await db.Dependances.Where(d => d.DepVers == id).ExecuteDeleteAsync(ct);
        db.Dependances.AddRange(nouvelles);
        await db.SaveChangesAsync(ct);
        await PropagerAsync(id, u, ct);
        return await DependancesAsync(id, ct);
    }

    /// <summary>Jours ouvrés (dates ayant des plages) du calendrier d'un service, sur une période.</summary>
    private async Task<List<string>> JoursOuvresAsync(int? service, DateOnly du, DateOnly au, CancellationToken ct) =>
        (await specialisation.PlagesServiceAsync(db, service, du, au, ct)).Select(p => Temps.DateDe(p.Debut).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)).Distinct().ToList();

    /// <summary>
    /// Propagation des dépendances FIXE à partir d'une tâche : la tâche puis ses suivantes (ordre topologique) sont
    /// ramenées au plus tôt permis par leurs précédentes, comme un déplacement (mode 1 : fin recalculée par le calendrier),
    /// 200 tâches au plus.
    /// </summary>
    public async Task PropagerAsync(long depart, Utilisateur u, CancellationToken ct)
    {
        var deps = await db.Dependances.AsNoTracking().ToListAsync(ct);
        if (deps.Count == 0) return;
        var atteintes = new HashSet<long> { depart };
        var file = new Queue<long>([depart]);
        while (file.Count > 0 && atteintes.Count < MaxPropagation)
        {
            foreach (var d in deps.Where(d => d.DepDe == file.Peek())) if (atteintes.Add(d.DepVers)) file.Enqueue(d.DepVers);
            file.Dequeue();
        }
        var ordre = ReglesDependances.OrdreTopologique(deps.Select(Regle).ToList()) ?? [];
        foreach (var cle in ordre)
        {
            var n = long.Parse(cle, CultureInfo.InvariantCulture);
            if (!atteintes.Contains(n)) continue;
            var entrantes = deps.Where(d => d.DepVers == n && d.DepMode == "FIXE").ToList();
            if (entrantes.Count == 0) continue;
            var t = await db.Taches.AsNoTracking().FirstOrDefaultAsync(x => x.TacId == n, ct);
            if (t is null) continue;
            long? min = null;
            foreach (var d in entrantes)
            {
                var de = await db.Taches.AsNoTracking().FirstOrDefaultAsync(x => x.TacId == d.DepDe, ct);
                if (de is null) continue;
                var base0 = Temps.DateDe(Temps.VersMinutes(d.DepType == "DD" ? de.TacDebut : de.TacFin));
                var ouvres = d.DepUnite == "OUV" ? await JoursOuvresAsync(t.TacSrvId, base0, base0.AddDays(d.DepDecalage * 3 + 31), ct) : [];
                var m = ReglesDependances.DebutMinimum(Regle(d), Temps.VersMinutes(de.TacDebut), Temps.VersMinutes(de.TacFin), ouvres);
                if (m is long v && (min is null || v > min)) min = v;
            }
            if (min is not long debut || debut == Temps.VersMinutes(t.TacDebut)) continue;
            var duree = Temps.VersMinutes(t.TacFin) - Temps.VersMinutes(t.TacDebut);
            await planning.DeplacerAsync(n, new DeplacementSaisi(Temps.Ecrire(debut), Temps.Ecrire(debut + duree), "deplacer", null, null, false, t.TacVersion), u, ct);
        }
    }

    /// <summary>Alertes des dépendances ALERTE et des tâches liées sur un ensemble de tâches (calendrier par défaut pour les jours ouvrés).</summary>
    public async Task<List<AlerteDependance>> AlertesAsync(IReadOnlyCollection<TacheEntite> taches, CancellationToken ct)
    {
        var ids = taches.Select(t => t.TacId).ToList();
        var deps = await db.Dependances.AsNoTracking().Where(d => ids.Contains(d.DepDe) && ids.Contains(d.DepVers)).ToListAsync(ct);
        if (deps.Count == 0 && taches.All(t => t.TacParentId is null)) return [];
        var parents = taches.Where(t => t.TacParentId is long p && !ids.Contains(p)).Select(t => t.TacParentId!.Value).Distinct().ToList();
        var toutes = taches.Concat(await db.Taches.AsNoTracking().Where(t => parents.Contains(t.TacId)).ToListAsync(ct)).ToList();
        var du = Temps.DateDe(toutes.Min(t => Temps.VersMinutes(t.TacDebut)));
        var au = Temps.DateDe(toutes.Max(t => Temps.VersMinutes(t.TacFin))).AddDays(60);
        var ouvres = deps.Any(d => d.DepUnite == "OUV") ? await JoursOuvresAsync(null, du, au, ct) : [];
        return ReglesDependances.Propager(
            toutes.Select(t => new TacheDatee(t.TacId.ToString(CultureInfo.InvariantCulture), Temps.VersMinutes(t.TacDebut), Temps.VersMinutes(t.TacFin), t.TacParentId?.ToString(CultureInfo.InvariantCulture))).ToList(),
            deps.Where(d => d.DepMode == "ALERTE").Select(Regle).ToList(), ouvres).Alertes;
    }

    /// <summary>Répète une tâche (jour, semaine, mois ; 52 fois au plus) : copies de même saisie décalées, même série.</summary>
    public async Task<object> RepeterAsync(long id, RepetitionSaisie r, Utilisateur u, CancellationToken ct)
    {
        if (r.Nombre is < 1 or > 52 || r.Frequence is not ("JOUR" or "SEMAINE" or "MOIS")) throw ExceptionMetier.Invalide("PLA_REPETITION", "Fréquence inconnue ou nombre hors de 1 à 52");
        var t = await db.Taches.FirstOrDefaultAsync(x => x.TacId == id, ct) ?? throw ExceptionMetier.Introuvable($"Tâche {id}");
        t.TacSerie ??= Guid.NewGuid();
        await db.SaveChangesAsync(ct);
        var s = await planning.SaisieAsync(id, ct);
        var debut = Temps.DateHeureDe(Temps.VersMinutes(s.Debut));
        var fin = Temps.DateHeureDe(Temps.VersMinutes(s.Fin!));
        var creees = new List<long>();
        for (var k = 1; k <= r.Nombre; k++)
        {
            DateTime Decaler(DateTime d) => r.Frequence switch { "JOUR" => d.AddDays(k), "SEMAINE" => d.AddDays(7 * k), _ => d.AddMonths(k) };
            var copie = s with
            {
                Debut = Temps.Ecrire(Temps.VersMinutes(Decaler(debut))), Fin = s.Calcul == 1 ? null : Temps.Ecrire(Temps.VersMinutes(Decaler(fin))),
                Heures = s.Calcul == 2 ? null : s.Heures, Version = null, Serie = t.TacSerie,
            };
            creees.Add(await planning.CreerIdAsync(copie, u, ct));
        }
        return new { serie = t.TacSerie, taches = creees };
    }

    /// <summary>Supprime une série de tâches répétitives à partir d'une date (toutes sans date).</summary>
    public async Task<object> SupprimerSerieAsync(Guid serie, string? depuis, CancellationToken ct)
    {
        var q = db.Taches.Where(t => t.TacSerie == serie);
        if (depuis is not null)
        {
            var d = Temps.DateHeureDe(Temps.VersMinutes(depuis));
            q = q.Where(t => t.TacDebut >= d);
        }
        return new { supprimees = await q.ExecuteDeleteAsync(ct) };
    }

    public async Task<List<JalonPlanning>> JalonsAsync(string du, string au, CancellationToken ct)
    {
        var d = Temps.DateHeureDe(Temps.VersMinutes(du));
        var f = Temps.DateHeureDe(Temps.VersMinutes(au));
        var saisis = await db.Jalons.AsNoTracking().Where(j => j.JalQuand >= d && j.JalQuand < f).OrderBy(j => j.JalQuand).ToListAsync(ct);
        var calcules = await specialisation.JalonsAsync(db, Temps.DateDe(Temps.VersMinutes(du)), Temps.DateDe(Temps.VersMinutes(au)), ct);
        return saisis.Select(j => new JalonPlanning($"jalon:{j.JalId}", Temps.Ecrire(Temps.VersMinutes(j.JalQuand)), j.JalType, j.JalLibelle, j.JalTypeElement, j.JalIdElement, j.JalSrvId, "SAISI"))
            .Concat(calcules).OrderBy(j => j.Quand, StringComparer.Ordinal).ToList();
    }

    public async Task<object> CreerJalonAsync(JalonSaisi s, Utilisateur u, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(s.Libelle)) throw ExceptionMetier.Invalide("PLA_JALON", "Libellé du jalon obligatoire");
        var j = new JalonEntite
        {
            JalQuand = Temps.DateHeureDe(Temps.VersMinutes(s.Quand)), JalType = s.Type, JalLibelle = s.Libelle.Trim(), JalTypeElement = s.TypeElement, JalIdElement = s.IdElement,
            JalSrvId = s.SrvId, JalCreePar = u.Code,
        };
        db.Jalons.Add(j);
        await db.SaveChangesAsync(ct);
        return new { id = j.JalId };
    }

    public async Task SupprimerJalonAsync(long id, CancellationToken ct) => await db.Jalons.Where(j => j.JalId == id).ExecuteDeleteAsync(ct);
}
