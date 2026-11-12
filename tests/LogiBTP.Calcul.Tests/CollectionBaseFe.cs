using LogiBTP.Socle.Testing;
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Collection des tests de la facturation électronique sur la base jetable (réception, émission, rejet, Encaissée,
/// e-reporting) : ils partagent fe_parametre, la file fe_flux, les curseurs de relève et la plateforme simulée en base.
/// Exécutée seule (sans parallélisme avec les autres collections de l'assemblage) et sous le verrou consultatif
/// <see cref="VerrouBaseTests.FactureElectronique"/>, pris aussi par <c>ServiceFactureElectroniqueTests</c> du module
/// (autre processus de <c>dotnet test LogiBTP.slnx</c>) : sans lui, une relève ou un passage de la file d'une suite
/// traitait les flux de l'autre (doublon <c>ux_fe_flux_id_flux</c>, flux ACQUITTE au lieu d'ENVOYE).
/// </summary>
[CollectionDefinition(EnvoiFactureBtpTests.CollectionBase, DisableParallelization = true)]
public sealed class CollectionBaseFe : ICollectionFixture<VerrouBaseFe>;

/// <summary>Verrou consultatif tenu pendant toute la collection (variable LOGIBTP_TEST_PG_JETABLE, sinon LOGIBTP_TEST_PG ; aucune : rien).</summary>
public sealed class VerrouBaseFe : IAsyncLifetime
{
    private VerrouBaseTests? verrou;

    public async Task InitializeAsync()
    {
        var connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG_JETABLE") is { Length: > 0 } j ? j
            : Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");
        verrou = await VerrouBaseTests.PrendreAsync(string.IsNullOrEmpty(connexion) ? null : new NpgsqlConnection(connexion), VerrouBaseTests.FactureElectronique);
    }

    public async Task DisposeAsync()
    {
        if (verrou is not null) await verrou.DisposeAsync();
    }
}
