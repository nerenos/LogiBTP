using System.Runtime.CompilerServices;
using LogiBTP.Import.Reprise;
using LogiBTP.Socle.Donnees;
using LogiBTP.Socle.Testing;
using Npgsql;
using Xunit;

namespace LogiBTP.Import.Tests;

/// <summary>
/// Moteur de reprise (plan reprise-mde-optim, lot 1) : ordre des domaines, registre, lignes source, rapport ; intégration
/// sur une base PostgreSQL temporaire (LOGIBTP_TEST_PG_ADMIN, superutilisateur, base « postgres ») : simulation annulée,
/// reprise réelle validée, refus d'une base non vide, échec annulé avec son rapport.
/// </summary>
public class MoteurRepriseTests
{
    private static readonly string? Admin = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG_ADMIN");

    private sealed class Domaine(string code, string[] dependances, Func<ContexteReprise, CancellationToken, Task>? action = null) : IDomaineReprise
    {
        public string Code => code;
        public IReadOnlyList<string> Dependances => dependances;
        public Task ExecuterAsync(ContexteReprise contexte, CancellationToken ct) => action?.Invoke(contexte, ct) ?? Task.CompletedTask;
    }

    private sealed class LecteurFictif(string source) : ILecteurSource
    {
        public string Source => source;
        public Task<IReadOnlyList<string>> TablesAsync(CancellationToken ct) => Task.FromResult<IReadOnlyList<string>>(["CLIENT"]);
        public Task<long> CompterAsync(string table, CancellationToken ct) => Task.FromResult(2L);
        public async IAsyncEnumerable<LigneSource> LireAsync(string requete, IReadOnlyDictionary<string, object?>? parametres,
            [EnumeratorCancellation] CancellationToken ct)
        {
            await Task.Yield();
            yield return new LigneSource(new Dictionary<string, object?> { ["CODE"] = "C001  ", ["NOM"] = "MARTIN" });
            yield return new LigneSource(new Dictionary<string, object?> { ["CODE"] = "C002", ["NOM"] = "" });
        }
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    private static FichierCorrespondances Correspondances(string source = SourceReprise.Mde) =>
        FichierCorrespondances.Lire($$"""{ "source": "{{source}}", "version": 1, "tables": { "t": { "cibles": [], "entrees": [ { "source": "X", "ignorer": true, "motif": "m" } ] } } }""").Fichier!;

    private static Domaine D(string code, params string[] dependances) => new(code, dependances);

    [Fact]
    public void Ordre_par_dependances_stable()
    {
        var m = new MoteurReprise([D("pieces", "annuaire", "bibliotheque"), D("referentiels"), D("annuaire", "referentiels"), D("bibliotheque", "referentiels")],
            (_, _, _) => Task.FromResult(true));
        Assert.Equal(["referentiels", "annuaire", "bibliotheque", "pieces"], m.Ordre().Select(d => d.Code));
    }

    [Theory]
    [InlineData(ErreurReprise.DomaineEnDouble)]
    [InlineData(ErreurReprise.DependanceInconnue)]
    [InlineData(ErreurReprise.Cycle)]
    public void Ordre_refuse(string code)
    {
        IReadOnlyList<IDomaineReprise> domaines = code switch
        {
            ErreurReprise.DomaineEnDouble => [D("a"), D("a")],
            ErreurReprise.DependanceInconnue => [D("a", "z")],
            _ => [D("a", "c"), D("b", "a"), D("c", "b")],
        };
        var e = Assert.Throws<RepriseRefuseeException>(() => new MoteurReprise(domaines, (_, _, _) => Task.FromResult(true)).Ordre());
        Assert.Equal(code, e.Code);
    }

    [Fact]
    public void Registre_et_cles_sans_espaces_de_fin()
    {
        var r = new RegistreCorrespondances();
        r.Inscrire("PMECLIENT", "C001  ", "personne", 12);
        Assert.Equal(12, r.Trouver("PMECLIENT", "C001"));
        Assert.Null(r.Trouver("PMECLIENT", "C002"));
        Assert.Null(r.Trouver("PMECLIENT", null));
        Assert.Throws<InvalidOperationException>(() => r.Inscrire("PMECLIENT", "C001", "personne", 13));
    }

    [Fact]
    public void Ligne_source_valeurs_vides_et_doubles()
    {
        var l = new LigneSource(new Dictionary<string, object?>
        {
            ["Nom"] = "  ", ["CODE"] = "C1   ", ["Taux"] = 0.1 + 0.2, ["Qte"] = 1.0000005, ["Id"] = 0, ["Lien"] = 42L,
            ["Date"] = new DateTime(1900, 1, 1), ["Le"] = new DateTime(2026, 11, 16), ["Bit"] = (byte)1, ["Rien"] = DBNull.Value,
        });
        Assert.Null(l.Texte("nom"));
        Assert.Equal("C1", l.Texte("code"));
        Assert.Equal(0.3m, l.Decimal("taux"));
        Assert.Equal(1.000001m, l.Decimal("qte"));
        Assert.Null(l.Id("id"));
        Assert.Equal(42, l.Id("lien"));
        Assert.Null(l.Date("date"));
        Assert.Equal(new DateTime(2026, 11, 16), l.Date("le"));
        Assert.True(l.Booleen("bit"));
        Assert.Null(l.Texte("rien"));
        Assert.Throws<KeyNotFoundException>(() => l.Brut("absente"));
    }

    [Fact]
    public void Rapport_json_et_markdown()
    {
        var r = new RapportReprise { Source = SourceReprise.Optim, Societes = ["1", "2"], Simulation = true };
        r.Volume("bib_tiers").Lues = 9;
        r.Perdre("bib_tiers", "TRS_Evaluation", "A");
        r.Perdre("bib_tiers", "TRS_Evaluation", "");
        r.Perdre("bib_tiers", "TRS_Evaluation", "B|C");
        r.Forcer("salarie", "S01", "sal_salaire", "0");
        r.Signaler(NiveauAnomalie.Avertissement, "X", "bib_tiers[3]", "Ligne\nsur deux lignes");
        r.Appliquer("type_document_vente", "ATT", "ignoré : Q16");
        var relu = RapportReprise.DepuisJson(r.EnJson())!;
        Assert.Equal(2, relu.ChampsPerdus[0].Nombre);
        Assert.Equal(["A", "B|C"], relu.ChampsPerdus[0].Exemples);
        Assert.Single(relu.ValeursForcees);
        Assert.Equal("ignoré : Q16", relu.Correspondances["type_document_vente"]["ATT"]);
        var md = relu.EnMarkdown();
        Assert.Contains("# Reprise OPTIM (simulation)", md);
        Assert.Contains("| bib_tiers | TRS_Evaluation | 2 | A ; B\\|C |  |", md);
        Assert.Contains("Ligne sur deux lignes", md);
    }

    [Fact]
    public void Erreur_enveloppee_cause_reelle_dans_le_rapport()
    {
        var e = new InvalidOperationException("An exception has been raised that is likely due to a transient failure.",
            new IOException("Exception while reading from stream", new TimeoutException("Timeout during reading attempt")));
        Assert.Equal("InvalidOperationException / TimeoutException", MoteurReprise.CodeErreur(e));
        Assert.Equal("An exception has been raised that is likely due to a transient failure. → Exception while reading from stream → Timeout during reading attempt",
            MoteurReprise.MessageErreur(e));
        Assert.Equal("InvalidOperationException", MoteurReprise.CodeErreur(new InvalidOperationException("x")));
    }

    [Fact]
    public async Task Source_incompatible()
    {
        var m = new MoteurReprise([], (_, _, _) => Task.FromResult(true));
        await using var unite = new UniteEcriture(new ConnexionRequete("Host=invalide"));
        var e = await Assert.ThrowsAsync<RepriseRefuseeException>(() => m.ExecuterAsync(new OptionsReprise { Source = SourceReprise.Mde },
            new LecteurFictif(SourceReprise.Optim), Correspondances(), unite, default));
        Assert.Equal(ErreurReprise.SourceIncompatible, e.Code);
    }

    // ------------------------------------------------------------------ intégration (PostgreSQL)

    private sealed class BaseEssai : IAsyncDisposable
    {
        private readonly string admin;
        private readonly string nom;
        public string Connexion { get; }

        private BaseEssai(string admin, string nom, string connexion) { this.admin = admin; this.nom = nom; Connexion = connexion; }

        public static async Task<BaseEssai> CreerAsync(string admin)
        {
            var nom = "reprise_essai_" + Guid.NewGuid().ToString("N")[..12];
            await using (var c = new NpgsqlConnection(admin))
            {
                await c.OpenAsync();
                await using var cmd = new NpgsqlCommand($"CREATE DATABASE {nom}", c); // nom généré, jamais saisi
                await cmd.ExecuteNonQueryAsync();
            }
            var chaine = new NpgsqlConnectionStringBuilder(admin) { Database = nom, Pooling = false }.ConnectionString;
            await using (var c = new NpgsqlConnection(chaine))
            {
                await c.OpenAsync();
                var script = await File.ReadAllTextAsync(CasPartages.Chemin("modules", "import", "db", "1.1_reprise.sql"));
                await using var cmd = new NpgsqlCommand(script + "\nCREATE TABLE essai (id BIGSERIAL PRIMARY KEY, code TEXT NOT NULL UNIQUE);", c);
                await cmd.ExecuteNonQueryAsync();
            }
            return new BaseEssai(admin, nom, chaine);
        }

        public async Task<long> CompterAsync(string requete)
        {
            await using var c = new NpgsqlConnection(Connexion);
            await c.OpenAsync();
            await using var cmd = new NpgsqlCommand(requete, c);
            return Convert.ToInt64(await cmd.ExecuteScalarAsync());
        }

        public async ValueTask DisposeAsync()
        {
            NpgsqlConnection.ClearAllPools();
            await using var c = new NpgsqlConnection(admin);
            await c.OpenAsync();
            await using var cmd = new NpgsqlCommand($"DROP DATABASE IF EXISTS {nom} WITH (FORCE)", c);
            await cmd.ExecuteNonQueryAsync();
        }
    }

    /// <summary>Domaine d'essai : chaque ligne source devient une ligne de « essai », inscrite au registre.</summary>
    private static Domaine Ecrire(string? echecSur = null) => new("essai", [], async (ctx, ct) =>
    {
        await foreach (var l in ctx.Lecteur.LireAsync("SELECT CODE, NOM FROM CLIENT", null, ct))
        {
            var code = l.Texte("CODE")!;
            if (code == echecSur) throw new InvalidOperationException("Échec simulé");
            ctx.Rapport.Volume("CLIENT").Lues++;
            await using var cmd = new NpgsqlCommand("INSERT INTO essai (code) VALUES ($1) RETURNING id", ctx.Unite.Connexion, ctx.Unite.Transaction);
            cmd.Parameters.Add(new() { Value = code });
            ctx.Registre.Inscrire("CLIENT", code, "essai", (long)(await cmd.ExecuteScalarAsync(ct))!);
            ctx.Rapport.Volume("CLIENT").Ecrites++;
            if (l.Texte("NOM") is null) ctx.Rapport.Forcer("essai", code, "nom", "?");
        }
    });

    private static Func<NpgsqlConnection, NpgsqlTransaction?, CancellationToken, Task<bool>> EssaiVide => async (c, tx, ct) =>
    {
        await using var cmd = new NpgsqlCommand("SELECT NOT EXISTS (SELECT 1 FROM essai)", c, tx);
        return (bool)(await cmd.ExecuteScalarAsync(ct))!;
    };

    private static async Task<ResultatReprise> LancerAsync(BaseEssai b, bool simulation, string? echecSur = null)
    {
        await using var unite = new UniteEcriture(new ConnexionRequete(b.Connexion));
        return await new MoteurReprise([Ecrire(echecSur)], EssaiVide).ExecuterAsync(
            new OptionsReprise { Source = SourceReprise.Mde, Simulation = simulation, Auteur = "test" },
            new LecteurFictif(SourceReprise.Mde), Correspondances(), unite, default);
    }

    [Fact]
    public async Task Simulation_annulee_rapport_enregistre()
    {
        if (Admin is null) return;
        await using var b = await BaseEssai.CreerAsync(Admin);
        var r = await LancerAsync(b, simulation: true);
        Assert.Equal(EtatReprise.Terminee, r.Rapport.Etat);
        Assert.Equal(2, r.Rapport.Volumes.Single().Ecrites);
        Assert.Equal(2, r.Rapport.TablesSource["CLIENT"]);
        Assert.Single(r.Rapport.ValeursForcees);
        Assert.Equal(0, await b.CompterAsync("SELECT count(*) FROM essai"));
        Assert.Equal(0, await b.CompterAsync("SELECT count(*) FROM import_correspondance"));
        Assert.Equal(1, await b.CompterAsync($"SELECT count(*) FROM import_reprise WHERE irp_id = {r.RepriseId} AND irp_simulation AND irp_etat = 'TERMINEE' AND irp_rapport->'volumes'->0->>'ecrites' = '2'"));
    }

    [Fact]
    public async Task Avancement_signale_a_chaque_etape()
    {
        if (Admin is null) return;
        await using var b = await BaseEssai.CreerAsync(Admin);
        var etapes = new List<AvancementReprise>();
        await using var unite = new UniteEcriture(new ConnexionRequete(b.Connexion));
        var r = await new MoteurReprise([Ecrire(), D("suite", "essai")], EssaiVide).ExecuterAsync(
            new OptionsReprise { Source = SourceReprise.Mde, Simulation = true, Avancement = etapes.Add, IntervalleAvancement = TimeSpan.FromHours(1) },
            new LecteurFictif(SourceReprise.Mde), Correspondances(), unite, default);
        Assert.Equal(EtatReprise.Terminee, r.Rapport.Etat);
        // Étapes (les signalements périodiques du domaine, selon la durée, sont ignorés : intervalle long).
        Assert.Equal([
            (EtapeReprise.Preparation, null, 0, 2, 0L, 0L, 0L),
            (EtapeReprise.Comptage, "CLIENT", 0, 1, 0L, 0L, 0L),
            (EtapeReprise.Domaine, "essai", 0, 2, 0L, 0L, 0L),
            (EtapeReprise.Domaine, "suite", 1, 2, 0L, 2L, 2L),
            (EtapeReprise.Enregistrement, null, 2, 2, 0L, 2L, 2L),
        ], etapes.Select(e => (e.Etape, e.Element, e.Faits, e.Total, e.Lignes, e.LignesTotal, e.Ecrites)));
        // Temps de lecture de la source mesuré et reporté au rapport.
        Assert.Contains(r.Rapport.Chronos, c => c.Poste == ChronosReprise.LectureSource && c.Nombre == 2);
        Assert.Contains(etapes.Last().Chronos, c => c.Poste == ChronosReprise.LectureSource);
    }

    [Fact]
    public async Task Compteurs_signales_pendant_le_domaine()
    {
        if (Admin is null) return;
        await using var b = await BaseEssai.CreerAsync(Admin);
        var etapes = new List<AvancementReprise>();
        // Domaine qui lit 1 750 lignes en 200 ms au moins (lecture répétée de la table fictive à deux lignes).
        var lire = new Domaine("lire", [], async (ctx, ct) =>
        {
            for (var i = 0; i < 875; i++)
            {
                await foreach (var _ in ctx.Lecteur.LireAsync("SELECT CODE FROM CLIENT", null, ct)) { }
                if (i % 175 == 0) await Task.Delay(50, ct);
            }
        });
        await using var unite = new UniteEcriture(new ConnexionRequete(b.Connexion));
        await new MoteurReprise([D("avant"), lire], EssaiVide).ExecuterAsync(
            new OptionsReprise { Source = SourceReprise.Mde, Simulation = true, Avancement = e => { lock (etapes) etapes.Add(e); }, IntervalleAvancement = TimeSpan.FromMilliseconds(20) },
            new LecteurFictif(SourceReprise.Mde), Correspondances(), unite, default);
        // Signalements périodiques pendant le domaine : compteurs croissants, domaine « lire » (rang 1).
        var periodiques = etapes.Where(e => e.Etape == EtapeReprise.Domaine && e.Lignes > 0).ToList();
        Assert.NotEmpty(periodiques);
        Assert.All(periodiques, e => Assert.Equal(("lire", 1), (e.Element, e.Faits)));
        Assert.Equal(periodiques.Select(e => e.Lignes).Order(), periodiques.Select(e => e.Lignes));
        Assert.Equal(1750, etapes.Last().LignesTotal);
    }

    [Fact]
    public async Task Suivi_en_erreur_sans_effet_sur_la_reprise()
    {
        if (Admin is null) return;
        await using var b = await BaseEssai.CreerAsync(Admin);
        await using var unite = new UniteEcriture(new ConnexionRequete(b.Connexion));
        var r = await new MoteurReprise([Ecrire()], EssaiVide).ExecuterAsync(
            new OptionsReprise { Source = SourceReprise.Mde, Simulation = true, Avancement = _ => throw new InvalidOperationException("suivi") },
            new LecteurFictif(SourceReprise.Mde), Correspondances(), unite, default);
        Assert.Equal(EtatReprise.Terminee, r.Rapport.Etat);
    }

    [Fact]
    public async Task Reprise_reelle_validee_puis_base_non_vide_refusee()
    {
        if (Admin is null) return;
        await using var b = await BaseEssai.CreerAsync(Admin);
        var r = await LancerAsync(b, simulation: false);
        Assert.Equal(EtatReprise.Terminee, r.Rapport.Etat);
        Assert.Equal(2, await b.CompterAsync("SELECT count(*) FROM essai"));
        Assert.Equal(2, await b.CompterAsync($"SELECT count(*) FROM import_correspondance WHERE imc_irp_id = {r.RepriseId}"));
        Assert.Equal(1, await b.CompterAsync("SELECT count(*) FROM import_reprise WHERE NOT irp_simulation AND irp_etat = 'TERMINEE'"));

        var e = await Assert.ThrowsAsync<RepriseRefuseeException>(() => LancerAsync(b, simulation: true));
        Assert.Equal(ErreurReprise.BaseNonVide, e.Code);
    }

    [Fact]
    public async Task Echec_annule_avec_rapport()
    {
        if (Admin is null) return;
        await using var b = await BaseEssai.CreerAsync(Admin);
        var r = await LancerAsync(b, simulation: false, echecSur: "C002");
        Assert.Equal(EtatReprise.Echec, r.Rapport.Etat);
        Assert.Contains(r.Rapport.Anomalies, a => a.Niveau == NiveauAnomalie.Bloquant && a.Message == "Échec simulé" && a.Emplacement == "essai");
        Assert.Equal(0, await b.CompterAsync("SELECT count(*) FROM essai"));
        Assert.Equal(1, await b.CompterAsync("SELECT count(*) FROM import_reprise WHERE irp_etat = 'ECHEC'"));
    }

    [Fact]
    public async Task Fusions_lues_avant_la_reprise()
    {
        if (Admin is null) return;
        await using var b = await BaseEssai.CreerAsync(Admin);
        await using (var c = new NpgsqlConnection(b.Connexion))
        {
            await c.OpenAsync();
            await using var cmd = new NpgsqlCommand(
                "INSERT INTO import_fusion (ifu_source, ifu_table_source, ifu_cle_conservee, ifu_cles_fusionnees) VALUES ('MDE', 'CLIENT', 'C001', '[\"C002\"]')", c);
            await cmd.ExecuteNonQueryAsync();
        }
        string? conservee = null;
        await using var unite = new UniteEcriture(new ConnexionRequete(b.Connexion));
        await new MoteurReprise([new Domaine("f", [], (ctx, _) => { conservee = ctx.CleConservee("CLIENT", "C002 "); return Task.CompletedTask; })], EssaiVide)
            .ExecuterAsync(new OptionsReprise { Source = SourceReprise.Mde }, new LecteurFictif(SourceReprise.Mde), Correspondances(), unite, default);
        Assert.Equal("C001", conservee);
    }

    [Fact]
    public async Task Fusions_remplacees_appliquees_par_le_moteur_et_historique_lu()
    {
        if (Admin is null) return;
        await using var b = await BaseEssai.CreerAsync(Admin);
        await using var unite = new UniteEcriture(new ConnexionRequete(b.Connexion));
        await FusionsReprise.RemplacerAsync(unite, SourceReprise.Mde, [new("CLIENT", "C001", ["C009 "])], default);
        await FusionsReprise.RemplacerAsync(unite, SourceReprise.Mde, [new("CLIENT", "C001", ["C002"])], default); // remplace
        await FusionsReprise.RemplacerAsync(unite, SourceReprise.Optim, [new("bib_tiers", "12", ["13"])], default);
        await using var c = new NpgsqlConnection(b.Connexion);
        await c.OpenAsync();
        var mde = Assert.Single(await FusionsReprise.LireAsync(c, null, SourceReprise.Mde, default));
        Assert.Equal(["C002"], mde.ClesFusionnees);

        string? conservee = null;
        var domaine = new Domaine("fusion", [], (ctx, _) => { conservee = ctx.CleConservee("CLIENT", "C002  "); return Task.CompletedTask; });
        var r = await new MoteurReprise([domaine], EssaiVide).ExecuterAsync(new OptionsReprise { Source = SourceReprise.Mde },
            new LecteurFictif(SourceReprise.Mde), Correspondances(), unite, default);
        Assert.Equal("C001", conservee);

        var historique = await ExecutionsReprise.ListerAsync(c, null, 10, default);
        var e = Assert.Single(historique);
        Assert.Equal((r.RepriseId, true, EtatReprise.Terminee, 0), (e.Id, e.Simulation, e.Etat, e.Bloquantes));
        Assert.Equal(2, (await ExecutionsReprise.RapportAsync(c, null, r.RepriseId, default))!.TablesSource["CLIENT"]);
        Assert.Null(await ExecutionsReprise.RapportAsync(c, null, r.RepriseId + 1, default));
    }
}
