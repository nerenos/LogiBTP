namespace LogiBTP.Domaine;

/// <summary>Mois civil de facturation des marchés (CONCEPTION-ACHATS-MARCHES.md 13.9, lot E).</summary>
public static class MoisFacturation
{
    /// <summary>Premier jour du mois d'une date.</summary>
    public static DateOnly Debut(DateOnly d) => new(d.Year, d.Month, 1);

    /// <summary>
    /// Date d'une pièce d'avancement créée pour le mois : aujourd'hui pour le mois en cours, le dernier jour du mois pour
    /// un mois passé ; null pour un mois à venir (rien à facturer).
    /// </summary>
    public static DateOnly? DatePiece(DateOnly mois, DateOnly aujourdhui)
    {
        var debut = Debut(mois);
        if (debut > Debut(aujourdhui)) return null;
        return debut == Debut(aujourdhui) ? aujourdhui : debut.AddMonths(1).AddDays(-1);
    }
}
