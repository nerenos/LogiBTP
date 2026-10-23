using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Execution.Tests;

/// <summary>Jeu partagé avec etapes.js : dates prévisionnelles, validation, annulation, état déduit, contrôle des états d'un type.</summary>
public class ReglesEtapesTests
{
    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "execution", "tests", "cas", "02_etapes.json"));

    private static DateOnly? Date(JsonNode? n) => n is null ? null : DateOnly.Parse(n.GetValue<string>());

    private static EtapeOrdre Etape(JsonNode e) => new(e["code"]!.GetValue<string>(), e["nature"]?.GetValue<string>() ?? "TACHE",
        e["duree"]?.GetValue<decimal>() ?? 0, e["unite"]?.GetValue<string>() ?? "OUV",
        e["amonts"]?.AsArray().Select(a => a!.GetValue<string>()).ToList(), e["date_obligatoire"]?.GetValue<bool>() ?? false,
        e["controle"]?.GetValue<bool>() ?? false, e["controle_bloquant"]?.GetValue<bool>() ?? false, Date(e["valide_le"]), Date(e["controle_le"]),
        Date(e["prevu_impose"]));

    private static List<string> Textes(JsonNode? n) => n?.AsArray().Select(x => x!.GetValue<string>()).ToList() ?? [];

    private static List<EtapeOrdre> Liste(JsonObject j, JsonNode? valides, JsonNode? controles = null)
    {
        var v = Textes(valides);
        var c = Textes(controles);
        return j["liste"]!.AsArray().Select(e => Etape(e!) with
        {
            ValideLe = v.Contains(e!["code"]!.GetValue<string>()) ? new DateOnly(2026, 11, 2) : null,
            ControleLe = c.Contains(e["code"]!.GetValue<string>()) ? new DateOnly(2026, 11, 2) : null,
        }).ToList();
    }

    [Fact]
    public void Etapes_identiques_au_js()
    {
        var j = Jeu();
        foreach (var c in j["dates"]!.AsArray())
        {
            var nom = c!["nom"]!.GetValue<string>();
            var cal = c["calendrier"] is JsonObject o
                ? new CalendrierEtapes(o["semaine"]?.AsArray().Select(x => x!.GetValue<int>()).ToList(),
                    o["jours"]?.AsObject().ToDictionary(kv => DateOnly.Parse(kv.Key), kv => kv.Value!.GetValue<int>()))
                : null;
            var obtenu = ReglesEtapes.Dates(c["etapes"]!.AsArray().Select(e => Etape(e!)).ToList(), DateOnly.Parse(c["debut"]!.GetValue<string>()), cal);
            var attendu = c["attendu"]!.AsArray().Select(a => new DatesEtape(a!["code"]!.GetValue<string>(), DateOnly.Parse(a["debut"]!.GetValue<string>()),
                DateOnly.Parse(a["prevu"]!.GetValue<string>()))).ToList();
            Assert.True(attendu.SequenceEqual(obtenu), $"{nom} : {string.Join(", ", obtenu)}");
        }
        foreach (var c in j["validations"]!.AsArray())
        {
            var nom = c!["nom"]!.GetValue<string>();
            var r = ReglesEtapes.AValider(Liste(j, c["valides"], c["controles"]), c["code"]!.GetValue<string>());
            var a = c["attendu"]!;
            Assert.True(Textes(a["codes"]).SequenceEqual(r.Codes), $"{nom} : codes");
            Assert.True(Textes(a["erreurs"]).SequenceEqual(r.Erreurs), $"{nom} : erreurs");
            Assert.True(Textes(a["avertissements"]).SequenceEqual(r.Avertissements), $"{nom} : avertissements");
        }
        foreach (var c in j["annulations"]!.AsArray())
        {
            Assert.True(Textes(c!["attendu"]).SequenceEqual(ReglesEtapes.ControlerAnnulation(Liste(j, c["valides"]), c["code"]!.GetValue<string>())),
                c["nom"]!.GetValue<string>());
        }
        foreach (var c in j["etats"]!.AsArray())
        {
            var nom = c!["nom"]!.GetValue<string>();
            var l = Liste(j, c["valides"]);
            Assert.True(c["attendu"]!.GetValue<string>() == ReglesEtapes.EtatExecution(l, c["actuel"]?.GetValue<string>()), $"{nom} : état");
            Assert.True(c["en_cours"]?.GetValue<string>() == ReglesEtapes.EnCours(l), $"{nom} : en cours");
        }
        var s = j["etat_sans_etape"]!;
        Assert.Equal(s["attendu"]!.GetValue<string>(), ReglesEtapes.EtatExecution([], s["actuel"]!.GetValue<string>()));
        foreach (var c in j["controles"]!.AsArray())
        {
            Assert.True(Textes(c!["attendu"]).SequenceEqual(ReglesEtapes.Controler(c["etapes"]!.AsArray().Select(e => Etape(e!) with
            {
                Nature = e!["nature"]?.GetValue<string>() ?? "",
                Unite = e["unite"]?.GetValue<string>() ?? "",
            }).ToList())), c["nom"]!.GetValue<string>());
        }
    }
}
