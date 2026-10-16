using LogiBTP.Socle;

namespace LogiBTP.Documents;

/// <summary>Ligne d'une condition de paiement : % du montant, délai en jours, base NET / FIN_MOIS / JOUR, jour, mode.</summary>
public sealed record LigneCondition(decimal Pct, int Delai, string Base, int? Jour, string? Mode);

/// <summary>Échéance calculée : rang, date (nulle pour une retenue), montant, mode, nature NORMALE / RETENUE.</summary>
public sealed record EcheanceCalculee(int Rang, DateOnly? Date, decimal Montant, string? Mode, string Nature);

/// <summary>
/// Échéancier d'une pièce (echeances.js côté client, jeu modules/document/tests/echeances/01_echeances.json) : base NET
/// (date + délai), FIN_MOIS (puis fin du mois), JOUR (puis le prochain jour donné, le dernier du mois s'il est plus
/// court) ; pourcentages arrondis, la dernière échéance prend le reste ; sans ligne, comptant ; retenue : échéance
/// RETENUE sans date.
/// </summary>
public static class Echeances
{
    public static DateOnly DateEcheance(DateOnly date, LigneCondition l)
    {
        var d = date.AddDays(l.Delai);
        static DateOnly FinDeMois(DateOnly x) => new(x.Year, x.Month, DateTime.DaysInMonth(x.Year, x.Month));
        if (l.Base == "FIN_MOIS") return FinDeMois(d);
        if (l.Base == "JOUR")
        {
            var jour = l.Jour ?? 1;
            DateOnly Dans(int annee, int mois) => new(annee, mois, Math.Min(jour, DateTime.DaysInMonth(annee, mois)));
            var e = Dans(d.Year, d.Month);
            if (e < d)
            {
                var suivant = d.AddMonths(1);
                e = Dans(suivant.Year, suivant.Month);
            }
            return e;
        }
        return d;
    }

    public static List<EcheanceCalculee> Calculer(DateOnly date, decimal montant, IReadOnlyList<LigneCondition> lignes, decimal retenue, string? mode, int precision = 2)
    {
        var conditions = lignes.Count > 0 ? lignes : [new LigneCondition(100, 0, "NET", null, null)];
        var reste = montant;
        var res = new List<EcheanceCalculee>();
        for (var i = 0; i < conditions.Count; i++)
        {
            var l = conditions[i];
            var m = i == conditions.Count - 1 ? reste : ArrondiCalcul.Arrondir(montant * l.Pct / 100, precision);
            reste -= m;
            res.Add(new EcheanceCalculee(i + 1, DateEcheance(date, l), m, l.Mode ?? mode, "NORMALE"));
        }
        if (retenue != 0) res.Add(new EcheanceCalculee(res.Count + 1, null, retenue, mode, "RETENUE"));
        return res;
    }
}
