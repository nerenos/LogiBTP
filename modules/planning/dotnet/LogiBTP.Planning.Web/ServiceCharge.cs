using System.Globalization;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Planning.Web;

public class ParametrePlanningEntite
{
    public short PplId { get; set; } = 1;
    public short PplSousOccupation { get; set; } = 40;
    public short PplHorizonCreneau { get; set; } = 60;
}

public class NotificationEntite
{
    public string PnoCle { get; set; } = "";
    public string PnoEtat { get; set; } = "VUE";
    public string PnoPar { get; set; } = "";
    public DateTimeOffset PnoLe { get; set; } = DateTimeOffset.UtcNow;
}

public sealed record EtatNotification(List<string> Cles, string Etat);

/// <summary>Notification calculée du planning (non stockée ; son état l'est par sa clé).</summary>
public sealed record NotificationPlanning(string Cle, string Type, string Niveau, string Message, long? Tache = null, string? Ressource = null, string? Date = null,
    string? Action = null, int? Equipe = null, string? Etat = null);

/// <summary>
/// Charge et contrôles du planning (lot 4) : capacité, planifié et disponible par service et par jour
/// (<see cref="ReglesCharge"/>), notifications calculées (sur-occupation d'une ressource, sous-occupation d'un service,
/// stock de matériel dépassé, habilitation manquante, composition d'équipe modifiée), recalcul d'une tâche à la
/// composition actuelle de l'équipe, premier créneau libre d'une ressource ou d'un service.
/// </summary>
public sealed class ServiceCharge(PlanningDbContext db, SpecialisationPlanning specialisation, ServicePlanning planning, ServiceLiens liens)
{
    private sealed record Donnees(List<RessourcePlanning> Ressources, List<TacheEntite> Taches, List<AffectationEntite> Affectations, Charge Charge, List<string> Jours);

    private static DateTime Lire(string s) => Temps.DateHeureDe(Temps.VersMinutes(s));

    private async Task<Donnees> DonneesAsync(string? vue, string du, string au, CancellationToken ct)
    {
        var d = await planning.DefinitionAsync(vue, ct);
        var debut = Lire(du);
        var fin = Lire(au);
        var services = await planning.ServicesDeAsync(d.Services, ct);
        var taches = await db.Taches.AsNoTracking().Where(t => t.TacDebut < fin && t.TacFin > debut).ToListAsync(ct);
        var ids = taches.Select(t => t.TacId).ToList();
        var affectations = await db.Affectations.AsNoTracking().Where(a => ids.Contains(a.AffTacId)).ToListAsync(ct);
        var ressources = await specialisation.RessourcesAsync(db, new FiltreRessources(services, null, null), ct);
        var cles = ressources.Select(r => r.Cle).ToHashSet();
        var manquantes = affectations.Select(a => $"{a.AffResType}:{a.AffResId}").Where(c => !cles.Contains(c)).Distinct().ToList();
        if (manquantes.Count > 0) ressources.AddRange(await specialisation.RessourcesAsync(db, new FiltreRessources(null, null, null, manquantes), ct));
        var du0 = Temps.DateDe(Temps.VersMinutes(debut));
        var au0 = Temps.DateDe(Temps.VersMinutes(fin) - 1);
        var plages = await specialisation.PlagesAsync(db, ressources, du0, au0, ct);
        var plagesServices = new Dictionary<int, List<(long, long)>>();
        foreach (var s in taches.Select(t => t.TacSrvId ?? 0).Distinct()) plagesServices[s] = await specialisation.PlagesServiceAsync(db, s == 0 ? null : s, du0, au0, ct);
        var absences = taches.Where(t => t.TacTypeElement == "absence").SelectMany(t => affectations.Where(a => a.AffTacId == t.TacId)
            .Select(a => new AbsenceCalcul($"{a.AffResType}:{a.AffResId}", Temps.VersMinutes(t.TacDebut), Temps.VersMinutes(t.TacFin)))).ToList();
        var jours = Enumerable.Range(0, au0.DayNumber - du0.DayNumber + 1).Select(i => du0.AddDays(i).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)).ToList();
        var charge = ReglesCharge.Calculer(jours,
            ressources.Select(r => new RessourceCharge(r.Cle, r.SrvId, plages.GetValueOrDefault(r.Cle) ?? [], r.Capacite, r.Quantite)).ToList(), absences,
            taches.Where(t => t.TacTypeElement != "absence").Select(t => new TacheCharge(t.TacId.ToString(CultureInfo.InvariantCulture), t.TacSrvId, Temps.VersMinutes(t.TacDebut),
                Temps.VersMinutes(t.TacFin), t.TacHeures, affectations.Where(a => a.AffTacId == t.TacId).Select(a => new AffectationCharge($"{a.AffResType}:{a.AffResId}", a.AffQuantite)).ToList(),
                plagesServices.GetValueOrDefault(t.TacSrvId ?? 0))).ToList());
        return new Donnees(ressources, taches, affectations, charge, jours);
    }

    /// <summary>Capacité, planifié et disponible par service et par jour, unités des matériels.</summary>
    public async Task<object> ChargeAsync(string? vue, string du, string au, CancellationToken ct)
    {
        var d = await DonneesAsync(vue, du, au, ct);
        return new { services = d.Charge.Services, materiels = d.Charge.Materiels };
    }

    private static string Heures(int m) => $"{m / 60}:{m % 60:00}";
    private static string Jour(string d) => $"{d[8..10]}/{d[5..7]}";

    /// <summary>Notifications de la période (calculées), avec leur état (vue) ; les traitées sont retirées.</summary>
    public async Task<List<NotificationPlanning>> NotificationsAsync(string? vue, string du, string au, CancellationToken ct)
    {
        var d = await DonneesAsync(vue, du, au, ct);
        var p = await db.Parametres.AsNoTracking().FirstOrDefaultAsync(ct) ?? new ParametrePlanningEntite();
        var lib = d.Ressources.GroupBy(r => r.Cle).ToDictionary(g => g.Key, g => g.First().Libelle);
        var libTache = d.Taches.ToDictionary(t => t.TacId, t => t.TacLibelle);
        var services = (await specialisation.ServicesAsync(db, ct)).ToDictionary(s => s.Id, s => s.Libelle);
        var r = new List<NotificationPlanning>();
        foreach (var s in d.Charge.Surcharges)
        {
            r.Add(new($"SUROCCUPATION:{s.Ressource}:{s.Date}", "SUROCCUPATION", "URGENT",
                $"{lib.GetValueOrDefault(s.Ressource) ?? s.Ressource} : {Heures(s.Planifie)} h planifiées pour {Heures(s.Capacite)} h le {Jour(s.Date)} ({string.Join(", ", s.Taches.Select(t => libTache.GetValueOrDefault(long.Parse(t, CultureInfo.InvariantCulture)) ?? t))})",
                long.Parse(s.Taches[0], CultureInfo.InvariantCulture), s.Ressource, s.Date));
        }
        foreach (var c in d.Charge.Services.Where(c => c.SrvId is not null && c.Capacite > 0 && c.Disponible * 100 > c.Capacite * p.PplSousOccupation))
        {
            r.Add(new($"SOUSOCCUPATION:{c.SrvId}:{c.Date}", "SOUSOCCUPATION", "INFO",
                $"{services.GetValueOrDefault(c.SrvId!.Value)} : {Heures(c.Disponible)} h disponibles sur {Heures(c.Capacite)} h le {Jour(c.Date)}", null, null, c.Date));
        }
        foreach (var m in d.Charge.Materiels.Where(m => m.Stock is decimal s && m.Utilise > s))
        {
            r.Add(new($"MATERIEL:{m.Ressource}:{m.Date}", "MATERIEL", "ATTENTION",
                $"{lib.GetValueOrDefault(m.Ressource) ?? m.Ressource} : {m.Utilise} unités utilisées pour {m.Stock} disponibles le {Jour(m.Date)}", null, m.Ressource, m.Date));
        }
        // Habilitations exigées par une tâche (P19) : chaque ressource affectée doit les détenir, valides au début de la tâche.
        foreach (var t in d.Taches.Where(t => t.TacHabilitations.Length > 0))
        {
            var affs = d.Affectations.Where(a => a.AffTacId == t.TacId).Select(a => $"{a.AffResType}:{a.AffResId}").ToList();
            var valides = await specialisation.HabilitationsAsync(db, affs, DateOnly.FromDateTime(t.TacDebut), ct);
            foreach (var res in affs)
            {
                var manque = t.TacHabilitations.Where(h => !(valides.GetValueOrDefault(res)?.Contains(h) ?? false)).ToList();
                if (manque.Count > 0)
                {
                    r.Add(new($"HABILITATION:{t.TacId}:{res}", "HABILITATION", "URGENT",
                        $"{lib.GetValueOrDefault(res) ?? res} n'a pas d'habilitation valable ({string.Join(", ", manque)}) pour « {t.TacLibelle} »", t.TacId, res));
                }
            }
        }
        // Équipes (P7) : la tâche garde la copie de la composition ; une composition différente à la date est signalée.
        foreach (var g in d.Affectations.Where(a => a.AffEquipeId is not null).GroupBy(a => (a.AffTacId, a.AffEquipeId!.Value)))
        {
            var t = d.Taches.First(x => x.TacId == g.Key.AffTacId);
            var membres = (await specialisation.MembresAsync(db, g.Key.Value, DateOnly.FromDateTime(t.TacDebut), ct)).Select(m => $"{m.Type}:{m.Id}").ToHashSet();
            var copie = g.Select(a => $"{a.AffResType}:{a.AffResId}").ToHashSet();
            if (!membres.SetEquals(copie))
            {
                r.Add(new($"EQUIPE:{t.TacId}:{g.Key.Value}:{string.Join(",", membres.Order())}", "EQUIPE", "ATTENTION",
                    $"« {t.TacLibelle} » : la composition de l'équipe a changé ({membres.Except(copie).Count()} entrée(s), {copie.Except(membres).Count()} sortie(s))",
                    t.TacId, null, null, "APPLIQUER_EQUIPE", g.Key.Value));
            }
        }
        // Dépendances en alerte violées, tâches liées hors de leur principale (lot 5).
        foreach (var a in await liens.AlertesAsync(d.Taches, ct))
        {
            if (a.Code == "DEP_VIOLEE")
            {
                var de = long.Parse(a.De!, CultureInfo.InvariantCulture);
                var vers = long.Parse(a.Vers!, CultureInfo.InvariantCulture);
                r.Add(new($"DEPENDANCE:{a.De}:{a.Vers}", "DEPENDANCE", "ATTENTION",
                    $"« {libTache.GetValueOrDefault(vers)} » démarre avant le {Temps.Ecrire(a.Minimum!.Value).Replace('T', ' ')} (dépendance de « {libTache.GetValueOrDefault(de)} »)", vers));
            }
            else
            {
                var t = long.Parse(a.Tache!, CultureInfo.InvariantCulture);
                r.Add(new($"LIEE:{a.Tache}", "LIEE", "ATTENTION", $"« {libTache.GetValueOrDefault(t)} » sort de la période de sa tâche principale", t));
            }
        }
        var etats = await db.Notifications.AsNoTracking().Where(n => r.Select(x => x.Cle).Contains(n.PnoCle)).ToDictionaryAsync(n => n.PnoCle, n => n.PnoEtat, ct);
        return r.Where(n => etats.GetValueOrDefault(n.Cle) != "TRAITEE").Select(n => n with { Etat = etats.GetValueOrDefault(n.Cle) }).ToList();
    }

    public async Task MarquerAsync(EtatNotification e, Utilisateur u, CancellationToken ct)
    {
        if (e.Etat is not ("VUE" or "TRAITEE" or "") || e.Cles.Any(string.IsNullOrWhiteSpace)) throw ExceptionMetier.Invalide("PLA_NOTIFICATION", "État ou notification inconnus");
        await db.Notifications.Where(n => e.Cles.Contains(n.PnoCle)).ExecuteDeleteAsync(ct);
        if (e.Etat != "") db.Notifications.AddRange(e.Cles.Distinct().Select(c => new NotificationEntite { PnoCle = c, PnoEtat = e.Etat, PnoPar = u.Code }));
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Remplace les membres d'une équipe dans une tâche par sa composition au début de la tâche, puis recalcule.</summary>
    public async Task<object> AppliquerEquipeAsync(long id, int equipe, int version, Utilisateur u, CancellationToken ct)
    {
        var s = await planning.SaisieAsync(id, ct);
        var autres = (s.Affectations ?? []).Where(a => a.EquipeId != equipe).ToList();
        autres.Add(new AffectationSaisie("EQUIPE", equipe.ToString(CultureInfo.InvariantCulture)));
        return await planning.ModifierAsync(id, s with { Affectations = autres, Fin = s.Calcul == 1 ? null : s.Fin, Heures = s.Calcul == 2 ? null : s.Heures, Version = version }, u, ct);
    }

    /// <summary>
    /// Premier créneau libre (§ 6) : pour une ressource, première plage libre (plages moins ses tâches) à partir de
    /// `apres`, fin calculée comme une tâche en mode 1 sur ces plages libres ; pour un service, la ressource à capacité
    /// habilitée (codes demandés) dont le créneau commence le plus tôt (100 ressources au plus).
    /// </summary>
    public async Task<object?> CreneauAsync(string? ressource, int? service, int heures, string apres, string? habilitations, CancellationToken ct)
    {
        if (heures <= 0) throw ExceptionMetier.Invalide("PLA_HEURES", "Nombre d'heures invalide");
        var p = await db.Parametres.AsNoTracking().FirstOrDefaultAsync(ct) ?? new ParametrePlanningEntite();
        var debut = Temps.VersMinutes(apres);
        var du = Temps.DateDe(debut);
        var au = du.AddDays(p.PplHorizonCreneau);
        var codes = habilitations?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries) ?? [];
        var candidats = ressource is not null
            ? await specialisation.RessourcesAsync(db, new FiltreRessources(null, null, null, [ressource]), ct)
            : (await specialisation.RessourcesAsync(db, new FiltreRessources(service is int s ? [s] : null, ["SALARIE", "INTERIM"], null), ct)).Take(100).ToList();
        if (codes.Length > 0)
        {
            var valides = await specialisation.HabilitationsAsync(db, candidats.Select(c => c.Cle).ToList(), du, ct);
            candidats = candidats.Where(c => codes.All(h => valides.GetValueOrDefault(c.Cle)?.Contains(h) ?? false)).ToList();
        }
        if (candidats.Count == 0) return null;
        var plages = await specialisation.PlagesAsync(db, candidats, du, au, ct);
        var finDt = Temps.DateHeureDe(Temps.VersMinutes(au.AddDays(1)));
        var debutDt = Temps.DateHeureDe(debut);
        var occupations = await (from a in db.Affectations
                                 join t in db.Taches on a.AffTacId equals t.TacId
                                 where t.TacFin > debutDt && t.TacDebut < finDt
                                 select new { Cle = a.AffResType + ":" + a.AffResId, t.TacDebut, t.TacFin }).AsNoTracking().ToListAsync(ct);
        object? meilleur = null;
        long meilleurDebut = long.MaxValue;
        foreach (var c in candidats)
        {
            var libres = ReglesPlanning.RetirerAbsences(plages.GetValueOrDefault(c.Cle) ?? [],
                occupations.Where(o => o.Cle == c.Cle).Select(o => (Temps.VersMinutes(o.TacDebut), Temps.VersMinutes(o.TacFin))));
            var premiere = libres.Where(x => x.Fin > debut).Select(x => Math.Max(x.Debut, debut)).DefaultIfEmpty(long.MaxValue).Min();
            if (premiere >= meilleurDebut) continue;
            var calcul = ReglesPlanning.Calculer(new TacheCalcul(1, premiere, null, heures, [new RessourceCalcul(c.Cle, libres)]));
            if (calcul.Fin is not long fin) continue;
            meilleurDebut = premiere;
            meilleur = new { ressource = c.Cle, libelle = c.Libelle, debut = Temps.Ecrire(premiere), fin = Temps.Ecrire(fin) };
        }
        return meilleur;
    }

    public async Task<object> ParametresAsync(CancellationToken ct) =>
        await db.Parametres.AsNoTracking().FirstOrDefaultAsync(ct) is { } p ? new { sous_occupation = p.PplSousOccupation, horizon_creneau = p.PplHorizonCreneau } : new { sous_occupation = (short)40, horizon_creneau = (short)60 };
}
