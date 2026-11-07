using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Comptabilite.Tests;

/// <summary>Jeu modules/comptabilite/tests/cas/04_stock_compta.json : écritures de fin d'exercice du stock (règle du serveur seul).</summary>
public class ReglesStockComptaTests
{
    private static string? Texte(JsonNode? n) => n?.GetValue<string>();
    private static decimal Nombre(JsonNode? n) => n?.GetValue<decimal>() ?? 0;

    [Fact]
    public void Cloture_du_stock_du_jeu()
    {
        var j = CasPartages.Lire(CasPartages.Chemin("modules", "comptabilite", "tests", "cas", "04_stock_compta.json"));
        foreach (var c in j["cas"]!.AsArray())
        {
            var natures = c!["natures"]!.AsArray().Select(n => new StockNature(Texte(n!["nature"])!, Texte(n["compte_stock"]), Texte(n["compte_variation"]), Texte(n["compte_provision"]),
                Nombre(n["initial"]), Nombre(n["final"]), Nombre(n["provision_initiale"]), Nombre(n["provision_finale"]))).ToList();
            var comptes = new ComptesDepreciation(Texte(c["comptes"]!["dotation"]), Texte(c["comptes"]!["reprise"]));
            var r = ReglesStockCompta.Cloturer(natures, comptes);
            var a = c["attendu"]!;
            var nom = c["nom"]!.ToString();
            var lignes = a["lignes"]!.AsArray();
            Assert.True(lignes.Count == r.Lignes.Count && lignes.Select((l, i) => Texte(l!["compte"]) == r.Lignes[i].Compte && Nombre(l["montant"]) == r.Lignes[i].Montant).All(b => b),
                $"{nom} : lignes {string.Join(" ; ", r.Lignes.Select(l => $"{l.Compte} {l.Montant}"))}");
            Assert.True(a["erreurs"]!.AsArray().Select(e => e!.GetValue<string>()).SequenceEqual(r.Erreurs), $"{nom} : erreurs {string.Join(", ", r.Erreurs)}");
            foreach (var e in r.Erreurs) Assert.True(ReglesStockCompta.Messages.ContainsKey(e), e);
            foreach (var (code, l) in a["details"]!.AsObject())
                Assert.True(l!.AsArray().Select(x => x!.GetValue<string>()).SequenceEqual(r.Details[code]), $"{nom} : détail {code}");
            Assert.True(r.Details.Count == a["details"]!.AsObject().Count, $"{nom} : détails en trop");
            Assert.True(r.Lignes.Sum(l => l.Montant) == 0, $"{nom} : opération déséquilibrée");
        }
    }
}
