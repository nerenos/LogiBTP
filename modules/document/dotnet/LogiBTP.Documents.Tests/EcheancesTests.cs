using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Documents.Tests;

/// <summary>Jeu partagé avec echeances.js : bases NET / FIN_MOIS / JOUR, reste sur la dernière, retenue sans date.</summary>
public class EcheancesTests
{
    private static JsonArray Lire() =>
        CasPartages.Lire(CasPartages.Chemin("modules", "document", "tests", "echeances", "01_echeances.json"))["cas"]!.AsArray();

    public static TheoryData<string> Cas()
    {
        var data = new TheoryData<string>();
        foreach (var c in Lire()) data.Add(c!["nom"]!.GetValue<string>());
        return data;
    }

    private static decimal Dec(JsonNode? n) => decimal.Parse(n!.GetValue<string>(), CultureInfo.InvariantCulture);

    [Theory]
    [MemberData(nameof(Cas))]
    public void Echeances_identiques_au_js(string nom)
    {
        var c = Lire().First(x => x!["nom"]!.GetValue<string>() == nom)!;
        var lignes = c["lignes"]!.AsArray().Select(l => new LigneCondition(
            l!["pct"]!.GetValue<decimal>(), l["delai"]!.GetValue<int>(), l["base"]!.GetValue<string>(),
            l["jour"]?.GetValue<int>(), l["mode"]?.GetValue<string>())).ToList();
        var res = Echeances.Calculer(DateOnly.Parse(c["date"]!.GetValue<string>(), CultureInfo.InvariantCulture), Dec(c["montant"]),
            lignes, Dec(c["retenue"]), c["mode"]?.GetValue<string>());
        var attendu = c["attendu"]!.AsArray();
        Assert.Equal(attendu.Count, res.Count);
        for (var i = 0; i < res.Count; i++)
        {
            var a = attendu[i]!;
            Assert.Equal(a["rang"]!.GetValue<int>(), res[i].Rang);
            Assert.Equal(a["date"]?.GetValue<string>(), res[i].Date?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
            Assert.Equal(Dec(a["montant"]), res[i].Montant);
            Assert.Equal(a["mode"]?.GetValue<string>(), res[i].Mode);
            Assert.Equal(a["nature"]!.GetValue<string>(), res[i].Nature);
        }
    }
}
