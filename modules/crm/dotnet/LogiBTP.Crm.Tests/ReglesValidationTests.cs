using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Crm.Tests;

/// <summary>Jeu partagé avec validations.js : état des plans, indice suivant.</summary>
public class ReglesValidationTests
{
    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "crm", "tests", "cas", "04_validations.json"));

    private static DateOnly? Jour(JsonNode? n) => n is null ? null : DateOnly.Parse(n.GetValue<string>(), CultureInfo.InvariantCulture);

    [Fact]
    public void Plans_identiques_au_js()
    {
        var jeu = Jeu();
        var effets = jeu["statuts"]!.AsArray().ToDictionary(s => s!["code"]!.GetValue<string>(), s => s!["effet"]!.GetValue<string>());
        var aujourdhui = Jour(jeu["aujourdhui"])!.Value;
        foreach (var c in jeu["plans"]!.AsArray())
        {
            var indices = c!["plan"]!["indices"]!.AsArray().Select(i => new IndiceAEvaluer(i!["indice"]!.GetValue<string>(), Jour(i["date"]),
                i["visas"]!.AsArray().Select(v => new VisaAEvaluer(v!["statut"]?.GetValue<string>(), Jour(v["attendu_le"]))).ToList())).ToList();
            var e = ReglesValidation.Etat(indices, effets, aujourdhui);
            var a = c["attendu"]!;
            var attendu = new EtatPlan(a["statut"]!.GetValue<string>(), a["indice"]?.GetValue<string>(), a["en_vigueur"]?.GetValue<string>(),
                a["manquants"]!.GetValue<int>(), a["retards"]!.GetValue<int>(), a["bloquant"]!.GetValue<bool>());
            Assert.True(attendu == e, c["nom"]!.GetValue<string>());
        }
    }

    [Fact]
    public void Indices_suivants_identiques_au_js()
    {
        foreach (var c in Jeu()["indices_suivants"]!.AsArray())
        {
            Assert.Equal(c!["attendu"]!.GetValue<string>(), ReglesValidation.IndiceSuivant(c["indice"]?.GetValue<string>()));
        }
    }
}
