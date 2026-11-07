namespace LogiBTP.Bibliotheque;

/// <summary>
/// Règle du premier tarif d'un élément (réplique de <c>reglePremierTarif</c> de calcul.js) : le premier tarif saisi devient
/// principal ; un élément sans PA saisi (scénario FIXE, PA fixe nul ou zéro) passe au scénario FOURNISSEUR_PRINCIPAL.
/// </summary>
public static class PremierTarif
{
    /// <param name="autresTarifs">Nombre de tarifs déjà présents pour l'élément (hors celui qu'on enregistre).</param>
    public static (bool Principal, string Scenario) Appliquer(int autresTarifs, bool principalDemande, string? scenario, decimal? paFixe)
    {
        if (autresTarifs > 0) return (principalDemande, scenario ?? ScenarioPa.Fixe);
        scenario ??= ScenarioPa.Fixe;
        var sansPa = scenario == ScenarioPa.Fixe && (paFixe is null || paFixe == 0);
        return (true, sansPa ? ScenarioPa.FournisseurPrincipal : scenario);
    }
}
