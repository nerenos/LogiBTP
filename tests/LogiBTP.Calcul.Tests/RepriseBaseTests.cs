using LogiBTP.Api.Reprise;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;
using LogiBTP.Installation;
using LogiBTP.Socle.Testing;
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Reprise MDE / OptimBTP de bout en bout (plan reprise-mde-optim, lot 2) : base LogiBTP neuve montée par le manifeste
/// (sans démonstration), bases sources fictives de tests/reprise. Variables : LOGIBTP_TEST_PG_ADMIN (création de bases),
/// LOGIBTP_TEST_MSSQL, LOGIBTP_TEST_MARIADB ; ignorés sans elles.
/// </summary>
public class RepriseBaseTests
{
    private static readonly string? Admin = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG_ADMIN");

    private static string? Source(string source) => Environment.GetEnvironmentVariable(
        source == SourceReprise.Mde ? "LOGIBTP_TEST_MSSQL" : "LOGIBTP_TEST_MARIADB");

    /// <summary>Base LogiBTP neuve (manifeste sans démonstration), supprimée à la fin.</summary>
    private sealed class BaseNeuve : IAsyncDisposable
    {
        public required string Nom { get; init; }
        public required string Connexion { get; init; }

        public static async Task<BaseNeuve> CreerAsync(string admin)
        {
            var nom = "reprise_" + Guid.NewGuid().ToString("N")[..12];
            await using (var c = new NpgsqlConnection(admin))
            {
                await c.OpenAsync();
                await using var cmd = new NpgsqlCommand($"CREATE DATABASE {nom}", c); // nom généré, jamais saisi
                await cmd.ExecuteNonQueryAsync();
            }
            var chaine = new NpgsqlConnectionStringBuilder(admin) { Database = nom, Pooling = false }.ConnectionString;
            var racine = CasPartages.RacineDepot();
            var manifeste = ManifesteScripts.Lire(racine);
            await new BaseDonnees(TextWriter.Null).AppliquerAsync(chaine, racine, manifeste.Retenus(false), acceptees: EmpreintesAcceptees.Lire(racine));
            return new BaseNeuve { Nom = nom, Connexion = chaine };
        }

        public async Task<long> CompterAsync(string sql)
        {
            await using var c = new NpgsqlConnection(Connexion);
            await c.OpenAsync();
            await using var cmd = new NpgsqlCommand(sql, c);
            return Convert.ToInt64(await cmd.ExecuteScalarAsync());
        }

        public async ValueTask DisposeAsync()
        {
            NpgsqlConnection.ClearAllPools();
            await using var c = new NpgsqlConnection(Admin);
            await c.OpenAsync();
            await using var cmd = new NpgsqlCommand($"DROP DATABASE IF EXISTS {Nom} WITH (FORCE)", c);
            await cmd.ExecuteNonQueryAsync();
        }
    }

    [Fact]
    public async Task Base_neuve_vide_cibles_lues_et_correspondances_par_defaut_valides()
    {
        if (Admin is null) return;
        await using var b = await BaseNeuve.CreerAsync(Admin);
        await using var c = new NpgsqlConnection(b.Connexion);
        await c.OpenAsync();
        Assert.True(await BaseCibleReprise.EstVideAsync(c, null, default));
        var cibles = await CiblesReprise.LireAsync(c, null, default);
        Assert.Contains("A_DEVIS", cibles[CorrespondancesReprise.Listes.TypeDocument]);
        Assert.Contains("SOUS_TOTAL", cibles[CorrespondancesReprise.Listes.TypeLigne]);
        Assert.Contains("salarie", cibles[CorrespondancesReprise.Listes.TypeFiche]);
        foreach (var source in new[] { SourceReprise.Mde, SourceReprise.Optim })
        {
            var erreurs = CorrespondancesReprise.ParDefaut(source).Valider(CorrespondancesReprise.TablesAttendues(source), cibles, source);
            Assert.True(erreurs.Count == 0, string.Join("\n", erreurs.Select(e => $"{e.Code} {e.Emplacement} {e.Valeur}")));
        }

        // Une donnée métier : la base n'est plus une cible de reprise.
        await using (var cmd = new NpgsqlCommand(
            "INSERT INTO personne (per_niv_code, per_raison_sociale) SELECT niv_code, 'ESSAI' FROM niveau_personne LIMIT 1", c))
            await cmd.ExecuteNonQueryAsync();
        Assert.False(await BaseCibleReprise.EstVideAsync(c, null, default));
        var refus = await Assert.ThrowsAsync<RepriseRefuseeException>(() => RepriseBase.ExecuterAsync(new DemandeReprise
        {
            Source = SourceReprise.Optim, ConnexionSource = "Server=invalide", ConnexionCible = b.Connexion,
        }, default));
        Assert.Equal(ErreurReprise.BaseNonVide, refus.Code);
    }

    [Theory]
    [InlineData(SourceReprise.Mde)]
    [InlineData(SourceReprise.Optim)]
    public async Task Simulation_puis_reprise_reelle_sur_une_base_neuve(string source)
    {
        if (Admin is null || Source(source) is not { } connexion) return;
        await using var b = await BaseNeuve.CreerAsync(Admin);
        var demande = new DemandeReprise
        {
            Source = source, ConnexionSource = connexion, ConnexionCible = b.Connexion,
            Societes = source == SourceReprise.Optim ? ["1", "2"] : [], Auteur = "test",
        };
        var simulation = await RepriseBase.ExecuterAsync(demande, default);
        Assert.Equal(EtatReprise.Terminee, simulation.Rapport.Etat);
        Assert.True(simulation.Rapport.Simulation);
        Assert.True(simulation.Rapport.TablesSource.Count > 150);
        Assert.Equal(3, simulation.Rapport.TablesSource[source == SourceReprise.Mde ? "PMECLIENT" : "ref_societe"]);
        Assert.Contains("Tables de la base source", simulation.Rapport.EnMarkdown());

        var reelle = await RepriseBase.ExecuterAsync(demande with { Simulation = false }, default);
        Assert.Equal(EtatReprise.Terminee, reelle.Rapport.Etat);
        Assert.Equal(2L, await b.CompterAsync("SELECT count(*) FROM import_reprise"));
        Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM import_reprise WHERE irp_simulation AND irp_etat = 'TERMINEE'"));

        // Correspondances fournies invalides : refus avant toute lecture.
        var refus = await Assert.ThrowsAsync<RepriseRefuseeException>(() => RepriseBase.ExecuterAsync(
            demande with { Correspondances = $$"""{ "source": "{{source}}", "version": 1, "tables": {} }""" }, default));
        Assert.Equal(ErreurReprise.CorrespondancesInvalides, refus.Code);
    }
}
