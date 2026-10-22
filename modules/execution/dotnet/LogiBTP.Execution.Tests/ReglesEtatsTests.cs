using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Execution.Tests;

/// <summary>Jeu partagé avec etats.js : états des ordres, des services, contrôle des parcours.</summary>
public class ReglesEtatsTests
{
    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "execution", "tests", "cas", "01_etats.json"));

    private static List<EtapeParcours> Etapes(JsonObject j, JsonNode? n) => n switch
    {
        null => [],
        JsonValue v => Etapes(j, j["parcours"]![v.GetValue<string>()]),
        _ => n.AsArray().Select(e => new EtapeParcours(e!["code"]!.GetValue<string>(), e["srv_id"]?.GetValue<int>(),
            e["amonts"]?.AsArray().Select(a => a!.GetValue<string>()).ToList())).ToList(),
    };

    private static OrdreEvalue Ordre(JsonNode o) => new(o["srv_id"]?.GetValue<int>(), o["statut"]!.GetValue<string>(), o["etat"]?.GetValue<string>());

    [Fact]
    public void Etats_identiques_au_js()
    {
        var j = Jeu();
        foreach (var c in j["ordres"]!.AsArray())
        {
            Assert.True(c!["attendu"]?.GetValue<string>() == ReglesEtats.EtatOrdre(Ordre(c["ordre"]!)), c["nom"]!.GetValue<string>());
        }
        foreach (var c in j["services"]!.AsArray())
        {
            var nom = c!["nom"]!.GetValue<string>();
            var obtenu = ReglesEtats.EtatsServices(Etapes(j, c["parcours"]), c["ordres"]!.AsArray().Select(o => Ordre(o!)).ToList(),
                c["manuels"]!.AsArray().Select(m => new EtatManuel(m!["srv_id"]!.GetValue<int>(), m["etat"]!.GetValue<string>())).ToList());
            var attendu = c["attendu"]!.AsArray();
            Assert.True(attendu.Count == obtenu.Count, nom);
            for (var i = 0; i < attendu.Count; i++)
            {
                var a = attendu[i]!;
                Assert.True(new EtatService(a["srv_id"]!.GetValue<int>(), a["etat"]!.GetValue<string>(), a["automatique"]!.GetValue<string>(),
                    a["manuel"]?.GetValue<string>(), a["ecart"]!.GetValue<bool>()) == obtenu[i], $"{nom} : service {a["srv_id"]}");
            }
        }
        foreach (var c in j["controles"]!.AsArray())
        {
            var obtenu = ReglesEtats.ControlerParcours(Etapes(j, c!["etapes"]));
            Assert.True(c["attendu"]!.AsArray().Select(x => x!.GetValue<string>()).SequenceEqual(obtenu), c["nom"]!.GetValue<string>());
        }
    }
}
