using System.Globalization;
using System.Text.Json;
using LogiBTP.Planning;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Planning.Web;

/// <summary>Composition d'une équipe appliquée à une tâche (copie : date de la composition, membres « TYPE:id »).</summary>
public sealed record CompositionEquipe(string Date, List<string> Membres);

/// <summary>Membre d'une équipe à une date (aperçu avant l'ajout à une tâche).</summary>
public sealed record MembreEquipe(string Type, string Id, string Cle, string Libelle);

/// <summary>Changement de composition d'une équipe pendant une tâche : première date où elle diffère de la copie.</summary>
public sealed record ChangementEquipe(DateOnly Date, List<string> Membres, List<string> Entrees, List<string> Sorties);

/// <summary>Occupation d'une ressource par une autre tâche (disponibilités : information seulement).</summary>
public sealed record OccupationRessource(long Tache, string Libelle, string Debut, string Fin, bool Absence);

/// <summary>Disponibilité d'une ressource sur une période : minutes travaillables, occupées par d'autres tâches, état.</summary>
public sealed record DisponibiliteRessource(string Cle, string Type, string Id, string Libelle, int? SrvId, string? Service, bool Capacite,
    long Travail, long Occupe, string Etat, List<OccupationRessource> Occupations);

/// <summary>
/// Ressources des tâches : copies des compositions d'équipes (une tâche garde la composition appliquée ; des membres
/// peuvent en être retirés sans toucher à l'équipe), changements de composition pendant la tâche, membres à une date,
/// disponibilités des ressources sur une période.
/// </summary>
public static class RessourcesTache
{
    public static Dictionary<int, CompositionEquipe> LireEquipes(TacheEntite t)
    {
        try
        {
            return (JsonSerializer.Deserialize<Dictionary<string, CompositionEquipe>>(t.TacEquipes, JsonSerializerOptions.Web) ?? [])
                .Where(x => int.TryParse(x.Key, CultureInfo.InvariantCulture, out _)).ToDictionary(x => int.Parse(x.Key, CultureInfo.InvariantCulture), x => x.Value);
        }
        catch (JsonException) { return []; }
    }

    public static string EcrireEquipes(Dictionary<int, CompositionEquipe> e) =>
        JsonSerializer.Serialize(e.OrderBy(x => x.Key).ToDictionary(x => x.Key.ToString(CultureInfo.InvariantCulture), x => x.Value), JsonSerializerOptions.Web);

    /// <summary>
    /// Copies des compositions après une saisie : celles de la saisie (sinon celles de la tâche), une équipe ajoutée en
    /// bloc (affectation EQUIPE) prend sa composition au début de la tâche ; une équipe sans plus aucun membre affecté
    /// n'est plus suivie ; les anciennes tâches sans copie prennent leurs membres affectés.
    /// </summary>
    public static async Task<Dictionary<int, CompositionEquipe>> CopiesAsync(PlanningDbContext db, SpecialisationPlanning specialisation, TacheEntite t,
        TacheSaisie s, IReadOnlyCollection<AffectationSaisie> developpees, DateOnly debut, CancellationToken ct)
    {
        var r = s.Equipes is not null
            ? s.Equipes.Where(x => int.TryParse(x.Key, CultureInfo.InvariantCulture, out _)).ToDictionary(x => int.Parse(x.Key, CultureInfo.InvariantCulture), x => x.Value)
            : LireEquipes(t);
        foreach (var a in (s.Affectations ?? []).Where(a => a.Type == "EQUIPE"))
        {
            var e = int.Parse(a.Id, CultureInfo.InvariantCulture);
            r[e] = new(debut.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), (await specialisation.MembresAsync(db, e, debut, ct)).Select(m => $"{m.Type}:{m.Id}").ToList());
        }
        var suivies = developpees.Where(a => a.EquipeId is not null).GroupBy(a => a.EquipeId!.Value).ToDictionary(g => g.Key, g => g.Select(a => $"{a.Type}:{a.Id}").ToList());
        foreach (var e in r.Keys.Where(e => !suivies.ContainsKey(e)).ToList()) r.Remove(e);
        foreach (var (e, membres) in suivies.Where(x => !r.ContainsKey(x.Key))) r[e] = new(debut.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), membres);
        return r;
    }

    /// <summary>Première date de la tâche (son début puis chaque changement de l'équipe) où la composition diffère de la copie.</summary>
    public static async Task<ChangementEquipe?> ChangementAsync(PlanningDbContext db, SpecialisationPlanning specialisation, TacheEntite t, int equipe,
        CompositionEquipe copie, CancellationToken ct)
    {
        var du = DateOnly.FromDateTime(t.TacDebut);
        var au = DateOnly.FromDateTime(t.TacFin.AddMinutes(-1));
        var dates = new List<DateOnly> { du };
        dates.AddRange((await specialisation.ChangementsEquipeAsync(db, equipe, du, au, ct)).Where(d => d > du && d <= au).Distinct().Order());
        var avant = copie.Membres.ToHashSet();
        foreach (var d in dates)
        {
            var membres = (await specialisation.MembresAsync(db, equipe, d, ct)).Select(m => $"{m.Type}:{m.Id}").ToList();
            if (!membres.ToHashSet().SetEquals(avant)) return new(d, membres, membres.Except(avant).ToList(), avant.Except(membres).ToList());
        }
        return null;
    }

    /// <summary>
    /// Nouvelle composition d'une équipe dans la tâche : les membres restants de l'ancienne copie sont retirés, ceux de
    /// la nouvelle ajoutés sauf s'ils sont déjà affectés (ajout manuel ou autre équipe : pas de doublon).
    /// </summary>
    public static (List<AffectationSaisie> Affectations, Dictionary<string, CompositionEquipe> Equipes) Appliquer(TacheSaisie s, int equipe, DateOnly date,
        IReadOnlyCollection<string> membres)
    {
        var affs = (s.Affectations ?? []).Where(a => a.EquipeId != equipe).ToList();
        var deja = affs.Select(a => $"{a.Type}:{a.Id}").ToHashSet();
        foreach (var m in membres.Where(m => !deja.Contains(m)))
        {
            var i = m.IndexOf(':', StringComparison.Ordinal);
            affs.Add(new AffectationSaisie(m[..i], m[(i + 1)..], equipe));
        }
        var equipes = new Dictionary<string, CompositionEquipe>(s.Equipes ?? []) { [equipe.ToString(CultureInfo.InvariantCulture)] = new(date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), [.. membres]) };
        return (affs, equipes);
    }

    /// <summary>Membres d'une équipe à une date, avec leurs libellés.</summary>
    public static async Task<List<MembreEquipe>> MembresAsync(PlanningDbContext db, SpecialisationPlanning specialisation, int equipe, DateOnly date, CancellationToken ct)
    {
        var membres = await specialisation.MembresAsync(db, equipe, date, ct);
        var lib = (await specialisation.RessourcesAsync(db, new FiltreRessources(null, null, null, membres.Select(m => $"{m.Type}:{m.Id}").ToList()), ct)).ToDictionary(r => r.Cle, r => r.Libelle);
        return membres.Select(m => new MembreEquipe(m.Type, m.Id, $"{m.Type}:{m.Id}", lib.GetValueOrDefault($"{m.Type}:{m.Id}") ?? $"{m.Type} {m.Id}")).ToList();
    }

    /// <summary>
    /// Disponibilités sur [debut, fin[ (information, jamais bloquant) : minutes travaillables (plages), minutes occupées
    /// par d'autres tâches sur ces plages, tâches en cause ; état LIBRE, PARTIEL, OCCUPE, ABSENT (absence sur la
    /// période), HORS (aucune plage : hors calendrier), SANS (ressource sans capacité).
    /// </summary>
    public static async Task<List<DisponibiliteRessource>> DisponibilitesAsync(PlanningDbContext db, SpecialisationPlanning specialisation, long debut, long fin,
        long? exclure, FiltreRessources filtre, CancellationToken ct)
    {
        var ressources = (await specialisation.RessourcesAsync(db, filtre, ct)).Take(1000).ToList();
        var du = Temps.DateDe(debut);
        var au = Temps.DateDe(Math.Max(debut, fin - 1));
        var plages = await specialisation.PlagesAsync(db, ressources.Where(r => r.Capacite).ToList(), du, au, ct);
        var debutDt = Temps.DateHeureDe(debut);
        var finDt = Temps.DateHeureDe(fin);
        var cles = ressources.Select(r => r.Cle).ToHashSet();
        var occupations = (await (from a in db.Affectations
                                  join t in db.Taches on a.AffTacId equals t.TacId
                                  where t.TacFin > debutDt && t.TacDebut < finDt && t.TacId != (exclure ?? 0)
                                  select new { Cle = a.AffResType + ":" + a.AffResId, t.TacId, t.TacLibelle, t.TacDebut, t.TacFin, t.TacTypeElement })
                                 .AsNoTracking().ToListAsync(ct)).Where(o => cles.Contains(o.Cle)).ToLookup(o => o.Cle);
        return ressources.Select(r =>
        {
            var occ = occupations[r.Cle].OrderBy(o => o.TacDebut).ToList();
            var p = (plages.GetValueOrDefault(r.Cle) ?? []).Select(x => (Math.Max(x.Debut, debut), Math.Min(x.Fin, fin))).Where(x => x.Item1 < x.Item2).ToList();
            var travail = p.Sum(x => x.Item2 - x.Item1);
            var libre = ReglesPlanning.RetirerAbsences(p, occ.Select(o => (Temps.VersMinutes(o.TacDebut), Temps.VersMinutes(o.TacFin)))).Sum(x => x.Fin - x.Debut);
            var occupe = travail - libre;
            var etat = !r.Capacite ? (occ.Count > 0 ? "OCCUPE" : "SANS")
                : occ.Any(o => o.TacTypeElement == "absence") ? "ABSENT"
                : travail == 0 ? "HORS" : occupe == 0 ? "LIBRE" : libre == 0 ? "OCCUPE" : "PARTIEL";
            return new DisponibiliteRessource(r.Cle, r.Type, r.Id, r.Libelle, r.SrvId, r.Service, r.Capacite, travail, occupe, etat,
                occ.Select(o => new OccupationRessource(o.TacId, o.TacLibelle, Temps.Ecrire(Temps.VersMinutes(o.TacDebut)), Temps.Ecrire(Temps.VersMinutes(o.TacFin)), o.TacTypeElement == "absence")).ToList());
        }).ToList();
    }
}
