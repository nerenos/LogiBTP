namespace LogiBTP.Rentabilite;

/// <summary>Saisie prévisionnelle telle qu'envoyée par l'interface (montants vides = 0 ; PR vide = PA).</summary>
public sealed record SaisiePrevision(string Indicateur, string? Composante, DateOnly Date, long? OrdreId, int? NatId, decimal? Pa, decimal? Pr, decimal? Pv,
    string? Libelle, string? Motif, int? TiersId, DateOnly? Echeance, string? PieceAttendue, int? Version);

/// <summary>Erreur de saisie d'une prévision : code (<see cref="ErreurPrevision"/>) et champ en cause.</summary>
public sealed record ErreurSaisiePrevision(string Code, string Champ, string Message);

/// <summary>
/// Règles des saisies prévisionnelles (ANALYSE-MODULE-ANALYSE.md § 10.1, lot 6) : indicateurs prévus et leur fait
/// PREVU_* (jamais mélangé au réel), composante par défaut, montants retenus selon l'indicateur (le facturé n'a que du
/// PV, l'engagé et le déboursé que des coûts), contrôle de la saisie, état (ouverte, échue, soldée).
/// </summary>
public static class Previsions
{
    /// <summary>Indicateur réel → indicateur du fait prévu.</summary>
    public static readonly IReadOnlyDictionary<string, string> IndicateursPrevus = new Dictionary<string, string>
    {
        [Indicateur.Budget] = Indicateur.PrevuBudget,
        [Indicateur.BudgetExecution] = Indicateur.PrevuExecution,
        [Indicateur.Engage] = Indicateur.PrevuEngage,
        [Indicateur.Debourse] = Indicateur.PrevuDebourse,
        [Indicateur.Facture] = Indicateur.PrevuFacture,
    };

    /// <summary>Règle portée par le fait d'une saisie (page des faits).</summary>
    public const string Regle = "PREVISION";

    /// <summary>Composantes des coûts prévus (engagé, déboursé) ; budget et facturé : vente.</summary>
    public static readonly IReadOnlySet<string> ComposantesCout = new HashSet<string>
        { Composante.Achat, Composante.SousTraitance, Composante.Mo, Composante.Materiel, Composante.Stock };

    /// <summary>Indicateur de coût seul (engagé, déboursé) : aucun PV.</summary>
    public static bool CoutSeul(string indicateur) => indicateur is Indicateur.Engage or Indicateur.Debourse;

    /// <summary>Indicateur de vente seule (facturé) : aucun coût.</summary>
    public static bool VenteSeule(string indicateur) => indicateur == Indicateur.Facture;

    /// <summary>Composante retenue : vente pour budget, budget d'exécution et facturé ; saisie (achat par défaut) pour un coût.</summary>
    public static string ComposanteDe(string indicateur, string? saisie) =>
        CoutSeul(indicateur) ? (string.IsNullOrWhiteSpace(saisie) ? Composante.Achat : saisie) : Composante.Vente;

    /// <summary>Montants retenus (PA, PR, PV) : PR vide = PA ; coûts mis à zéro pour le facturé, PV pour l'engagé et le déboursé.</summary>
    public static (decimal Pa, decimal Pr, decimal Pv) Montants(SaisiePrevision s)
    {
        var pa = s.Pa ?? 0;
        var pr = s.Pr ?? pa;
        var pv = s.Pv ?? 0;
        if (VenteSeule(s.Indicateur)) return (0, 0, pv);
        if (CoutSeul(s.Indicateur)) return (pa, pr, 0);
        return (pa, pr, pv);
    }

    /// <summary>Contrôle d'une saisie : indicateur, composante d'un coût, libellé, au moins un montant non nul.</summary>
    public static List<ErreurSaisiePrevision> Controler(SaisiePrevision s)
    {
        var erreurs = new List<ErreurSaisiePrevision>();
        if (!IndicateursPrevus.ContainsKey(s.Indicateur))
        {
            erreurs.Add(new(ErreurPrevision.Indicateur, "indicateur", "Indicateur prévu inconnu"));
            return erreurs;
        }
        if (CoutSeul(s.Indicateur) && !ComposantesCout.Contains(ComposanteDe(s.Indicateur, s.Composante)))
            erreurs.Add(new(ErreurPrevision.Composante, "composante", "Composante d'un coût inconnue"));
        if (string.IsNullOrWhiteSpace(s.Libelle)) erreurs.Add(new(ErreurPrevision.Libelle, "libelle", "Libellé obligatoire"));
        var (pa, pr, pv) = Montants(s);
        if (pa == 0 && pr == 0 && pv == 0) erreurs.Add(new(ErreurPrevision.Montant, "montant", "Montant nul"));
        return erreurs;
    }

    /// <summary>État d'une saisie à une date : soldée, échue (échéance avant aujourd'hui), sinon ouverte.</summary>
    public static string Etat(DateOnly? soldeeLe, DateOnly? echeance, DateOnly aujourdhui) =>
        soldeeLe is not null ? EtatPrevision.Soldee : echeance is { } e && e < aujourdhui ? EtatPrevision.Echue : EtatPrevision.Ouverte;

    /// <summary>Fait d'une saisie ouverte ou échue (une saisie soldée n'en a plus).</summary>
    public static Fait Fait(int chantier, long id, SaisiePrevision s)
    {
        var (pa, pr, pv) = Montants(s);
        return new Fait(chantier, s.OrdreId, null, IndicateursPrevus[s.Indicateur], ComposanteDe(s.Indicateur, s.Composante), s.Date, s.NatId, null, null,
            pa, pr, pv, null, SourceFait.Prevision, null, null, null, id, Regle, s.Libelle?.Trim());
    }
}
