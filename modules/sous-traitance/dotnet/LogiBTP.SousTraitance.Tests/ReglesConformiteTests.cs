using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.SousTraitance.Tests;

/// <summary>Jeu partagé avec conformite.js : états des pièces, conformité, pièces bloquantes, ajout de mois.</summary>
public class ReglesConformiteTests
{
    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "sous-traitance", "tests", "cas", "01_conformite.json"));

    private static DateOnly? Date(JsonNode? n) => n is null ? null : DateOnly.Parse(n.GetValue<string>());
    private static List<string> Textes(JsonNode? n) => n?.AsArray().Select(x => x!.GetValue<string>()).ToList() ?? [];

    [Fact]
    public void Conformite_identique_au_js()
    {
        var j = Jeu();
        var aujourdhui = DateOnly.Parse(j["aujourdhui"]!.GetValue<string>());
        var exigences = j["exigences"]!.AsArray().Select(e => new Exigence(e!["code"]!.GetValue<string>(), e["libelle"]!.GetValue<string>(),
            e["portee"]!.GetValue<string>(), e["categorie"]?.GetValue<string>(), e["obligatoire"]!.GetValue<bool>(), e["duree_mois"]?.GetValue<int>(),
            e["rappel_jours"]?.GetValue<int>() ?? 0, Textes(e["bloquant"]), e["cond_public"]?.GetValue<bool>(), e["cond_garantie"]?.GetValue<string>(),
            e["cond_montant_min"]?.GetValue<decimal>(), e["ordre"]?.GetValue<int>() ?? 0)).ToList();
        foreach (var c in j["cas"]!.AsArray())
        {
            var nom = c!["nom"]!.GetValue<string>();
            var ctx = c["contexte"]!;
            var r = ReglesConformite.Calculer(exigences,
                c["pieces"]!.AsArray().Select(p => new PieceFournie(p!["categorie"]!.GetValue<string>(), p["portee"]?.GetValue<string>(), p["dge_id"]?.GetValue<long>(),
                    Date(p["depose_le"]), Date(p["valide_au"]))).ToList(),
                c["ajustements"]!.AsArray().Select(a => new Ajustement(a!["code"]!.GetValue<string>(), a["mode"]!.GetValue<string>(), a["motif"]?.GetValue<string>())).ToList(),
                new ContexteMarche(ctx["public"]?.GetValue<bool>() ?? false, ctx["garantie"]?.GetValue<string>(), ctx["montant_ht"]?.GetValue<decimal>() ?? 0),
                aujourdhui, c["portees"] is JsonArray po ? Textes(po) : null);
            var a = c["attendu"]!;
            var pieces = a["pieces"]!.AsArray();
            Assert.True(pieces.Count == r.Pieces.Count, $"{nom} : nombre de pièces");
            for (var i = 0; i < pieces.Count; i++)
            {
                var x = pieces[i]!;
                var o = r.Pieces[i];
                Assert.True(x["code"]!.GetValue<string>() == o.Code && x["etat"]!.GetValue<string>() == o.Etat && Date(x["fin"]) == o.Fin
                    && x["obligatoire"]!.GetValue<bool>() == o.Obligatoire && x["dge_id"]?.GetValue<long>() == o.DgeId, $"{nom} : {o.Code} {o.Etat} {o.Fin}");
            }
            Assert.True(a["conforme"]!.GetValue<bool>() == r.Conforme, $"{nom} : conforme");
            Assert.True(Textes(a["a_echeance"]).SequenceEqual(r.AEcheance), $"{nom} : à échéance");
            foreach (var act in ReglesConformite.Actions) Assert.True(Textes(a["bloquants"]![act]).SequenceEqual(r.Bloquants[act]), $"{nom} : bloquants {act}");
        }
        foreach (var m in j["mois"]!.AsArray())
        {
            Assert.Equal(DateOnly.Parse(m!["attendu"]!.GetValue<string>()), ReglesConformite.AjouterMois(DateOnly.Parse(m["date"]!.GetValue<string>()), m["mois"]!.GetValue<int>()));
        }
    }
}
