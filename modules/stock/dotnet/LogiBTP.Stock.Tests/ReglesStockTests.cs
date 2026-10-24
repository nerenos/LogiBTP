using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Stock.Tests;

/// <summary>Jeux partagés avec stock.js et valorisation.js : stock à une date-heure, écart d'un comptage, valorisation.</summary>
public class ReglesStockTests
{
    private static JsonObject Jeu(string f) => CasPartages.Lire(CasPartages.Chemin("modules", "stock", "tests", "cas", f));
    private static decimal Dec(JsonNode n) => decimal.Parse(n.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture);
    private static decimal? DecN(JsonNode? n) => n is null ? null : Dec(n);
    private static string? Txt(JsonNode? n) => n?.GetValue<string>();

    [Fact]
    public void Stock_a_date_identique_au_js()
    {
        foreach (var c in Jeu("01_stock.json")["cas"]!.AsArray())
        {
            var m = c!["mouvements"]!.AsArray().Select(x => new MouvementQuantite(Txt(x!["date"])!, Dec(x["quantite"]!))).ToList();
            var k = c["comptages"]!.AsArray().Select(x => new ComptageQuantite(Txt(x!["date"])!, Dec(x["quantite"]!))).ToList();
            var r = ReglesStock.StockA(m, k, Txt(c["t"])!);
            var a = c["attendu"]!;
            Assert.True(r.Quantite == Dec(a["quantite"]!) && r.Comptage == Txt(a["comptage"]), $"{c["nom"]} : {r}");
            if (c["ecart"] is { } e)
            {
                var x = ReglesStock.Ecart(m, k, k[e["comptage"]!.GetValue<int>()]);
                var ae = e["attendu"]!;
                Assert.True(x.Avant == Dec(ae["avant"]!) && x.Compte == Dec(ae["compte"]!) && x.Ecart == Dec(ae["ecart"]!), $"{c["nom"]} : {x}");
            }
        }
    }

    [Fact]
    public void Valorisation_identique_au_js()
    {
        foreach (var c in Jeu("02_prix.json")["cas"]!.AsArray())
        {
            var m = c!["mouvements"]!.AsArray().Select(x => new MouvementValorise(x!["id"]!.GetValue<long>(), x["lieu"]!.GetValue<long>(), Txt(x["date"])!,
                Dec(x["quantite"]!), DecN(x["prix"]), x["provisoire"]?.GetValue<bool>() ?? false)).ToList();
            var k = c["comptages"]!.AsArray().Select(x => new ComptageLieu(x!["lieu"]!.GetValue<long>(), Txt(x["date"])!, Dec(x["quantite"]!))).ToList();
            var rv = c["reevaluations"]!.AsArray().Select(x => new Reevaluation(Txt(x!["date"])!, Dec(x["pmp"]!))).ToList();
            var r = ReglesValorisation.Valoriser(m, k, rv, Txt(c["date"]));
            var a = c["attendu"]!;
            var nom = c["nom"]!.ToString();
            Assert.True(r.Pmp == DecN(a["pmp"]), $"{nom} : pmp {r.Pmp}");
            Assert.True(r.DernierPa == DecN(a["dernier_pa"]) && r.DernierPaId == a["dernier_pa_id"]?.GetValue<long>()
                && r.DernierPaDate == Txt(a["dernier_pa_date"]) && r.Provisoire == a["provisoire"]!.GetValue<bool>(), $"{nom} : dernier PA {r}");
            Assert.True(r.Quantite == Dec(a["quantite"]!), $"{nom} : quantité {r.Quantite}");
            var h = a["historique"]!.AsArray();
            Assert.True(h.Count == r.Historique.Count && h.Select((x, i) => x!["id"]!.GetValue<long>() == r.Historique[i].Id && DecN(x["pmp"]) == r.Historique[i].Pmp).All(b => b),
                $"{nom} : historique");
            var u = ReglesValorisation.Valeur(r, c["methode"]!.GetValue<string>(), DecN(c["repli"]));
            Assert.True(u.Valeur == DecN(a["valeur"]) && u.Source == Txt(a["source"]) && u.Provisoire == (a["valeur_provisoire"]?.GetValue<bool>() ?? false), $"{nom} : valeur {u}");
        }
    }

    [Fact]
    public void Inventaire_identique_au_js()
    {
        static long? L(JsonNode? n) => n is null ? null : n.GetValue<long>();
        foreach (var c in Jeu("03_inventaire.json")["cas"]!.AsArray())
        {
            var lignes = c!["lignes"]!.AsArray().Select(x => new LigneInventaire(x!["bordereau"]!.GetValue<long>(), x["ele"]!.GetValue<long>(), L(x["emp"]),
                DecN(x["quantite"]), DecN(x["prix"]), x["appliquer_pmp"]!.GetValue<bool>(), Txt(x["commentaire"]))).ToList();
            var r = ReglesInventaire.Controler(lignes);
            var a = c["attendu"]!;
            var nom = c["nom"]!.ToString();
            var ac = a["comptages"]!.AsArray();
            Assert.True(ac.Count == r.Comptages.Count, $"{nom} : comptages");
            for (var i = 0; i < ac.Count; i++)
            {
                var x = ac[i]!;
                var o = r.Comptages[i];
                Assert.True(o.Ele == x["ele"]!.GetValue<long>() && o.Quantite == Dec(x["quantite"]!) && o.Prix == DecN(x["prix"]) && o.AppliquerPmp == x["appliquer_pmp"]!.GetValue<bool>()
                    && o.Commentaire == Txt(x["commentaire"]) && o.Lignes == x["lignes"]!.GetValue<int>(), $"{nom} : {o}");
            }
            Assert.Equal(a["avertissements"]!.AsArray().Select(x => $"{x!["code"]}|{x["ele"]}|{x["emp"]}|{x["nombre"]}"),
                r.Avertissements.Select(x => $"{x.Code}|{x.Ele}|{x.Emp}|{x.Nombre}"));
            Assert.Equal(a["erreurs"]!.AsArray().Select(x => $"{x!["code"]}|{x["ele"]}"), r.Erreurs.Select(x => $"{x.Code}|{x.Ele}"));
            foreach (var e in r.Erreurs) Assert.True(ReglesInventaire.Messages.ContainsKey(e.Code));
        }
    }
}
