using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.SousTraitance.Tests;

/// <summary>Jeu partagé avec ventilation.js : ventilation d'une facture reçue sur les lignes de la commande.</summary>
public class ReglesVentilationTests
{
    private static decimal M(JsonNode? n) => decimal.Parse(n!.GetValue<string>(), CultureInfo.InvariantCulture);

    [Fact]
    public void Ventilation_identique_au_js()
    {
        var j = CasPartages.Lire(CasPartages.Chemin("modules", "sous-traitance", "tests", "cas", "02_ventilation.json"));
        foreach (var c in j["cas"]!.AsArray())
        {
            var nom = c!["nom"]!.GetValue<string>();
            var r = ReglesVentilation.Ventiler(c["lignes"]!.AsArray().Select(l => new LigneVentilee(l!["id"]!.GetValue<long>(), M(l["marche"]), M(l["precedent"]))).ToList(),
                c["periode"] is null ? null : M(c["periode"]), c["cumul"] is null ? null : M(c["cumul"]));
            var a = c["attendu"]!;
            Assert.True(M(a["periode"]) == r.Periode, $"{nom} : période {r.Periode}");
            Assert.True(a["erreurs"]!.AsArray().Select(x => x!.GetValue<string>()).SequenceEqual(r.Erreurs), $"{nom} : erreurs");
            var lignes = a["lignes"]!.AsArray();
            Assert.True(lignes.Count == r.Lignes.Count, $"{nom} : lignes");
            for (var i = 0; i < lignes.Count; i++)
            {
                Assert.True(lignes[i]!["id"]!.GetValue<long>() == r.Lignes[i].Id && M(lignes[i]!["periode"]) == r.Lignes[i].Periode && M(lignes[i]!["cumul"]) == r.Lignes[i].Cumul,
                    $"{nom} : ligne {r.Lignes[i].Id} {r.Lignes[i].Periode} {r.Lignes[i].Cumul}");
            }
        }
    }
}
