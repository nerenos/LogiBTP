using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Planning.Tests;

/// <summary>Jeu partagé avec charge.js : capacité, planifié, disponible ; sur-occupation ; matériels par nombre.</summary>
public class ReglesChargeTests
{
    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "planning", "tests", "cas", "02_charge.json"));

    private static List<(long, long)> Plages(JsonObject j, JsonNode? n) => n switch
    {
        null => [],
        JsonValue v => Plages(j, j["plages"]![v.GetValue<string>()]),
        _ => n.AsArray().Select(p => (Temps.VersMinutes(p![0]!.GetValue<string>()), Temps.VersMinutes(p[1]!.GetValue<string>()))).ToList(),
    };

    private static long M(JsonNode? n) => Temps.VersMinutes(n!.GetValue<string>());

    [Fact]
    public void Charge_identique_au_js()
    {
        var j = Jeu();
        foreach (var c in j["cas"]!.AsArray())
        {
            var nom = c!["nom"]!.GetValue<string>();
            var r = ReglesCharge.Calculer(c["jours"]!.AsArray().Select(x => x!.GetValue<string>()).ToList(),
                c["ressources"]!.AsArray().Select(x => new RessourceCharge(x!["cle"]!.GetValue<string>(), x["srv_id"]?.GetValue<int>(), Plages(j, x["plages"]),
                    x["capacite"]?.GetValue<bool>() ?? true, x["quantite"]?.GetValue<decimal>())).ToList(),
                (c["absences"]?.AsArray() ?? []).Select(a => new AbsenceCalcul(a!["ressource"]!.GetValue<string>(), M(a["debut"]), M(a["fin"]))).ToList(),
                c["taches"]!.AsArray().Select(t => new TacheCharge(t!["cle"]!.GetValue<string>(), t["srv_id"]?.GetValue<int>(), M(t["debut"]), M(t["fin"]), t["heures"]!.GetValue<int>(),
                    t["affectations"]!.AsArray().Select(a => new AffectationCharge(a!["ressource"]!.GetValue<string>(), a["quantite"]?.GetValue<decimal>())).ToList(),
                    Plages(j, t["plages_service"]))).ToList());
            var a = c["attendu"]!;
            var s = a["services"]!.AsArray().Select(x => new ChargeService(x!["srv_id"]?.GetValue<int>(), x["date"]!.GetValue<string>(), x["capacite"]!.GetValue<int>(),
                x["planifie"]!.GetValue<int>(), x["disponible"]!.GetValue<int>())).ToList();
            Assert.True(s.SequenceEqual(r.Services), $"{nom} : {JsonSerializer.Serialize(r.Services)}");
            var su = a["surcharges"]!.AsArray().Select(x => $"{x!["ressource"]}|{x["date"]}|{x["capacite"]}|{x["planifie"]}|{string.Join(",", x["taches"]!.AsArray().Select(y => y!.GetValue<string>()))}");
            Assert.True(su.SequenceEqual(r.Surcharges.Select(x => $"{x.Ressource}|{x.Date}|{x.Capacite}|{x.Planifie}|{string.Join(",", x.Taches)}")), $"{nom} : {JsonSerializer.Serialize(r.Surcharges)}");
            var ma = a["materiels"]!.AsArray().Select(x => $"{x!["ressource"]}|{x["date"]}|{x["utilise"]!.GetValue<decimal>()}|{x["stock"]?.GetValue<decimal>()}");
            Assert.True(ma.SequenceEqual(r.Materiels.Select(x => $"{x.Ressource}|{x.Date}|{x.Utilise}|{x.Stock}")), $"{nom} : {JsonSerializer.Serialize(r.Materiels)}");
        }
    }
}
