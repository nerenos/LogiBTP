using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Pointage.Tests;

/// <summary>Jeu partagé avec validation.js : états, actions, exceptions.</summary>
public class ReglesValidationTests
{
    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "pointage", "tests", "cas", "02_validation.json"));

    private static List<string> Textes(JsonNode? n) => n?.AsArray().Select(x => x!.GetValue<string>()).ToList() ?? [];

    [Fact]
    public void Validation_identique_au_js()
    {
        var j = Jeu();
        foreach (var c in j["etats"]!.AsArray())
        {
            var v = c!["validations"]!.AsArray().Select(x => new ValidationPeriode(x!["niveau"]!.GetValue<string>(), x["du"]!.GetValue<string>(),
                x["au"]!.GetValue<string>(), x["annule"]?.GetValue<bool>() ?? false));
            Assert.True(c["attendu"]!.GetValue<string>() == ReglesValidation.Etat(c["mode"]!.GetValue<string>(), c["date"]!.GetValue<string>(), v), c["nom"]!.GetValue<string>());
        }
        foreach (var c in j["actions"]!.AsArray())
        {
            var obtenu = ReglesValidation.ControlerAction(c!["action"]!.GetValue<string>(), c["role"]!.GetValue<string>(), c["mode"]!.GetValue<string>(),
                Textes(c["etats"]), c["motif"]?.GetValue<string>());
            Assert.True(Textes(c["attendu"]).SequenceEqual(obtenu), $"{c["nom"]} : {string.Join(",", obtenu)}");
        }
        foreach (var c in j["exceptions"]!.AsArray())
        {
            var obtenu = ReglesValidation.Exceptions(Textes(c!["jours_travailles"]),
                c["pointages"]!.AsArray().Select(p => new PointageSynthese(p!["date"]!.GetValue<string>(), p["minutes"]!.GetValue<int>(), p["non_conformite"]?.GetValue<bool>() ?? false)).ToList(),
                c["seuil_semaine"]?.GetValue<int>() ?? 2100, c["avertissements"]?.GetValue<int>() ?? 0, c["corrections"]?.GetValue<int>() ?? 0, c["modifie"]?.GetValue<bool>() ?? false);
            Assert.True(Textes(c["attendu"]).SequenceEqual(obtenu), $"{c["nom"]} : {string.Join(",", obtenu)}");
        }
    }
}
