namespace LogiBTP.SousTraitance;

public sealed record LiberationRetenue(DateOnly? Echeance, DateOnly? Date, bool Bloquee, string? Motif, bool Liberable);

/// <summary>
/// Libération de la retenue de garantie, répliquée dans retenue.js (jeu modules/sous-traitance/tests/cas/04_retenue.json) :
/// réception + 1 an, réserves non levées = bloquée, réserves levées après l'échéance = libération à leur levée.
/// </summary>
public static class ReglesRetenue
{
    public static LiberationRetenue Calculer(DateOnly? reception, bool reserves, DateOnly? leveesLe, DateOnly aujourdhui)
    {
        if (reception is not DateOnly r) return new(null, null, true, "RET_RECEPTION", false);
        var echeance = r.AddYears(1);
        if (reserves && leveesLe is null) return new(echeance, null, true, "RET_RESERVES", false);
        var date = reserves && leveesLe > echeance ? leveesLe.Value : echeance;
        return new(echeance, date, false, null, aujourdhui >= date);
    }
}
