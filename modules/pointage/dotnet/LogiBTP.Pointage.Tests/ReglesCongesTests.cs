using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Pointage.Tests;

/// <summary>Jeu partagé avec conges.js : contrôles, jours décomptés, traitements.</summary>
public class ReglesCongesTests
{
    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "pointage", "tests", "cas", "04_conges.json"));

    private static List<string> Textes(JsonNode? n) => n?.AsArray().Select(x => x!.GetValue<string>()).ToList() ?? [];

    private static CongePeriode Conge(JsonNode n) => new(n["id"]?.GetValue<long>(), n["du"]?.GetValue<string>(), n["au"]?.GetValue<string>(),
        n["debut_midi"]?.GetValue<bool>() ?? false, n["fin_midi"]?.GetValue<bool>() ?? false, n["etat"]?.GetValue<string>() ?? "DEMANDE");

    [Fact]
    public void Conges_identiques_au_js()
    {
        var j = Jeu();
        foreach (var c in j["controles"]!.AsArray())
        {
            var obtenu = ReglesConges.Controler(Conge(c!["conge"]!), c["autres"]!.AsArray().Select(x => Conge(x!)));
            Assert.True(Textes(c["attendu"]).SequenceEqual(obtenu), $"{c["nom"]} : {string.Join(",", obtenu)}");
        }
        foreach (var c in j["jours"]!.AsArray())
        {
            var obtenu = ReglesConges.Jours(Conge(c!["conge"]!), Textes(c["travailles"]));
            var attendu = c["attendu"]!.AsArray().Select(x => new JourConge(x!["date"]!.GetValue<string>(), x["part"]!.GetValue<decimal>())).ToList();
            Assert.True(attendu.SequenceEqual(obtenu), c["nom"]!.GetValue<string>());
            Assert.Equal(c["total"]!.GetValue<decimal>(), ReglesConges.Total(obtenu));
        }
        foreach (var c in j["traitements"]!.AsArray())
        {
            var obtenu = ReglesConges.ControlerTraitement(c!["action"]!.GetValue<string>(), Conge(c["conge"]!), c["nature"]?.GetValue<string>());
            Assert.True(Textes(c["attendu"]).SequenceEqual(obtenu), $"{c["nom"]} : {string.Join(",", obtenu)}");
        }
    }
}
