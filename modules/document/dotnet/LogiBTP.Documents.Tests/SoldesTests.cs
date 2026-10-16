using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Documents.Tests;

/// <summary>Jeu partagé avec soldes.js : reste, ligne soldée, quantité à solder.</summary>
public class SoldesTests
{
    private static JsonArray Lire() =>
        CasPartages.Lire(CasPartages.Chemin("modules", "document", "tests", "soldes", "01_reste_solde.json"))["cas"]!.AsArray();

    public static TheoryData<string> Cas()
    {
        var data = new TheoryData<string>();
        foreach (var c in Lire()) data.Add(c!["nom"]!.GetValue<string>());
        return data;
    }

    private static decimal Dec(JsonNode? n) => decimal.Parse(n!.GetValue<string>(), System.Globalization.CultureInfo.InvariantCulture);

    [Theory]
    [MemberData(nameof(Cas))]
    public void Etat_identique_au_js(string nom)
    {
        var c = Lire().First(x => x!["nom"]!.GetValue<string>() == nom)!;
        var e = Soldes.Etat(Dec(c["qte_parent"]), Dec(c["transforme"]), Dec(c["solde"]), Dec(c["seuil_pct"]), Dec(c["seuil_qte"]), c["force"]!.GetValue<bool>());
        var a = c["attendu"]!;
        Assert.Equal(Dec(a["reste"]), e.Reste);
        Assert.Equal(a["soldee"]!.GetValue<bool>(), e.Soldee);
        Assert.Equal(Dec(a["a_solder"]), e.ASolder);
    }
}
