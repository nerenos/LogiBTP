using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Rentabilite.Tests;

/// <summary>Jeu partagé avec facturation.js : montant prévu d'un mois, contrôle d'une prévision.</summary>
public class FacturationTests
{
    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "rentabilite", "tests", "cas", "02_facturation.json"));
    private static decimal D(JsonNode? n) => decimal.Parse(n!.GetValue<string>(), CultureInfo.InvariantCulture);

    [Fact]
    public void Identiques_au_js()
    {
        var j = Jeu();
        foreach (var c in j["montants"]!.AsArray())
        {
            var r = Facturation.Montant(c!["mode"]!.GetValue<string>(), D(c["valeur"]), D(c["budget"]));
            Assert.True(c["attendu"]!.GetValue<string>() == r.ToString("0.00", CultureInfo.InvariantCulture), c["nom"]!.GetValue<string>());
        }
        foreach (var c in j["controles"]!.AsArray())
        {
            var lignes = c!["lignes"]!.AsArray().Select(l => new LigneFacturation(l!["mois"]?.GetValue<string>(), l["mode"]?.GetValue<string>(), l["valeur"]?.GetValue<string>())).ToList();
            var r = Facturation.Controler(lignes, D(c["budget"]));
            var attendu = c["attendu"]!.AsArray().Select(e => (e!["index"]!.GetValue<int>(), e["code"]!.GetValue<string>())).ToList();
            Assert.True(attendu.SequenceEqual(r.Select(e => (e.Index, e.Code))), c["nom"]!.GetValue<string>());
        }
    }
}
