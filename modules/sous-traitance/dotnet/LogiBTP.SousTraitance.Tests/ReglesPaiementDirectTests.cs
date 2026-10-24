using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.SousTraitance.Tests;

/// <summary>Jeu partagé avec paiement-direct.js : montant, délai d'acceptation, acceptation et plafonds.</summary>
public class ReglesPaiementDirectTests
{
    private static decimal M(JsonNode? n) => decimal.Parse(n!.GetValue<string>(), CultureInfo.InvariantCulture);
    private static decimal? Mn(JsonNode? n) => n is null ? null : M(n);
    private static DateOnly J(JsonNode? n) => DateOnly.Parse(n!.GetValue<string>());

    [Fact]
    public void Paiement_direct_identique_au_js()
    {
        var j = CasPartages.Lire(CasPartages.Chemin("modules", "sous-traitance", "tests", "cas", "03_plafonds.json"));
        foreach (var c in j["montants"]!.AsArray())
        {
            Assert.Equal(M(c!["attendu"]), ReglesPaiementDirect.Montant(M(c["ht"]), M(c["ttc"]), c["autoliquidation"]!.GetValue<bool>()));
        }
        foreach (var c in j["delais"]!.AsArray())
        {
            var r = ReglesPaiementDirect.Delai(J(c!["recue_le"]), J(c["aujourdhui"]));
            var a = c["attendu"]!;
            Assert.True(r == new DelaiAcceptation(J(a["echeance"]), a["depasse"]!.GetValue<bool>(), a["alerte"]!.GetValue<bool>()), $"délai {c["recue_le"]}");
        }
        foreach (var c in j["acceptations"]!.AsArray())
        {
            var nom = c!["nom"]!.GetValue<string>();
            var r = ReglesPaiementDirect.Controler(M(c["demande"]), M(c["accepte"]), M(c["cumul_precedent"]), Mn(c["montant_agree"]), c["motif"]?.GetValue<string>());
            var a = c["attendu"]!;
            Assert.True(a["etat"]!.GetValue<string>() == r.Etat && M(a["cumul"]) == r.Cumul && Mn(a["reste_agree"]) == r.ResteAgree, $"{nom} : {r}");
            Assert.True(a["erreurs"]!.AsArray().Select(x => x!.GetValue<string>()).SequenceEqual(r.Erreurs), $"{nom} : erreurs");
        }
    }
}
