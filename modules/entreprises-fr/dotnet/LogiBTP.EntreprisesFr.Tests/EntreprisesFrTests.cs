using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.EntreprisesFr.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.EntreprisesFr.Tests;

public class CorrespondanceTests
{
    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "entreprises-fr", "tests", "cas", "01_correspondance.json"));

    /// <summary>Jeu partagé avec correspondance.js : même entreprise (JSON snake_case identique).</summary>
    [Fact]
    public void Correspondance_identique_au_js()
    {
        var jeu = Jeu();
        var resultat = JsonSerializer.SerializeToElement(jeu["resultat"]);
        foreach (var c in jeu["cas"]!.AsArray())
        {
            var obtenu = JsonSerializer.SerializeToNode(Correspondance.VersEntreprise(resultat, c!["siret"]?.GetValue<string>()), JsonCalcul.Options);
            Assert.True(JsonNode.DeepEquals(c["attendu"], obtenu), $"{c["nom"]} : obtenu {obtenu!.ToJsonString()}");
        }
    }

    [Fact]
    public void Casse_des_noms_propres() => Assert.Equal("D'Artagnan-De La Tour", Correspondance.CasseNom("D'ARTAGNAN-DE LA TOUR"));
}
