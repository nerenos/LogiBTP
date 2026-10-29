using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Fiches.Tests;

/// <summary>Chrono des fiches : jeu partagé avec chrono.js (modules/fiche/tests/cas/02_chrono.json).</summary>
public class ChronoFicheTests
{
    private static JsonObject Jeu => CasPartages.Lire(CasPartages.Chemin("modules", "fiche", "tests", "cas", "02_chrono.json"));

    private static string? S(JsonNode? n, string cle) => n?[cle]?.GetValue<string>();
    private static int? I(JsonNode? n, string cle) => n?[cle]?.GetValue<int>();

    [Fact]
    public void Formater_identique_au_js()
    {
        foreach (var c in Jeu["formater"]!.AsArray())
            Assert.Equal(S(c, "attendu"), ChronoFiche.Formater(S(c, "format"), S(c, "prefixe"), I(c, "annee")!.Value, I(c, "rang")!.Value, S(c, "parent")));
    }

    [Fact]
    public void Lire_identique_au_js()
    {
        foreach (var c in Jeu["lire"]!.AsArray())
        {
            var lu = ChronoFiche.Lire(S(c, "format"), S(c, "prefixe"), S(c, "code"), S(c, "parent"));
            var attendu = c!["attendu"];
            Assert.True(attendu is null ? lu is null : lu == new CodeLu(I(attendu, "annee"), I(attendu, "rang")!.Value), S(c, "nom"));
        }
    }

    [Fact]
    public void Debut_identique_au_js()
    {
        foreach (var c in Jeu["debut"]!.AsArray())
            Assert.Equal(S(c, "attendu"), ChronoFiche.Debut(S(c, "format"), S(c, "prefixe"), I(c, "annee"), S(c, "parent")));
    }

    [Fact]
    public void Controler_identique_au_js()
    {
        foreach (var c in Jeu["controler"]!.AsArray())
            Assert.True((ChronoFiche.Controler(S(c, "format"), S(c, "raz")) is null) == c!["valide"]!.GetValue<bool>(), S(c, "nom"));
    }

    [Fact]
    public void Suivant_identique_au_js()
    {
        foreach (var c in Jeu["suivant"]!.AsArray()) Assert.Equal(S(c, "attendu"), ChronoFiche.Suivant(S(c, "code")));
    }
}
