using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Comptabilite.Tests;

/// <summary>Jeu partagé avec comptes.js : comptes généraux, comptes de tiers, propositions, classes.</summary>
public class ReglesComptesTests
{
    private static readonly JsonNode Jeu = CasPartages.Lire(CasPartages.Chemin("modules", "comptabilite", "tests", "cas", "01_comptes.json"));

    private static int? Entier(JsonNode? n) => n?.GetValue<int>();
    private static string? Texte(JsonNode? n) => n?.GetValue<string>();

    private static void Verifier(JsonNode c, ResultatCompte r)
    {
        var a = c["attendu"]!;
        Assert.True(new ResultatCompte(Texte(a["code"]), Texte(a["erreur"])) == r, $"{c["nom"]} : {r}");
        if (r.Erreur is string e) Assert.True(ReglesComptes.Messages.ContainsKey(e), e);
    }

    [Fact]
    public void Comptes_generaux_identiques_au_js()
    {
        foreach (var c in Jeu["generaux"]!.AsArray())
            Verifier(c!, ReglesComptes.Normaliser(Texte(c!["code"]), Entier(c["longueur"]), c["completer"]!.GetValue<bool>()));
    }

    [Fact]
    public void Comptes_de_tiers_identiques_au_js()
    {
        foreach (var c in Jeu["tiers"]!.AsArray()) Verifier(c!, ReglesComptes.NormaliserTiers(Texte(c!["code"]), Entier(c["longueur"])));
    }

    [Fact]
    public void Propositions_identiques_au_js()
    {
        foreach (var c in Jeu["propositions"]!.AsArray())
            Verifier(c!, ReglesComptes.Proposer(Texte(c!["prefixe"]), Texte(c["code_tiers"]), Entier(c["longueur"])));
    }

    [Fact]
    public void Classes_identiques_au_js()
    {
        foreach (var c in Jeu["classes"]!.AsArray()) Assert.Equal(Entier(c!["attendu"]), ReglesComptes.Classe(Texte(c["code"])));
    }
}
