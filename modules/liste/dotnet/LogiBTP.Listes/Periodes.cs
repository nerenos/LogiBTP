namespace LogiBTP.Listes;

/// <summary>Erreur d'une période (code de ErreursListe).</summary>
public sealed class ErreurPeriode(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

/// <summary>
/// Bornes des périodes glissantes d'un filtre de date, répliquées dans modules/liste/js/src/periodes.js
/// (jeu partagé tests/cas/04_periodes.json). Bornes incluses ; le calcul est pur : la date de référence est fournie.
/// </summary>
public static class Periodes
{
    /// <summary>Bornes [début, fin] d'une période ; <paramref name="debutExercice"/> : seuls son mois et son jour comptent (absent = année civile).</summary>
    public static (DateOnly Debut, DateOnly Fin) Bornes(string code, int? x, DateOnly reference, DateOnly? debutExercice = null)
    {
        var a = reference.Year;
        var m = reference.Month;
        (DateOnly, DateOnly) Jour(DateOnly d) => (d, d);
        (DateOnly, DateOnly) Mois(int aa, int mm) => (new DateOnly(aa, mm, 1), new DateOnly(aa, mm, DateTime.DaysInMonth(aa, mm)));
        (DateOnly, DateOnly) Annee(int aa) => (new DateOnly(aa, 1, 1), new DateOnly(aa, 12, 31));
        var lundi = reference.AddDays(-(((int)reference.DayOfWeek + 6) % 7));

        if (code is PeriodesListe.DerniersJours or PeriodesListe.DerniersMois or PeriodesListe.ProchainsJours && (x is null || x < 1))
            throw new ErreurPeriode(ErreursListe.PeriodeNombre, $"Période {code} : nombre entier supérieur ou égal à 1 attendu");
        switch (code)
        {
            case PeriodesListe.AujourdHui: return Jour(reference);
            case PeriodesListe.Hier: return Jour(reference.AddDays(-1));
            case PeriodesListe.SemaineEnCours: return (lundi, lundi.AddDays(6));
            case PeriodesListe.SemainePrecedente: return (lundi.AddDays(-7), lundi.AddDays(-1));
            case PeriodesListe.MoisEnCours: return Mois(a, m);
            case PeriodesListe.MoisPrecedent:
                var p = new DateOnly(a, m, 1).AddMonths(-1);
                return Mois(p.Year, p.Month);
            case PeriodesListe.TrimestreEnCours:
                var premier = (m - 1) / 3 * 3 + 1;
                return (new DateOnly(a, premier, 1), new DateOnly(a, premier + 2, DateTime.DaysInMonth(a, premier + 2)));
            case PeriodesListe.AnneeEnCours: return Annee(a);
            case PeriodesListe.AnneePrecedente: return Annee(a - 1);
            case PeriodesListe.ExerciceEnCours:
                if (debutExercice is null) return Annee(a);
                var de = debutExercice.Value;
                DateOnly DebutDe(int aa) => new(aa, de.Month, Math.Min(de.Day, DateTime.DaysInMonth(aa, de.Month)));
                var debut = DebutDe(a) > reference ? DebutDe(a - 1) : DebutDe(a);
                return (debut, debut.AddMonths(12).AddDays(-1));
            case PeriodesListe.DerniersJours: return (reference.AddDays(-(x!.Value - 1)), reference);
            case PeriodesListe.DerniersMois: return (reference.AddMonths(-x!.Value).AddDays(1), reference);
            case PeriodesListe.ProchainsJours: return (reference, reference.AddDays(x!.Value - 1));
            default: throw new ErreurPeriode(ErreursListe.PeriodeInconnue, $"Période inconnue : {code}");
        }
    }
}
