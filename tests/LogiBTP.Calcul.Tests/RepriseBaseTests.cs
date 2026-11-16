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
        Assert.DoesNotContain(simulation.Rapport.Anomalies, a => a.Niveau == NiveauAnomalie.Bloquant);
        Assert.Equal(0L, await b.CompterAsync("SELECT count(*) FROM personne"));

        var reelle = await RepriseBase.ExecuterAsync(demande with { Simulation = false }, default);
        Assert.Equal(EtatReprise.Terminee, reelle.Rapport.Etat);
        Assert.Equal(2L, await b.CompterAsync("SELECT count(*) FROM import_reprise"));
        Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM import_reprise WHERE irp_simulation AND irp_etat = 'TERMINEE'"));
        await VerifierReferentielsAsync(b, source, reelle.Rapport);

        // Correspondances fournies invalides : refus avant toute lecture.
        var refus = await Assert.ThrowsAsync<RepriseRefuseeException>(() => RepriseBase.ExecuterAsync(
            demande with { Correspondances = $$"""{ "source": "{{source}}", "version": 1, "tables": {} }""" }, default));
        Assert.Equal(ErreurReprise.CorrespondancesInvalides, refus.Code);
    }

    /// <summary>Lot 4 : société de la base, référentiels rapprochés ou créés, paramétrage comptable.</summary>
    private static async Task VerifierReferentielsAsync(BaseNeuve b, string source, RapportReprise r)
    {
        Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM personne WHERE per_societe_base AND per_niv_code = 'SOCIETE'"));
        // MDE : adresse, téléphone, courriel ; OPTIM : adresse et téléphone du siège.
        Assert.Equal(source == SourceReprise.Mde ? 3L : 2L, await b.CompterAsync("""
            SELECT count(*) FROM usage_coordonnee u JOIN personne p ON p.per_id = u.uco_per_id WHERE p.per_societe_base
            """));
        Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM usage_coordonnee u JOIN coordonnee c ON c.coo_id = u.uco_coo_id JOIN personne p ON p.per_id = u.uco_per_id WHERE p.per_societe_base AND c.coo_nature = 'ADRESSE' AND u.uco_usage = 'SIEGE' AND u.uco_principal AND c.coo_pays = 'FR'"));
        Assert.Contains(r.Anomalies, a => a.Code == CodeAnomalie.Decimales || source == SourceReprise.Optim);
        if (source == SourceReprise.Mde)
        {
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM personne"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM personne WHERE per_siren = '123456789' AND per_capital = 10000 AND per_naf = '4120A'"));
            // Unités et taux tous rapprochés de l'existant (autoliquidation à 0 % → taux autoliquidé de LogiBTP).
            Assert.Equal("kg", r.Correspondances["unite"]["KG"]);
            Assert.Equal(6L, await b.CompterAsync("SELECT count(*) FROM taux_tva"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM taux_tva WHERE ttv_code = 'T20' AND ttv_cpt_collectee IS NOT NULL"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM compte_comptable WHERE cpt_code = '44571200' AND cpt_type = 'TVA'"));
            // Conditions : comptant et 30 jours fin de mois rapprochées, trois fois et LCR le 10 créées.
            Assert.Equal("COMPTANT", r.Correspondances["condition_paiement"]["CHQ"]);
            Assert.Equal("30JFM", r.Correspondances["condition_paiement"]["V30"]);
            Assert.Equal(1L, await b.CompterAsync("""SELECT count(*) FROM condition_paiement WHERE cpa_code = '3X' AND jsonb_array_length(cpa_lignes) = 3"""));
            Assert.Equal(1L, await b.CompterAsync("""SELECT count(*) FROM condition_paiement WHERE cpa_code = 'L10' AND cpa_lignes @> '[{"base":"JOUR","jour":10,"delai":30}]'"""));
            Assert.Equal("LCR", r.Correspondances["mode_paiement"]["L"]);
            Assert.Equal("M.", r.Correspondances["civilite"]["Monsieur"]);
            // Paramétrage comptable : journaux, collectifs, exigibilité, analytique.
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM type_comptable WHERE tco_code = 'VENTE' AND tco_journal = 'VE'"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM collectif_tiers WHERE col_code = 'FOURNISSEUR' AND col_cpt_code = '401000'"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM parametre_comptabilite WHERE pcp_cle = 'tva_sur_debits' AND pcp_valeur = 'false'"));
            Assert.Equal(2L, await b.CompterAsync("SELECT jsonb_array_length(pcp_valeur->'grilles') FROM parametre_comptabilite WHERE pcp_cle = 'reprise_analytique'"));
        }
        else
        {
            // Deux établissements d'un même SIREN : la société de tête et son établissement.
            Assert.Equal(2L, await b.CompterAsync("SELECT count(*) FROM personne"));
            Assert.Equal(1L, await b.CompterAsync("""
                SELECT count(*) FROM personne e JOIN personne s ON s.per_id = e.per_parent_id
                WHERE e.per_niv_code = 'ETABLISSEMENT' AND s.per_societe_base AND e.per_siret = '98765432100029' AND s.per_code = 'SOC-CDR'
                """));
            Assert.Equal("ft", r.Correspondances["unite"]["Forf"]);
            Assert.Equal("m2", r.Correspondances["unite"]["m²"]);
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM taux_tva WHERE ttv_taux = 8.5 AND ttv_categorie = 'N'"));
            Assert.Equal(7L, await b.CompterAsync("SELECT count(*) FROM taux_tva"));
            Assert.Equal("CHEQUE", r.Correspondances["mode_reglement"]["CHQ"]);
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM mode_reglement WHERE mre_code = 'TRAITE'"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM compte_comptable WHERE cpt_code = '704100'"));
            Assert.Equal(0L, await b.CompterAsync("SELECT count(*) FROM compte_comptable WHERE cpt_code = '704900'"));
            Assert.Equal("Mme", r.Correspondances["civilite"]["MME"]);
            Assert.Contains(r.Anomalies, a => a.Emplacement == "z_parametre 1203");
            Assert.Equal(7, r.Volumes.Single(v => v.Table == "ref_famille_type").Ecrites);
            Assert.Equal("FR", r.Correspondances["pays"]["France"]);
            Assert.Equal(2L, await b.CompterAsync("SELECT jsonb_array_length(pcp_valeur->'etablissements') FROM parametre_comptabilite WHERE pcp_cle = 'reprise_analytique'"));
        }
    }
}
