namespace LogiBTP.Pointage;

/// <summary>Salarié refusé dans un repas d'équipe, avec le code du refus (ErreursPointage).</summary>
public sealed record RefusRepas(int Salarie, string Code);

/// <summary>Répartition d'un repas d'équipe : salariés à enregistrer, salariés refusés (chacun seul).</summary>
public sealed record RepartitionRepas(List<int> Acceptes, List<RefusRepas> Refus);

/// <summary>
/// Repas déclaré pour plusieurs salariés à la borne (plan restaurants-suites, lot 1) : chaque membre est contrôlé seul.
/// Membre hors de l'équipe de la borne : REPAS_HORS_EQUIPE ; membre déjà déclaré ce jour : REPAS_DEJA (il corrige le sien
/// seul) ; les autres sont enregistrés.
/// </summary>
public static class ReglesRepas
{
    public static RepartitionRepas Repartir(IEnumerable<int> membres, ISet<int> equipe, ISet<int> dejaDeclares)
    {
        var acceptes = new List<int>();
        var refus = new List<RefusRepas>();
        foreach (var m in membres.Distinct())
        {
            if (!equipe.Contains(m)) refus.Add(new RefusRepas(m, ErreursPointage.RepasHorsEquipe));
            else if (dejaDeclares.Contains(m)) refus.Add(new RefusRepas(m, ErreursPointage.RepasDeja));
            else acceptes.Add(m);
        }
        return new RepartitionRepas(acceptes, refus);
    }
}
