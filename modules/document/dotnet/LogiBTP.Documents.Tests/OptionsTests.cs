using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Documents.Tests;

/// <summary>Jeu partagé avec options.js : unités d'options et de variantes, base des variantes.</summary>
public class OptionsTests
{
    private static JsonArray Lire() =>
        CasPartages.Lire(CasPartages.Chemin("modules", "document", "tests", "options", "01_unites.json"))["cas"]!.AsArray();

    public static TheoryData<string> Cas()
    {
        var data = new TheoryData<string>();
        foreach (var c in Lire()) data.Add(c!["nom"]!.GetValue<string>());
        return data;
    }

    [Theory]
    [MemberData(nameof(Cas))]
    public void Unites_identiques_au_js(string nom)
    {
        var c = Lire().First(x => x!["nom"]!.GetValue<string>() == nom)!;
        var lignes = c["lignes"]!.AsArray().Select(l => new DocumentLigne
        {
            LigId = l!["lig_id"]!.GetValue<long>(),
            LigParentId = l["lig_parent_id"]?.GetValue<long>(),
            LigTypePrix = l["lig_type_prix"]!.GetValue<string>(),
            LigVarianteDeId = l["lig_variante_de_id"]?.GetValue<long>(),
        }).ToList();
        var attendu = c["attendu"]!.AsArray()
            .Select(u => new UniteOption(u!["lig_id"]!.GetValue<long>(), u["type_prix"]!.GetValue<string>(), u["base_id"]?.GetValue<long>()))
            .ToList();
        Assert.Equal(attendu, Options.Unites(lignes));
    }
}
