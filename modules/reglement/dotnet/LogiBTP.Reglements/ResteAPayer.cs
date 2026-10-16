namespace LogiBTP.Reglements;

/// <summary>État d'une échéance : reste (montant − pointé) et réglée (|reste| ≤ seuil).</summary>
public sealed record EtatEcheance(decimal Reste, bool Reglee);

/// <summary>État d'une pièce : montant, pointé, reste, statut REGLEE / PARTIELLE / A_REGLER.</summary>
public sealed record EtatPiece(decimal Montant, decimal Pointe, decimal Reste, string Statut);

/// <summary>Échéance ouverte proposée au pointage : identifiant, date (nulle : en dernier), reste.</summary>
public sealed record EcheanceAPointer(long Id, DateOnly? Date, decimal Reste);

/// <summary>Pointage proposé : échéance et montant.</summary>
public sealed record PointagePropose(long Id, decimal Montant);

/// <summary>
/// Reste à payer et pointage (reste.js côté client, jeu modules/reglement/tests/cas/01_reste.json) : reste d'une
/// échéance et d'une pièce, non pointé d'un règlement, proposition de pointage (plus ancienne d'abord, même signe).
/// </summary>
public static class ResteAPayer
{
    public static EtatEcheance Echeance(decimal montant, decimal pointe, decimal seuil = 0)
    {
        var reste = montant - pointe;
        return new EtatEcheance(reste, Math.Abs(reste) <= seuil);
    }

    public static EtatPiece Piece(IEnumerable<(decimal Montant, decimal Pointe)> echeances, decimal seuil = 0)
    {
        var liste = echeances.ToList();
        var montant = liste.Sum(e => e.Montant);
        var pointe = liste.Sum(e => e.Pointe);
        var reste = montant - pointe;
        var statut = Math.Abs(reste) <= seuil ? "REGLEE" : pointe == 0 ? "A_REGLER" : "PARTIELLE";
        return new EtatPiece(montant, pointe, reste, statut);
    }

    public static decimal NonPointe(decimal montant, IEnumerable<decimal> pointages) => montant - pointages.Sum();

    public static List<PointagePropose> Proposer(decimal disponible, IEnumerable<EcheanceAPointer> echeances)
    {
        var reste = disponible;
        var signe = reste < 0 ? -1 : 1;
        var res = new List<PointagePropose>();
        foreach (var e in echeances.Where(e => e.Reste * signe > 0).OrderBy(e => e.Date ?? DateOnly.MaxValue).ThenBy(e => e.Id))
        {
            if (reste * signe <= 0) break;
            var m = Math.Abs(e.Reste) < Math.Abs(reste) ? e.Reste : reste;
            res.Add(new PointagePropose(e.Id, m));
            reste -= m;
        }
        return res;
    }
}
