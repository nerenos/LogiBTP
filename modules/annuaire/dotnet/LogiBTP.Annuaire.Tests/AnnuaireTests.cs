using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Annuaire.Tests;

public class IdentifiantsTests
{
    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "annuaire", "tests", "cas", "01_identifiants.json"));

    private static void Verifier(string liste, Func<string, bool> controle)
    {
        foreach (var c in Jeu()[liste]!.AsArray())
        {
            var v = c!["valeur"]!.GetValue<string>();
            Assert.True(controle(v) == c["attendu"]!.GetValue<bool>(), $"{liste} {v}");
        }
    }

    [Fact] public void Siren_identique_au_js() => Verifier("siren", Identifiants.SirenValide);
    [Fact] public void Siret_identique_au_js() => Verifier("siret", Identifiants.SiretValide);
    [Fact] public void Tva_identique_au_js() => Verifier("tva", Identifiants.TvaValide);
    [Fact] public void Iban_identique_au_js() => Verifier("iban", Identifiants.IbanValide);
    [Fact] public void Bic_identique_au_js() => Verifier("bic", Identifiants.BicValide);

    [Fact]
    public void Cle_tva_identique_au_js()
    {
        foreach (var c in Jeu()["cle_tva"]!.AsArray()) Assert.Equal(c!["attendu"]!.GetValue<string>(), Identifiants.CleTva(c["siren"]!.GetValue<string>()));
    }

    [Fact]
    public void Controles_d_une_personne_identiques_au_js()
    {
        foreach (var c in Jeu()["personnes"]!.AsArray())
        {
            var v = c!["valeurs"]!.AsObject();
            string? S(string k) => v[k]?.GetValue<string>();
            var obtenu = Identifiants.Erreurs(new(S("pays"), S("siren"), S("siret"), S("tva_intra"), S("iban"), S("bic"))).Select(e => $"{e.Champ}:{e.Code}");
            var attendu = c["erreurs"]!.AsArray().Select(e => $"{e!["champ"]}:{e["code"]}");
            Assert.True(attendu.SequenceEqual(obtenu), $"{c["nom"]} : obtenu [{string.Join(", ", obtenu)}]");
        }
    }
}

public class PlanCoordonneesTests
{
    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "annuaire", "tests", "cas", "02_coordonnees.json"));

    public static TheoryData<string> Cas()
    {
        var data = new TheoryData<string>();
        foreach (var c in Jeu()["cas"]!.AsArray()) data.Add(c!["nom"]!.GetValue<string>());
        return data;
    }

    [Theory]
    [MemberData(nameof(Cas))]
    public void Plan_identique_au_js(string nom)
    {
        var c = Jeu()["cas"]!.AsArray().First(x => x!["nom"]!.GetValue<string>() == nom)!;
        var saisies = c["saisies"].Deserialize<List<SaisieCoordonnee>>(JsonCalcul.Options)!;
        var existantes = c["existantes"]!.AsArray().Select(n => n!.GetValue<long>()).ToList();
        var partages = c["partages"]!.AsObject().ToDictionary(kv => long.Parse(kv.Key), kv => kv.Value!.GetValue<int>());
        var r = PlanCoordonnees.Planifier(existantes, saisies, partages);
        var attendu = c["attendu"]!.AsObject();

        var operations = new JsonArray([.. r.Operations.Select(o => (JsonNode)o.VersJson())]);
        Assert.True(JsonNode.DeepEquals(attendu["operations"], operations), $"{nom} : opérations obtenues {operations.ToJsonString()}");
        var erreurs = r.Erreurs.Select(e => $"{e.Index}:{e.Champ}:{e.Code}");
        Assert.Equal(attendu["erreurs"]!.AsArray().Select(e => $"{e!["index"]}:{e["champ"]}:{e["code"]}"), erreurs);
        var choix = r.ChoixRequis.Select(x => $"{x.Index}:{x.CooId}:{x.Partages}");
        Assert.Equal(attendu["choix_requis"]!.AsArray().Select(e => $"{e!["index"]}:{e["coo_id"]}:{e["partages"]}"), choix);
    }
}

public class GrapheAnnuaireTests
{
    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "annuaire", "tests", "cas", "03_graphe.json"));

    public static TheoryData<string> Cas()
    {
        var data = new TheoryData<string>();
        foreach (var c in Jeu()["cas"]!.AsArray()) data.Add(c!["nom"]!.GetValue<string>());
        return data;
    }

    /// <summary>Jeu partagé avec graphe.js : mêmes nœuds et arêtes (JSON snake_case identique).</summary>
    [Theory]
    [MemberData(nameof(Cas))]
    public void Graphe_identique_au_js(string nom)
    {
        var jeu = Jeu();
        var c = jeu["cas"]!.AsArray().First(x => x!["nom"]!.GetValue<string>() == nom)!;
        var donnees = jeu["donnees"].Deserialize<DonneesGraphe>(JsonCalcul.Options)!;
        var options = c["options"].Deserialize<OptionsGraphe>(JsonCalcul.Options)!;
        var g = GrapheAnnuaire.Construire(donnees, c["depart"]!["type"]!.GetValue<string>(), c["depart"]!["id"]!.GetValue<long>(), options);
        var obtenu = JsonSerializer.SerializeToNode(g, JsonCalcul.Options);
        Assert.True(JsonNode.DeepEquals(c["attendu"], obtenu), $"{nom} : obtenu {obtenu!.ToJsonString()}");
    }
}
