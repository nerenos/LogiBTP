using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Import.Reprise;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Import.Tests;

/// <summary>Contrôle des fusions de doublons : mêmes cas que modules/import/js/test/fusions.test.js (fusions-cas.json).</summary>
public class FusionsRepriseTests
{
    public static TheoryData<string> Cas()
    {
        var d = new TheoryData<string>();
        foreach (var c in Lire()) d.Add((string)c!["nom"]!);
        return d;
    }

    private static JsonArray Lire() =>
        JsonNode.Parse(File.ReadAllText(CasPartages.Chemin("modules", "import", "js", "test", "fusions-cas.json")))!["cas"]!.AsArray();

    [Theory]
    [MemberData(nameof(Cas))]
    public void Parite_avec_le_js(string nom)
    {
        var c = Lire().First(x => (string)x!["nom"]! == nom)!;
        var groupes = c["groupes"].Deserialize<List<GroupeFusion>>()!;
        var attendues = c["erreurs"].Deserialize<List<ErreurGroupeFusion>>()!;
        Assert.Equal(attendues, FusionsReprise.Controler(groupes));
    }
}
