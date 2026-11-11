using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Comptabilite.Tests;

/// <summary>Jeu partagé avec tva.js : catégorie EN 16931 et VATEX proposés par le comportement.</summary>
public class ReglesTvaTests
{
    [Fact]
    public void Proposition_identique_au_js()
    {
        var j = CasPartages.Lire(CasPartages.Chemin("modules", "comptabilite", "tests", "cas", "05_tva_en16931.json"));
        foreach (var c in j["cas"]!.AsArray())
        {
            var r = ReglesTva.Proposer(c!["comportement"]!.GetValue<string>());
            var a = c["attendu"];
            if (a is null) { Assert.Null(r); continue; }
            Assert.True(new PropositionEn16931(a["categorie"]!.GetValue<string>(), a["vatex"]?.GetValue<string>()) == r, c["nom"]!.GetValue<string>());
            Assert.Contains(r!.Categorie, CategorieEn16931.Toutes);
        }
    }

    [Fact]
    public void Autoliquidation_donne_AE_et_VATEX_FR_AE()
    {
        var r = ReglesTva.Proposer("A")!;
        Assert.Equal("AE", r.Categorie);
        Assert.Equal("VATEX-FR-AE", r.Vatex);
    }
}
