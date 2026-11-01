using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Rentabilite.Tests;

/// <summary>Jeu partagé avec periodes.js : lecture des bornes, contrôle, raccourcis.</summary>
public class PeriodesTests
{
    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "rentabilite", "tests", "cas", "01_periodes.json"));
    private static DateOnly? Date(JsonNode? n) => n is null ? null : DateOnly.Parse(n.GetValue<string>());
    private static string? Texte(DateOnly? d) => d?.ToString("yyyy-MM-dd");

    [Fact]
    public void Identiques_au_js()
    {
        var j = Jeu();
        var reference = DateOnly.Parse(j["reference"]!.GetValue<string>());
        foreach (var c in j["lectures"]!.AsArray())
        {
            var nom = c!["nom"]!.GetValue<string>();
            var r = Periodes.Lire(c["texte"]!.GetValue<string>(), c["borne"]!.GetValue<string>(), reference);
            Assert.True(c["attendu"]!["date"]?.GetValue<string>() == Texte(r.Date), nom);
            Assert.True(c["attendu"]!["erreur"]?.GetValue<string>() == r.Erreur, nom);
        }
        foreach (var c in j["controles"]!.AsArray())
            Assert.True(c!["attendu"]?.GetValue<string>() == Periodes.Controler(Date(c["du"]), Date(c["au"])), c["nom"]!.GetValue<string>());
        foreach (var c in j["raccourcis"]!.AsArray())
        {
            var r = Periodes.Raccourci(c!["code"]!.GetValue<string>(), reference)!.Value;
            Assert.Equal(c["attendu"]!["du"]?.GetValue<string>(), Texte(r.Du));
            Assert.Equal(c["attendu"]!["au"]?.GetValue<string>(), Texte(r.Au));
        }
    }
}
