using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.SousTraitance.Tests;

/// <summary>Jeu partagé avec retenue.js : libération de la retenue de garantie.</summary>
public class ReglesRetenueTests
{
    private static DateOnly? J(JsonNode? n) => n is null ? null : DateOnly.Parse(n.GetValue<string>());

    [Fact]
    public void Liberation_identique_au_js()
    {
        var j = CasPartages.Lire(CasPartages.Chemin("modules", "sous-traitance", "tests", "cas", "04_retenue.json"));
        foreach (var c in j["cas"]!.AsArray())
        {
            var a = c!["attendu"]!;
            var r = ReglesRetenue.Calculer(J(c["reception"]), c["reserves"]!.GetValue<bool>(), J(c["levees_le"]), J(c["aujourdhui"])!.Value);
            var attendu = new LiberationRetenue(J(a["echeance"]), J(a["date"]), a["bloquee"]!.GetValue<bool>(), a["motif"]?.GetValue<string>(), a["liberable"]!.GetValue<bool>());
            Assert.True(attendu == r, $"{c["nom"]} : {r}");
        }
    }
}
