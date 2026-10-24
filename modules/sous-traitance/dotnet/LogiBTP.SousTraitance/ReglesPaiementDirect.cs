namespace LogiBTP.SousTraitance;

public sealed record DelaiAcceptation(DateOnly Echeance, bool Depasse, bool Alerte);
public sealed record Acceptation(string Etat, decimal Cumul, decimal? ResteAgree, List<string> Erreurs);

/// <summary>
/// Paiement direct d'un sous-traitant, répliqué dans paiement-direct.js (jeu modules/sous-traitance/tests/cas/03_plafonds.json) :
/// montant payé par le maître d'ouvrage, délai d'acceptation de 15 jours (alerte à J-3), acceptation plafonnée par le
/// montant agréé, refus total ou partiel motivé.
/// </summary>
public static class ReglesPaiementDirect
{
    public const int DelaiJours = 15;
    public static readonly string[] Etats = ["RECUE", "ACCEPTEE", "PARTIELLE", "REFUSEE", "TRANSMISE", "PAYEE"];

    public static string Message(string code) => code switch
    {
        "PD_PLAFOND" => "Le cumul accepté dépasse le montant agréé du sous-traitant",
        "PD_DEMANDE" => "Le montant accepté dépasse la demande du sous-traitant",
        "PD_MOTIF" => "Motif obligatoire pour refuser tout ou partie de la demande",
        "PD_NEGATIF" => "Montant accepté négatif",
        _ => code,
    };

    public static decimal Montant(decimal ht, decimal ttc, bool autoliquidation) => autoliquidation ? ht : ttc;

    public static DelaiAcceptation Delai(DateOnly recueLe, DateOnly aujourdhui)
    {
        var echeance = recueLe.AddDays(DelaiJours);
        return new(echeance, aujourdhui > echeance, aujourdhui >= echeance.AddDays(-3));
    }

    public static Acceptation Controler(decimal demande, decimal accepte, decimal cumulPrecedent, decimal? montantAgree, string? motif)
    {
        var erreurs = new List<string>();
        if (accepte < 0) erreurs.Add("PD_NEGATIF");
        if (accepte > demande) erreurs.Add("PD_DEMANDE");
        var cumul = cumulPrecedent + accepte;
        if (montantAgree is decimal a && cumul > a) erreurs.Add("PD_PLAFOND");
        var etat = accepte == 0 ? "REFUSEE" : accepte < demande ? "PARTIELLE" : "ACCEPTEE";
        if (etat != "ACCEPTEE" && string.IsNullOrWhiteSpace(motif)) erreurs.Add("PD_MOTIF");
        return new(etat, cumul, montantAgree is decimal m ? Math.Max(0, m - cumul) : null, erreurs);
    }
}
