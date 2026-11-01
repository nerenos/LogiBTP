namespace LogiBTP.Reglements;

/// <summary>État d'une échéance : reste (montant − pointé) et réglée (|reste| ≤ seuil).</summary>
public sealed record EtatEcheance(decimal Reste, bool Reglee);

/// <summary>État d'une pièce : montant, pointé, reste, statut REGLEE / PARTIELLE / A_REGLER.</summary>
public sealed record EtatPiece(decimal Montant, decimal Pointe, decimal Reste, string Statut);

/// <summary>Échéance ouverte proposée au pointage : identifiant, date (nulle : en dernier), reste.</summary>
public sealed record EcheanceAPointer(long Id, DateOnly? Date, decimal Reste);

/// <summary>Pointage proposé : échéance et montant.</summary>
public sealed record PointagePropose(long Id, decimal Montant);

/// <summary>Caution de retenue de garantie : objet (marché ; null = toutes les retenues du tiers), date, montant, mainlevée.</summary>
public sealed record CautionRetenue(long Id, long? Objet, DateOnly? Date, decimal Montant, DateOnly? Mainlevee);

/// <summary>Retenue de garantie à couvrir : objet (marché), date de la pièce, montant.</summary>
public sealed record RetenueACouvrir(long Id, long? Objet, DateOnly? DatePiece, decimal Montant);

/// <summary>Part d'une caution affectée à une retenue.</summary>
public sealed record AllocationCaution(long Caution, long Retenue, decimal Montant);

/// <summary>Retenue après consommation des cautions : part cautionnée (exigible avec la pièce) et part retenue.</summary>
public sealed record RetenueCouverte(long Id, decimal Cautionne, decimal Retenu);

/// <summary>Caution après consommation : consommé et disponible.</summary>
public sealed record CautionConsommee(long Id, decimal Consomme, decimal Disponible);

/// <summary>Consommation des cautions : affectations, retenues et cautions dans l'ordre d'entrée.</summary>
public sealed record ConsommationCautions(List<AllocationCaution> Allocations, List<RetenueCouverte> Retenues, List<CautionConsommee> Cautions);

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

    /// <summary>
    /// Montant imputable au plus (avoir ou trop-perçu sur une échéance à régler) : plus petit de |disponible| et du reste
    /// de l'échéance ; 0 si l'un est nul ou si l'échéance n'est pas à régler.
    /// </summary>
    public static decimal MaximumImputation(decimal disponible, decimal reste) =>
        reste <= 0 || disponible == 0 ? 0 : Math.Min(Math.Abs(disponible), reste);

    /// <summary>
    /// Cautions de retenue de garantie (consommerCautions de reste.js, jeu 02_cautions.json ; décision du 31/10/2026) :
    /// la part cautionnée n'est pas retenue (exigible avec la pièce) ; les cautions se consomment des pièces les plus
    /// anciennes aux plus récentes (date de la pièce, sans date en dernier, puis identifiant), cautions de l'objet avant
    /// celles sans objet, puis par date et identifiant ; une caution levée ne couvre plus les pièces datées de sa
    /// mainlevée ou après ; une retenue nulle ou négative n'est pas couverte.
    /// </summary>
    public static ConsommationCautions ConsommerCautions(IReadOnlyList<CautionRetenue> cautions, IReadOnlyList<RetenueACouvrir> retenues)
    {
        var dispo = cautions.ToDictionary(c => c.Id, c => c.Montant);
        var ordreCautions = cautions.OrderBy(c => c.Objet is null ? 1 : 0).ThenBy(c => c.Date ?? DateOnly.MaxValue).ThenBy(c => c.Id).ToList();
        var allocations = new List<AllocationCaution>();
        var couvert = new Dictionary<long, decimal>();
        foreach (var r in retenues.OrderBy(r => r.DatePiece ?? DateOnly.MaxValue).ThenBy(r => r.Id))
        {
            var reste = r.Montant;
            if (reste <= 0) continue;
            foreach (var c in ordreCautions)
            {
                if (reste <= 0) break;
                if (c.Objet is long o && o != r.Objet) continue;
                if (c.Mainlevee is DateOnly levee && (r.DatePiece is not DateOnly dp || dp >= levee)) continue;
                var d = dispo[c.Id];
                if (d <= 0) continue;
                var m = Math.Min(d, reste);
                allocations.Add(new AllocationCaution(c.Id, r.Id, m));
                dispo[c.Id] = d - m;
                couvert[r.Id] = couvert.GetValueOrDefault(r.Id) + m;
                reste -= m;
            }
        }
        return new ConsommationCautions(
            allocations,
            [.. retenues.Select(r => new RetenueCouverte(r.Id, couvert.GetValueOrDefault(r.Id), r.Montant > 0 ? r.Montant - couvert.GetValueOrDefault(r.Id) : r.Montant))],
            [.. cautions.Select(c => new CautionConsommee(c.Id, c.Montant - dispo[c.Id], dispo[c.Id]))]);
    }

    /// <summary>Part cautionnée d'une retenue restant à pointer : cautionné − pointé, entre 0 et le reste (exigibleCaution).</summary>
    public static decimal ExigibleCaution(decimal cautionne, decimal pointe, decimal reste)
    {
        var e = cautionne - pointe;
        return e <= 0 || reste <= 0 ? 0 : Math.Min(e, reste);
    }
}
