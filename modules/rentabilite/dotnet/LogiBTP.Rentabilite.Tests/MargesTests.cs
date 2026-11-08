using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Rentabilite.Tests;

/// <summary>Jeu partagé avec marge.js : marge d'un chantier avec produit interne.</summary>
public class MargesTests
{
    private static decimal D(JsonNode? n) => decimal.Parse(n!.GetValue<string>(), CultureInfo.InvariantCulture);
    private static string? T(decimal? t) => t?.ToString("0.00", CultureInfo.InvariantCulture);

    [Fact]
    public void Identiques_au_js()
    {
        var j = CasPartages.Lire(CasPartages.Chemin("modules", "rentabilite", "tests", "cas", "03_marge_produit_interne.json"));
        foreach (var c in j["marges"]!.AsArray())
        {
            var nom = c!["nom"]!.GetValue<string>();
            var a = c["attendu"]!;
            var m = Marges.Chantier(D(c["lignes"]), D(c["produit_interne"]), D(c["pa"]), D(c["pr"]));
            Assert.True(D(a["produit"]) == m.Produit && D(a["brute"]) == m.Brute && D(a["nette"]) == m.Nette, nom);
            Assert.True(a["taux_brute"]?.GetValue<string>() == T(m.TauxBrute) && a["taux_nette"]?.GetValue<string>() == T(m.TauxNette), nom);
        }
    }
}
