namespace LogiBTP.FactureElectronique.Web.Connecteurs;

/// <summary>
/// Connecteur vers la plateforme simulée de la société (<see cref="PlateformeSimulee"/>) : mêmes contrôles et mêmes
/// résultats qu'une PA XP Z12-013, sans réseau (démonstration, recette de la file et de la relève).
/// </summary>
public sealed class ConnecteurSimule(PlateformeSimulee plateforme) : ConnecteurPlateforme
{
    public override string Code => ConnecteurFe.Simule;
    public PlateformeSimulee Plateforme { get; } = plateforme;

    protected override Task<FluxDepose> DeposerFluxAsync(FluxPrepare flux, CancellationToken ct) =>
        Task.FromResult(Plateforme.Deposer(flux.Flux, flux.Empreinte));

    protected override Task<PageFlux> RechercherFluxAsync(CriteresFlux criteres, string? curseur, int limite, CancellationToken ct) =>
        Task.FromResult(Plateforme.Rechercher(criteres, curseur, limite));

    protected override Task<Flux> LireFluxAsync(string idFlux, CancellationToken ct) => Task.FromResult(Plateforme.Lire(idFlux));

    protected override Task<FichierFlux> TelechargerFluxAsync(string idFlux, string typeDocument, CancellationToken ct) =>
        Task.FromResult(Plateforme.Telecharger(idFlux, typeDocument));

    protected override Task VerifierSanteAsync(CancellationToken ct) => Task.CompletedTask;

    protected override Task<UniteLegale> LireUniteLegaleAsync(string siren, CancellationToken ct) => Task.FromResult(Plateforme.Annuaire.UniteLegale(siren));
    protected override Task<Etablissement> LireEtablissementAsync(string siret, CancellationToken ct) => Task.FromResult(Plateforme.Annuaire.Etablissement(siret));
    protected override Task<CodeRoutage> LireCodeRoutageAsync(string siret, string identifiant, CancellationToken ct) =>
        Task.FromResult(Plateforme.Annuaire.CodeRoutage(siret, identifiant));
    protected override Task<LigneAnnuaire> LireLigneAnnuaireAsync(string identifiant, CancellationToken ct) => Task.FromResult(Plateforme.Annuaire.Ligne(identifiant));
    protected override Task<ResultatsAnnuaire<UniteLegale>> ChercherUnitesLegalesAsync(RechercheAnnuaire r, CancellationToken ct) =>
        Task.FromResult(Plateforme.Annuaire.RechercherUnitesLegales(r));
    protected override Task<ResultatsAnnuaire<Etablissement>> ChercherEtablissementsAsync(RechercheAnnuaire r, CancellationToken ct) =>
        Task.FromResult(Plateforme.Annuaire.RechercherEtablissements(r));
    protected override Task<ResultatsAnnuaire<CodeRoutage>> ChercherCodesRoutageAsync(RechercheAnnuaire r, CancellationToken ct) =>
        Task.FromResult(Plateforme.Annuaire.RechercherCodesRoutage(r));
    protected override Task<ResultatsAnnuaire<LigneAnnuaire>> ChercherLignesAnnuaireAsync(RechercheAnnuaire r, CancellationToken ct) =>
        Task.FromResult(Plateforme.Annuaire.RechercherLignes(r));
}
