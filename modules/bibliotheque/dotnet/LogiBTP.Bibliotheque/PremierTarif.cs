namespace LogiBTP.Bibliotheque;

/// <summary>
/// Règle du premier tarif d'un élément (réplique de <c>reglePremierTarif</c> de calcul.js) : le premier tarif saisi devient
/// principal ; un élément sans PA saisi (scénario FIXE, PA fixe nul ou zéro) passe au scénario FOURNISSEUR_PRINCIPAL.
/// </summary>
public static class PremierTarif
{
    public const string ScenarioFixe = "FIXE";
    public const string ScenarioFournisseurPrincipal = "FOURNISSEUR_PRINCIPAL";

    /// <param name="autresTarifs">Nombre de tarifs déjà présents pour l'élément (hors celui qu'on enregistre).</param>
    public static (bool Principal, string Scenario) Appliquer(int autresTarifs, bool principalDemande, string scenario, decimal? paFixe)
    {
        if (autresTarifs > 0) return (principalDemande, scenario);
        var sansPa = scenario == ScenarioFixe && (paFixe is null || paFixe == 0);
        return (true, sansPa ? ScenarioFournisseurPrincipal : scenario);
    }
}
