using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle;
using LogiBTP.Socle.Testing;
using Npgsql;
using NpgsqlTypes;
using Xunit;

namespace LogiBTP.Listes.Tests;

public class ValidationRequeteTests
{
    [Theory]
    [InlineData("SELECT * FROM document")]
    [InlineData("  select id, 'a;b' AS t from x ;  ")]
    [InlineData("WITH t AS (SELECT 1 AS id) SELECT * FROM t")]
    [InlineData("(SELECT 1 AS id)")]
    [InlineData("SELECT 1 AS id -- ; DROP TABLE x")]
    [InlineData("SELECT \"update\" FROM x")]
    [InlineData("SELECT commentaire, settings_id FROM x")]
    public void Requetes_acceptees(string sql) => ValidationRequete.Valider(sql);

    [Theory]
    [InlineData("", "REQUETE_VIDE")]
    [InlineData("SELECT 1; SELECT 2", "REQUETE_MULTIPLE")]
    [InlineData("DELETE FROM document", "REQUETE_SELECT")]
    [InlineData("WITH d AS (DELETE FROM document RETURNING *) SELECT * FROM d", "REQUETE_INTERDITE")]
    [InlineData("SELECT * FROM x FOR UPDATE", "REQUETE_INTERDITE")]
    [InlineData("SELECT set_config('a', 'b', false); SET ROLE postgres", "REQUETE_MULTIPLE")]
    [InlineData("SELECT $$; DROP TABLE x; $$", "REQUETE_INTERDITE")]
    [InlineData("SELECT 'non terminé", "REQUETE_SYNTAXE")]
    public void Requetes_refusees(string sql, string code) =>
        Assert.Equal(code, Assert.Throws<ErreurListe>(() => ValidationRequete.Valider(sql)).Code);
}

public class ConstructeurRequeteTests
{
    private static readonly SourceResolue Source = new("SELECT * FROM \"v\"",
        [new("id", "integer"), new("nom", "text"), new("montant", "numeric"), new("ville", "text")], "id", null, "salarie");

    private static DefinitionVue Def() => new()
    {
        Colonnes = [new() { Code = "nom" }, new() { Code = "montant", Recherche = false }, new() { Code = "calcul", Calcul = true }],
    };

    [Fact]
    public void Colonne_inconnue_refusee_dans_les_segments()
    {
        var d = new DemandeListe { Segments = new() { ["nom\"; DROP TABLE x; --"] = ["a"] } };
        Assert.Equal("COLONNE_INCONNUE", Assert.Throws<ErreurListe>(() => new ConstructeurRequete(Source, Def(), d).Lot(10)).Code);
    }

    [Fact]
    public void Tri_sur_colonne_inconnue_ignore_et_colonnes_calculees_jamais_lues()
    {
        var d = new DemandeListe { Tri = [new() { Colonne = "inconnue" }, new() { Colonne = "montant", Sens = "desc" }] };
        var r = new ConstructeurRequete(Source, Def(), d).Lot(10);
        Assert.Contains("ORDER BY (s.\"montant\" IS NULL), s.\"montant\" DESC, s.\"id\" ASC", r.Texte);
        Assert.DoesNotContain("inconnue", r.Texte);
        Assert.DoesNotContain("calcul", r.Texte);
    }

    [Fact]
    public void Recherche_parametree_sur_les_colonnes_de_recherche()
    {
        var r = new ConstructeurRequete(Source, Def(), new DemandeListe { Recherche = "50% lyon_" }).Lot(10);
        Assert.Contains("f_sans_accent(s.\"nom\"::text) LIKE", r.Texte);
        Assert.DoesNotContain("s.\"montant\"::text) LIKE", r.Texte);
        Assert.Contains(r.Parametres, p => (string?)p.Valeur == "%50\\%%");
        Assert.Contains(r.Parametres, p => (string?)p.Valeur == "%lyon\\_%");
    }

    [Fact]
    public void Filtre_de_vue_parametre_et_type()
    {
        var def = Def();
        def.Filtres = [new() { Colonne = "montant", Op = "entre", Valeur = "10,5", Valeur2 = "20" }, new() { Colonne = "nom", Op = "contient", Valeur = "é%" }];
        var r = new ConstructeurRequete(Source, def, new DemandeListe()).Lot(10);
        Assert.Contains("s.\"montant\" BETWEEN CAST(@p0 AS numeric) AND CAST(@p1 AS numeric)", r.Texte);
        Assert.Equal("10.5", r.Parametres[0].Valeur);
        Assert.Contains(r.Parametres, p => (string?)p.Valeur == "%é\\%%");
    }

    [Fact]
    public void Filtre_de_vue_operateur_ou_colonne_inconnus_refuses()
    {
        var def = Def();
        def.Filtres = [new() { Colonne = "nom", Op = "; DROP" }];
        Assert.Equal("FILTRE_OPERATEUR", Assert.Throws<ErreurListe>(() => new ConstructeurRequete(Source, def, new DemandeListe()).Lot(10)).Code);
        def.Filtres = [new() { Colonne = "inconnue", Op = "=" }];
        Assert.Equal("COLONNE_INCONNUE", Assert.Throws<ErreurListe>(() => new ConstructeurRequete(Source, def, new DemandeListe()).Lot(10)).Code);
    }

    [Fact]
    public void Curseur_incompatible_refuse()
    {
        var d = new DemandeListe { Tri = [new() { Colonne = "nom" }], Apres = ["x"] };
        Assert.Equal("CURSEUR", Assert.Throws<ErreurListe>(() => new ConstructeurRequete(Source, Def(), d).Lot(10)).Code);
    }
}

/// <summary>
/// Jeux partagés exécutés sur PostgreSQL (schéma du module Liste requis : f_sans_accent). Ignorés sans la
/// variable d'environnement LOGIBTP_TEST_PG (chaîne de connexion), par exemple :
/// Host=localhost;Port=5433;Database=logibtp;Username=logibtp;Password=logibtp
/// </summary>
public sealed class IntegrationPostgresTests : IAsyncLifetime
{
    private static readonly string? Connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");
    private readonly string _table = $"test_liste_{Guid.NewGuid():N}";
    private NpgsqlConnection? _cnx;
    private readonly JsonObject _jeu = CasPartages.Lire(CasPartages.Chemin("modules", "liste", "tests", "cas", "02_requete.json"));

    public async Task InitializeAsync()
    {
        if (Connexion is null) return;
        _cnx = new NpgsqlConnection(Connexion);
        await _cnx.OpenAsync();
        await Executer($"CREATE TABLE {_table} (id integer PRIMARY KEY, nom text, ville text, service text, montant numeric, actif boolean)");
        foreach (var l in _jeu["source"]!["lignes"]!.AsArray())
        {
            await using var cmd = new NpgsqlCommand($"INSERT INTO {_table} VALUES (@id, @nom, @ville, @service, @montant, @actif)", _cnx);
            cmd.Parameters.AddWithValue("id", l!["id"]!.GetValue<int>());
            foreach (var c in new[] { "nom", "ville", "service" }) cmd.Parameters.Add(new NpgsqlParameter(c, NpgsqlDbType.Text) { Value = (object?)l[c]?.GetValue<string>() ?? DBNull.Value });
            cmd.Parameters.Add(new NpgsqlParameter("montant", NpgsqlDbType.Numeric) { Value = (object?)l["montant"]?.GetValue<decimal>() ?? DBNull.Value });
            cmd.Parameters.AddWithValue("actif", l["actif"]!.GetValue<bool>());
            await cmd.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync()
    {
        if (_cnx is null) return;
        await Executer($"DROP TABLE IF EXISTS {_table}");
        await _cnx.DisposeAsync();
    }

    private async Task Executer(string sql)
    {
        await using var cmd = new NpgsqlCommand(sql, _cnx);
        await cmd.ExecuteNonQueryAsync();
    }

    private async Task<List<Dictionary<string, object?>>> Lire(RequeteSql r)
    {
        await using var cmd = new NpgsqlCommand(r.Texte, _cnx);
        foreach (var p in r.Parametres)
        {
            cmd.Parameters.Add(p.Valeur switch
            {
                int n => new NpgsqlParameter(p.Nom, NpgsqlDbType.Integer) { Value = n },
                string[] t => new NpgsqlParameter(p.Nom, NpgsqlDbType.Array | NpgsqlDbType.Text) { Value = t },
                var v => new NpgsqlParameter(p.Nom, NpgsqlDbType.Text) { Value = (object?)v?.ToString() ?? DBNull.Value },
            });
        }
        var res = new List<Dictionary<string, object?>>();
        await using var rd = await cmd.ExecuteReaderAsync();
        while (await rd.ReadAsync())
        {
            var l = new Dictionary<string, object?>();
            for (var i = 0; i < rd.FieldCount; i++) l[rd.GetName(i)] = rd.IsDBNull(i) ? null : rd.GetValue(i);
            res.Add(l);
        }
        return res;
    }

    private SourceResolue Source() => new($"SELECT * FROM {_table}",
        [new("id", "integer"), new("nom", "text"), new("ville", "text"), new("service", "text"), new("montant", "numeric"), new("actif", "boolean")],
        "id", null, "salarie");

    private DefinitionVue Def(JsonNode? filtres = null)
    {
        var recherche = _jeu["recherche"]!.AsArray().Select(n => n!.GetValue<string>()).ToHashSet();
        return new DefinitionVue
        {
            Colonnes = Source().Colonnes.Select(c => new ColonneVue { Code = c.Code, Recherche = recherche.Contains(c.Code) }).ToList(),
            Filtres = filtres?.Deserialize<List<FiltreVue>>(JsonCalcul.Options) ?? [],
        };
    }

    private static DemandeListe Demande(JsonNode? requete) =>
        requete?.Deserialize<DemandeListe>(JsonCalcul.Options) ?? new DemandeListe();

    [Fact]
    public async Task Normalisation_identique_au_js()
    {
        if (_cnx is null) return;
        foreach (var c in CasPartages.Lire(CasPartages.Chemin("modules", "liste", "tests", "cas", "01_normalisation.json"))["cas"]!.AsArray())
        {
            await using var cmd = new NpgsqlCommand("SELECT f_sans_accent(@t)", _cnx);
            cmd.Parameters.AddWithValue("t", c!["texte"]!.GetValue<string>());
            Assert.Equal(c["attendu"]!.GetValue<string>(), (string?)await cmd.ExecuteScalarAsync());
        }
    }

    [Fact]
    public async Task Lots_par_cle_identiques_au_js()
    {
        if (_cnx is null) return;
        foreach (var c in _jeu["cas"]!.AsArray())
        {
            var d = Demande(c!["requete"]);
            var ids = new List<int>();
            for (var tour = 0; tour < 20; tour++)
            {
                var constructeur = new ConstructeurRequete(Source(), Def(c["filtres"]), d);
                var tri = constructeur.Tri();
                var lignes = await Lire(constructeur.Lot(2));
                var suite = lignes.Count > 2;
                if (suite) lignes.RemoveAt(2);
                ids.AddRange(lignes.Select(l => Convert.ToInt32(l["_id"])));
                if (!suite) break;
                var derniere = lignes[^1];
                d.Apres = [.. Enumerable.Range(0, tri.Count).Select(i => derniere[$"_t{i}"] as string), derniere["_tid"] as string];
            }
            Assert.True(c["attendu"]!.AsArray().Select(n => n!.GetValue<int>()).SequenceEqual(ids), $"{c["nom"]} : obtenu [{string.Join(", ", ids)}]");
        }
    }

    [Fact]
    public async Task Comptes_de_segments_identiques_au_js()
    {
        if (_cnx is null) return;
        foreach (var c in _jeu["segments"]!.AsArray())
        {
            var r = new ConstructeurRequete(Source(), Def(c!["filtres"]), Demande(c["requete"])).Segments(c["colonne"]!.GetValue<string>());
            var obtenus = (await Lire(r)).Select(l => (l["valeur"] as string, Convert.ToInt64(l["nombre"]))).ToList();
            var attendus = c["attendu"]!.AsArray().Select(a => (a!["valeur"]?.GetValue<string>(), a["nombre"]!.GetValue<long>())).ToList();
            Assert.Equal(attendus, obtenus);
        }
    }
}
