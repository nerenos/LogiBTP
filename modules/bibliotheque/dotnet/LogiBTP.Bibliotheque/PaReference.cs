using System.Globalization;
using LogiBTP.Socle;

namespace LogiBTP.Bibliotheque;

/// <summary>PA de référence d'un élément (par unité de stock) et son origine (<see cref="SourcePaReference"/>).</summary>
public sealed record ReferencePa(decimal? Pa, string Source, long? TarifId, List<string> Alertes);

/// <summary>Tarif à écrire par un plan de mise à jour (Id nul : tarif à créer pour le fournisseur, début à la date du plan).</summary>
public sealed record TarifPlan(long? Id, long? TiersId, string Unite, decimal Prix, decimal? PrixPublic, decimal? Remise1, decimal? Remise2, string? Debut);

/// <summary>Plan de mise à jour de la bibliothèque (<see cref="ActionMajPa"/>, motif si aucune écriture).</summary>
public sealed record PlanMajPa(string Action, string? Motif, decimal? PaFixe, TarifPlan? Tarif);

/// <summary>
/// PA de référence d'un élément et plan de mise à jour de la bibliothèque : même règle que paReference et planMiseAJourPa
/// (calcul.js, jeu partagé modules/bibliotheque/tests/cas/04_mise_a_jour_pa.json). Avec un fournisseur, le PA de référence
/// est le tarif de l'article pour ce fournisseur s'il existe, sinon le PA effectif ; la mise à jour écrit ce seul tarif, ou
/// crée un tarif pour le fournisseur quand le PA vient du tarif d'un autre ; sans fournisseur : scénario FIXE → PA de
/// l'élément, FOURNISSEUR_PRINCIPAL → son tarif, scénarios calculés → aucune écriture (motif).
/// </summary>
public static class PaReference
{
    private static decimal Arr6(decimal v) => ArrondiCalcul.Arr6(v);

    /// <summary>Tarif de l'élément pour un fournisseur de l'annuaire en vigueur à la date : principal d'abord, puis début le plus récent.</summary>
    public static TarifCalcul? TarifDuFournisseur(EntreeElement e, long? tiersId, string date)
    {
        if (tiersId is null) return null;
        return e.Tarifs.Where(t => t.TiersId == tiersId && CalculElement.EnVigueur(t, date))
            .OrderByDescending(t => t.Principal)
            .ThenByDescending(t => string.IsNullOrEmpty(t.Debut) ? "" : t.Debut[..10], StringComparer.Ordinal)
            .FirstOrDefault();
    }

    public static ReferencePa Calculer(EntreeElement e, string? date = null, long? tiersId = null)
    {
        date ??= DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var t = TarifDuFournisseur(e, tiersId, date);
        if (t is not null)
        {
            try { return new ReferencePa(Arr6(CalculElement.PrixNetTarif(t) / CalculElement.Ratio(t.Unite, e)), SourcePaReference.TarifFournisseur, t.Id, []); }
            catch (ErreurCalcul x)
            {
                var (paSecours, alertesSecours) = CalculElement.PrixAchat(e, date);
                return new ReferencePa(paSecours, SourcePaReference.PaEffectif, null, [x.Code, .. alertesSecours]);
            }
        }
        var (pa, alertes) = CalculElement.PrixAchat(e, date);
        return new ReferencePa(pa, SourcePaReference.PaEffectif, null, alertes);
    }

    private static PlanMajPa Sans(string motif) => new(ActionMajPa.Aucune, motif, null, null);

    /// <summary>Tarif existant ramené à un nouveau prix net (par unité du tarif) : prix public recalculé, remises conservées.</summary>
    private static TarifPlan Recalcule(TarifCalcul t, decimal pa, EntreeElement e)
    {
        var net = Arr6(pa * CalculElement.Ratio(t.Unite, e));
        decimal? prixPublic = null, remise1 = null, remise2 = null;
        var prix = net;
        if (t.PrixPublic is not null)
        {
            var facteur = (1 - (t.Remise1 ?? 0) / 100) * (1 - (t.Remise2 ?? 0) / 100);
            if (facteur > 0)
            {
                prixPublic = Arr6(net / facteur);
                remise1 = t.Remise1;
                remise2 = t.Remise2;
                prix = CalculElement.PrixNetTarif(new TarifCalcul { Prix = net, PrixPublic = prixPublic, Remise1 = remise1, Remise2 = remise2 });
            }
        }
        return new TarifPlan(t.Id, t.TiersId, t.Unite, prix, prixPublic, remise1, remise2, null);
    }

    public static PlanMajPa Planifier(EntreeElement e, decimal? nouveauPa, string? date = null, long? tiersId = null)
    {
        date ??= DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        if (nouveauPa is not { } pa || pa < 0) return Sans(MotifMajPa.PaInvalide);
        var scenario = e.Scenario ?? ScenarioPa.Fixe;
        var parTarif = scenario is ScenarioPa.FournisseurPrincipal or ScenarioPa.MeilleurMin or ScenarioPa.MeilleurMax;
        try
        {
            if (TarifDuFournisseur(e, tiersId, date) is { } duFournisseur)
                return new PlanMajPa(ActionMajPa.Tarif, null, null, Recalcule(duFournisseur, pa, e));
            if (tiersId is not null && parTarif)
                return new PlanMajPa(ActionMajPa.NouveauTarif, null, null, new TarifPlan(null, tiersId, e.UniteStock, Arr6(pa), null, null, null, date));
            switch (scenario)
            {
                case ScenarioPa.Fixe: return new PlanMajPa(ActionMajPa.PaFixe, null, Arr6(pa), null);
                case ScenarioPa.FournisseurPrincipal:
                    var principal = e.Tarifs.Where(t => CalculElement.EnVigueur(t, date)).FirstOrDefault(t => t.Principal);
                    return principal is null ? Sans(MotifMajPa.TarifPrincipalAbsent) : new PlanMajPa(ActionMajPa.Tarif, null, null, Recalcule(principal, pa, e));
                default: return Sans(MotifMajPa.ScenarioCalcule);
            }
        }
        catch (ErreurCalcul) { return Sans(MotifMajPa.UniteTarif); }
    }
}
