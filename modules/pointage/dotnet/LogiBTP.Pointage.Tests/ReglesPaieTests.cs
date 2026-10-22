using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Pointage.Tests;

/// <summary>Jeu partagé avec paie.js : variables de paie d'une semaine, contrôle des profils.</summary>
public class ReglesPaieTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "pointage", "tests", "cas", "03_paie.json"));

    private static (List<RubriquePaie>, List<ReglePaie>) Profil(JsonObject j, JsonNode c)
    {
        var p = c["profil"] is JsonValue v ? j["profils"]![v.GetValue<string>()]! : c;
        return (p["rubriques"]!.Deserialize<List<RubriquePaie>>(Json)!, p["regles"]!.Deserialize<List<ReglePaie>>(Json)!);
    }

    private static Dictionary<string, int> Dico(JsonNode? n) => n?.Deserialize<Dictionary<string, int>>(Json) ?? [];

    private static bool Egal(Dictionary<string, int> a, Dictionary<string, int> b) => a.Count == b.Count && a.All(x => b.TryGetValue(x.Key, out var v) && v == x.Value);

    [Fact]
    public void Paie_identique_au_js()
    {
        var j = Jeu();
        foreach (var c in j["calculs"]!.AsArray())
        {
            var nom = c!["nom"]!.GetValue<string>();
            var (rubriques, regles) = Profil(j, c);
            var jours = c["jours"]!.Deserialize<List<JourPaie>>(Json)!.Select(x => x with { Pointages = x.Pointages ?? [] }).ToList();
            var r = ReglesPaie.Calculer(rubriques, regles, jours, c["semaine_complete"]?.GetValue<bool>() ?? true);
            var a = c["attendu"]!;
            var aj = a["jours"]!.AsArray();
            Assert.True(aj.Count == r.Jours.Count, nom);
            for (var i = 0; i < aj.Count; i++)
            {
                Assert.True(aj[i]!["date"]!.GetValue<string>() == r.Jours[i].Date && Egal(Dico(aj[i]!["valeurs"]), r.Jours[i].Valeurs),
                    $"{nom} : jour {i} {JsonSerializer.Serialize(r.Jours[i].Valeurs)}");
            }
            Assert.True(Egal(Dico(a["semaine"]), r.Semaine), $"{nom} : semaine {JsonSerializer.Serialize(r.Semaine)}");
            Assert.True(Egal(Dico(a["totaux"]), r.Totaux), $"{nom} : totaux {JsonSerializer.Serialize(r.Totaux)}");
        }
        foreach (var c in j["controles"]!.AsArray())
        {
            var (rubriques, regles) = Profil(j, c!);
            var obtenu = ReglesPaie.ControlerProfil(rubriques, regles);
            Assert.True(c["attendu"]!.AsArray().Select(x => x!.GetValue<string>()).SequenceEqual(obtenu), c["nom"]!.GetValue<string>());
        }
        Assert.Equal(7.5m, ReglesPaie.QuantiteExport("H", 450));
        Assert.Equal(1.67m, ReglesPaie.QuantiteExport("H", 100));
    }
}
