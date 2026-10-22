using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Planning.Tests;

/// <summary>Jeu partagé avec calcul.js : calcul des tâches (modes 1, 2, 3).</summary>
public class ReglesPlanningTests
{
    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "planning", "tests", "cas", "01_calcul.json"));

    private static List<(long, long)> Plages(JsonObject j, JsonNode? n) => n switch
    {
        null => [],
        JsonValue v => Plages(j, j["plages"]![v.GetValue<string>()]),
        _ => n.AsArray().Select(p => (Temps.VersMinutes(p![0]!.GetValue<string>()), Temps.VersMinutes(p[1]!.GetValue<string>()))).ToList(),
    };

    private static long? M(JsonNode? n) => n is null ? null : Temps.VersMinutes(n.GetValue<string>());

    [Fact]
    public void Calcul_identique_au_js()
    {
        var j = Jeu();
        foreach (var c in j["cas"]!.AsArray())
        {
            var nom = c!["nom"]!.GetValue<string>();
            var t = new TacheCalcul(c["mode"]!.GetValue<int>(), M(c["debut"])!.Value, M(c["fin"]), c["heures"]?.GetValue<int>(),
                (c["ressources"]?.AsArray() ?? []).Select(r => new RessourceCalcul(r!["cle"]!.GetValue<string>(), Plages(j, r["plages"]), r["capacite"]?.GetValue<bool>() ?? true)).ToList(),
                (c["absences"]?.AsArray() ?? []).Select(a => new AbsenceCalcul(a!["ressource"]!.GetValue<string>(), M(a["debut"])!.Value, M(a["fin"])!.Value)).ToList(),
                Plages(j, c["plages_defaut"]), c["nb_ressources"]?.GetValue<int>() ?? 1);
            var r = ReglesPlanning.Calculer(t);
            var a = c["attendu"]!;
            Assert.True(a["fin"]?.GetValue<string>() == (r.Fin is long f ? Temps.Ecrire(f) : null), $"{nom} : fin {(r.Fin is long g ? Temps.Ecrire(g) : "nulle")}");
            Assert.True(a["heures"]?.GetValue<int>() == r.Heures, $"{nom} : heures {r.Heures}");
            var par = a["par_ressource"]!.Deserialize<Dictionary<string, int>>()!;
            Assert.True(par.Count == r.ParRessource.Count && par.All(x => r.ParRessource.GetValueOrDefault(x.Key) == x.Value), $"{nom} : {JsonSerializer.Serialize(r.ParRessource)}");
            Assert.True(a["erreurs"]!.AsArray().Select(x => x!.GetValue<string>()).SequenceEqual(r.Erreurs), $"{nom} : {string.Join(",", r.Erreurs)}");
            if (a["ventilation"] is JsonArray v)
            {
                Assert.True(v.Select(x => (x!["date"]!.GetValue<string>(), x["minutes"]!.GetValue<int>())).SequenceEqual(r.Ventilation!.Select(x => (x.Date, x.Minutes))),
                    $"{nom} : {JsonSerializer.Serialize(r.Ventilation)}");
            }
        }
    }
}
