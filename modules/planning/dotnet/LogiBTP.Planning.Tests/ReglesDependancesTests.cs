using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Planning.Tests;

/// <summary>Jeu partagé avec dependances.js : minimums, contrôles, propagation.</summary>
public class ReglesDependancesTests
{
    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "planning", "tests", "cas", "03_dependances.json"));

    private static string Texte(JsonNode? n) => n is JsonValue v && v.TryGetValue<int>(out var i) ? i.ToString() : n!.GetValue<string>();

    private static Dependance Dep(JsonNode d) => new(Texte(d["de"] ?? JsonValue.Create("A")), Texte(d["vers"] ?? JsonValue.Create("B")), d["type"]!.GetValue<string>(),
        d["decalage"]?.GetValue<int>() ?? 0, d["unite"]?.GetValue<string>() ?? "CAL", d["mode"]?.GetValue<string>() ?? "FIXE");

    [Fact]
    public void Dependances_identiques_au_js()
    {
        var j = Jeu();
        var ouvres = j["jours_ouvres"]!.AsArray().Select(x => x!.GetValue<string>()).ToList();
        foreach (var c in j["minimums"]!.AsArray())
        {
            var m = ReglesDependances.DebutMinimum(Dep(c!["dep"]!), Temps.VersMinutes(c["de"]!["debut"]!.GetValue<string>()), Temps.VersMinutes(c["de"]!["fin"]!.GetValue<string>()), ouvres);
            Assert.True(c["attendu"]?.GetValue<string>() == (m is long v ? Temps.Ecrire(v) : null), c["nom"]!.GetValue<string>());
        }
        foreach (var c in j["controles"]!.AsArray())
        {
            var r = ReglesDependances.Controler(c!["deps"]!.AsArray().Select(d => Dep(d!)).ToList());
            Assert.True(c["attendu"]!.AsArray().Select(x => x!.GetValue<string>()).SequenceEqual(r), $"{c["nom"]} : {string.Join(",", r)}");
        }
        foreach (var c in j["propagations"]!.AsArray())
        {
            var nom = c!["nom"]!.GetValue<string>();
            var r = ReglesDependances.Propager(
                c["taches"]!.AsArray().Select(t => new TacheDatee(t!["cle"]!.GetValue<string>(), Temps.VersMinutes(t["debut"]!.GetValue<string>()), Temps.VersMinutes(t["fin"]!.GetValue<string>()),
                    t["parent"]?.GetValue<string>())).ToList(),
                c["deps"]!.AsArray().Select(d => Dep(d!)).ToList(), ouvres);
            var a = c["attendu"]!;
            Assert.True(a["taches"]!.AsArray().Select(t => $"{t!["cle"]}|{t["debut"]}|{t["fin"]}").SequenceEqual(r.Taches.Select(t => $"{t.Cle}|{Temps.Ecrire(t.Debut)}|{Temps.Ecrire(t.Fin)}")), nom);
            Assert.True(a["alertes"]!.AsArray().Select(x => $"{x!["code"]}|{x["de"]}|{x["vers"]}|{x["tache"]}|{x["minimum"]}")
                .SequenceEqual(r.Alertes.Select(x => $"{x.Code}|{x.De}|{x.Vers}|{x.Tache}|{(x.Minimum is long m ? Temps.Ecrire(m) : "")}")), $"{nom} : alertes");
        }
    }
}
