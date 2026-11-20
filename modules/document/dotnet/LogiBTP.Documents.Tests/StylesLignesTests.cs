using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Documents.Tests;

/// <summary>Jeu partagé avec styles-lignes.js : classe d'une ligne, style résolu, validation des styles.</summary>
public class StylesLignesTests
{
    private static JsonNode Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "document", "tests", "styles", "01_styles_lignes.json"));

    public static TheoryData<string> Cas()
    {
        var data = new TheoryData<string>();
        foreach (var c in Jeu()["cas"]!.AsArray()) data.Add(c!["nom"]!.GetValue<string>());
        return data;
    }

    public static TheoryData<string> Validations()
    {
        var data = new TheoryData<string>();
        foreach (var c in Jeu()["validations"]!.AsArray()) data.Add(c!["nom"]!.GetValue<string>());
        return data;
    }

    private static JsonElement? Element(JsonNode? n) => n is null ? null : JsonDocument.Parse(n.ToJsonString()).RootElement.Clone();

    [Theory]
    [MemberData(nameof(Cas))]
    public void Styles_identiques_au_js(string nom)
    {
        var c = Jeu()["cas"]!.AsArray().First(x => x!["nom"]!.GetValue<string>() == nom)!;
        var lignes = c["lignes"]!.AsArray().Select(l => new DocumentLigne
        {
            LigId = l!["lig_id"]!.GetValue<long>(),
            LigParentId = l["lig_parent_id"]?.GetValue<long>(),
            LigTylId = l["lig_tyl_id"]!.GetValue<short>(),
            LigStyle = l["lig_style"] is { } s ? JsonDocument.Parse(s.ToJsonString()) : null,
        }).ToList();
        var x = c["contexte"]!;
        var contexte = new ContexteStyles(x["famille"]?.GetValue<string>(), x["type"]?.GetValue<string>(),
            x["styles"]!.AsArray().Select(s => new StyleParametre(s!["classe"]!.GetValue<string>(), s["famille"]?.GetValue<string>(),
                s["type"]?.GetValue<string>(), Element(s["valeur"])!.Value)).ToList(),
            Element(x["document"]));

        var classes = new JsonObject();
        foreach (var (id, cl) in StylesLignes.Classes(lignes)) classes[id.ToString()] = cl;
        Assert.True(JsonNode.DeepEquals(c["attendu"]!["classes"], classes), classes.ToJsonString());

        var styles = new JsonObject();
        foreach (var (id, st) in StylesLignes.Resolus(lignes, contexte)) styles[id.ToString()] = st.VersJson();
        Assert.True(JsonNode.DeepEquals(c["attendu"]!["styles"], styles), styles.ToJsonString());
    }

    [Theory]
    [MemberData(nameof(Validations))]
    public void Validation_identique_au_js(string nom)
    {
        var v = Jeu()["validations"]!.AsArray().First(x => x!["nom"]!.GetValue<string>() == nom)!;
        var attendu = v["attendu"]!.AsArray().Select(e => e!.GetValue<string>()).ToList();
        var obtenu = v["document"] is { } d ? StylesLignes.ErreursDocument(Element(d)) : StylesLignes.Erreurs(Element(v["style"]));
        Assert.Equal(attendu, obtenu);
    }
}
