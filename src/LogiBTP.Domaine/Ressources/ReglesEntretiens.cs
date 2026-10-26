namespace LogiBTP.Domaine.Ressources;

/// <summary>Plan d'entretien : code, libellé, périodicités (heures, kilomètres, mois), actif (inactif = retiré du niveau précédent).</summary>
public sealed record PlanEntretien(string Code, string? Libelle, decimal? Heures, decimal? Km, int? Mois, bool Actif = true, int? Id = null, string? Origine = null);

/// <summary>Point de compteurs à une date (valeurs cumulées ; nulles si l'unité n'est pas relevée).</summary>
public sealed record PointCompteurs(DateOnly? Date, decimal? H, decimal? Km);

/// <summary>Critère d'une échéance : H, KM ou MOIS ; échéance (valeur ou date ISO), reste (valeur ou jours), date estimée.</summary>
public sealed record CritereEcheance(string Critere, object Echeance, decimal Reste, DateOnly? Date);

/// <summary>Échéance d'un plan : critères, date la plus proche, état (EN_RETARD, A_PREVOIR, OK, INCONNU).</summary>
public sealed record EcheanceEntretien(List<CritereEcheance> Criteres, DateOnly? Date, string Etat);

/// <summary>
/// Plans et échéances d'entretien du matériel (lot 5c-4 des demandes du 25/10/2026), répliqués dans
/// client/src/app/ressources/entretiens.js (jeu tests/ressources/06_entretiens.json) : plans effectifs (type parent,
/// type, matériel : même code remplacé, inactif retiré ; M6), compteur cumulé à une date, usage moyen par jour, échéance
/// d'un plan (le premier critère atteint déclenche) et état.
/// </summary>
public static class ReglesEntretiens
{
    public const int Seuil = 30;
    public const int JoursMoyenne = 90;

    public static List<PlanEntretien> PlansEffectifs(IEnumerable<IEnumerable<PlanEntretien>> listes)
    {
        var r = new List<PlanEntretien>();
        foreach (var liste in listes)
        {
            foreach (var p in liste)
            {
                var i = r.FindIndex(x => x.Code == p.Code);
                if (!p.Actif) { if (i >= 0) r.RemoveAt(i); }
                else if (i >= 0) r[i] = p;
                else r.Add(p);
            }
        }
        return r;
    }

    /// <summary>Compteur cumulé d'une unité à une date, null sans relevé.</summary>
    public static decimal? CumulA(IReadOnlyList<ReleveCompteur> releves, string unite, DateOnly date) =>
        ReglesCompteurs.Cumuls(releves, unite).Where(p => p.Date <= date).Select(p => (decimal?)p.Cumul).LastOrDefault();

    /// <summary>Usage moyen par jour sur les <paramref name="jours"/> précédents ; null sous sept jours d'écart ; 4 décimales.</summary>
    public static decimal? MoyenneUsage(IReadOnlyList<ReleveCompteur> releves, string unite, DateOnly date, int jours = JoursMoyenne)
    {
        var l = ReglesCompteurs.Cumuls(releves, unite).Where(p => p.Date <= date).ToList();
        if (l.Count == 0) return null;
        var debut = date.AddDays(-jours);
        var premier = l.LastOrDefault(p => p.Date <= debut) ?? l[0];
        var dernier = l[^1];
        var ecart = dernier.Date.DayNumber - premier.Date.DayNumber;
        return ecart < 7 ? null : Math.Round((dernier.Cumul - premier.Cumul) / ecart, 4, MidpointRounding.AwayFromZero);
    }

    public static EcheanceEntretien Echeance(PlanEntretien plan, PointCompteurs? reference, PointCompteurs courant,
        decimal? moyenneH = null, decimal? moyenneKm = null, int seuil = Seuil)
    {
        var criteres = new List<CritereEcheance>();
        var aujourdhui = courant.Date!.Value;
        foreach (var (critere, periode, actuel, origine, moyenne) in new[]
                 {
                     ("H", plan.Heures, courant.H, reference?.H, moyenneH),
                     ("KM", plan.Km, courant.Km, reference?.Km, moyenneKm),
                 })
        {
            if (periode is not > 0 || actuel is null) continue;
            var echeance = (origine ?? 0) + periode.Value;
            var reste = echeance - actuel.Value;
            DateOnly? date = reste <= 0 ? aujourdhui : moyenne is > 0 ? aujourdhui.AddDays((int)Math.Ceiling(reste / moyenne.Value)) : null;
            criteres.Add(new(critere, echeance, reste, date));
        }
        if (plan.Mois is > 0 && reference?.Date is { } depuis)
        {
            var echeance = ReglesRessources.AjouterMois(depuis, plan.Mois.Value);
            criteres.Add(new("MOIS", echeance, echeance.DayNumber - aujourdhui.DayNumber, echeance));
        }
        var proche = criteres.Where(c => c.Date is not null).Select(c => c.Date).Min();
        var etat = criteres.Count == 0 ? "INCONNU"
            : criteres.Any(c => c.Reste <= 0) ? "EN_RETARD"
            : proche is { } d && d <= aujourdhui.AddDays(seuil) ? "A_PREVOIR" : "OK";
        return new(criteres, proche, etat);
    }
}
