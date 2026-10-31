using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Socle.Tests;

/// <summary>Dictionnaire des textes (jeu partagé socle/tests/dictionnaire.json, comme resolution.js).</summary>
public class DictionnaireTests
{
    private static Dictionary<string, object?>? Valeurs(JsonNode? n) => n is JsonObject o
        ? o.ToDictionary(p => p.Key, p => p.Value is JsonValue v && v.GetValueKind() == JsonValueKind.Number ? (object?)v.GetValue<decimal>() : p.Value?.GetValue<string>())
        : null;

    [Fact]
    public void Jeu_partage()
    {
        var jeu = CasPartages.Lire(CasPartages.Chemin("socle", "tests", "dictionnaire.json"));
        var d = new Dictionnaire(jeu["dictionnaire"]!.AsObject());
        foreach (var c in jeu["cas"]!.AsArray().Select(c => c!))
        {
            var nom = c["nom"]!.GetValue<string>();
            var cle = c["cle"]?.GetValue<string>();
            switch (c["operation"]!.GetValue<string>())
            {
                case "texte":
                    Assert.True(c["attendu"]!.GetValue<string>() == d.Texte(cle!, Valeurs(c["valeurs"]), c["defaut"]?.GetValue<string>()), nom);
                    break;
                case "pluriel":
                    Assert.True(c["attendu"]!.GetValue<string>() == d.Pluriel(cle!, c["nombre"]!.GetValue<decimal>(), Valeurs(c["valeurs"])), nom);
                    break;
                case "erreur":
                    Assert.Throws<InvalidOperationException>(() => d.Texte(cle!));
                    break;
                case "fusion":
                    var obtenu = Dictionnaire.Fusionner([.. c["couches"]!.AsArray()]);
                    Assert.True(JsonNode.DeepEquals(c["attendu"], obtenu), $"{nom} : {obtenu.ToJsonString()}");
                    break;
                default:
                    throw new InvalidOperationException(nom);
            }
        }
        Assert.Equal("fr-FR", d.Langue);
    }
}
