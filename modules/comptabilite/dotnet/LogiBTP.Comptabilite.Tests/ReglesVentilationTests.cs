using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Comptabilite.Tests;

/// <summary>Jeu partagé avec ventilation.js : compte d'une ligne par la règle de ventilation.</summary>
public class ReglesVentilationTests
{
    private static string? Texte(JsonNode? n) => n?.GetValue<string>();

    [Fact]
    public void Ventilation_identique_au_js()
    {
        var j = CasPartages.Lire(CasPartages.Chemin("modules", "comptabilite", "tests", "cas", "02_ventilation.json"));
        var p = j["parametrage"]!;
        var types = p["types"]!.AsArray().Select(t => new TypeVentilation(Texte(t!["code"])!, Texte(t["parent"]), Texte(t["compte_defaut"]))).ToList();
        var cles = p["cles"]!.AsArray().Select(c => new CleVentilation(Texte(c!["type"])!, Texte(c["nature"]), Texte(c["taux"]), Texte(c["compte"]))).ToList();
        foreach (var c in j["cas"]!.AsArray())
        {
            var e = c!["entree"]!;
            var a = c["attendu"]!;
            var r = ReglesVentilation.Compte(new EntreeVentilation(Texte(e["compte"]), Texte(e["nature"]), Texte(e["taux"]), Texte(e["type"])), types, cles);
            Assert.True(new ResultatVentilation(Texte(a["compte"]), Texte(a["origine"]), Texte(a["type"]), Texte(a["erreur"])) == r, $"{c["nom"]} : {r}");
            if (r.Erreur is string err) Assert.True(ReglesVentilation.Messages.ContainsKey(err), err);
            if (r.Origine is string o) Assert.True(ReglesVentilation.Origines.ContainsKey(o), o);
        }
    }
}
