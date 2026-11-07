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
    public void Valorisation_a_date_identique_au_js()
    {
        foreach (var c in Jeu("06_valorisation_date.json")["cas"]!.AsArray())
        {
            var m = c!["mouvements"]!.AsArray().Select(x => new MouvementValorise(x!["id"]!.GetValue<long>(), x["lieu"]!.GetValue<long>(), Txt(x["date"])!,
                Dec(x["quantite"]!), DecN(x["prix"]), x["provisoire"]?.GetValue<bool>() ?? false)).ToList();
            var k = c["comptages"]!.AsArray().Select(x => new ComptageLieu(x!["lieu"]!.GetValue<long>(), Txt(x["date"])!, Dec(x["quantite"]!), DecN(x["prix"]))).ToList();
            var rv = c["reevaluations"]!.AsArray().Select(x => new Reevaluation(Txt(x!["date"])!, Dec(x["pmp"]!))).ToList();
            var r = ReglesValorisation.ValoriserEtat(m, k, rv, Txt(c["date"]), c["methode"]!.GetValue<string>(), DecN(c["repli"]));
            var a = c["attendu"]!;
            var nom = c["nom"]!.ToString();
            Assert.True(r.ValeurUnitaire == DecN(a["valeur_unitaire"]) && r.Source == Txt(a["source"]) && r.Provisoire == a["provisoire"]!.GetValue<bool>()
                && r.PrixInventaire == DecN(a["prix_inventaire"]), $"{nom} : valeur unitaire {r}");
            Assert.True(r.Quantite == Dec(a["quantite"]!) && r.Valeur == DecN(a["valeur"]) && r.ValeurInventaire == DecN(a["valeur_inventaire"]), $"{nom} : totaux {r}");
            var l = a["lieux"]!.AsArray();
            Assert.True(l.Count == r.Lieux.Count && l.Select((x, i) => x!["lieu"]!.GetValue<long>() == r.Lieux[i].Lieu && Dec(x["quantite"]!) == r.Lieux[i].Quantite
                && DecN(x["valeur"]) == r.Lieux[i].Valeur && DecN(x["valeur_inventaire"]) == r.Lieux[i].ValeurInventaire).All(b => b), $"{nom} : lieux");
        }
    }

    [Fact]
    public void Inventaire_identique_au_js()
    {
        static long? L(JsonNode? n) => n is null ? null : n.GetValue<long>();
        foreach (var c in Jeu("03_inventaire.json")["cas"]!.AsArray())
        {
            var lignes = c!["lignes"]!.AsArray().Select(x => new LigneInventaire(x!["bordereau"]!.GetValue<long>(), x["ele"]!.GetValue<long>(), L(x["emp"]),
                DecN(x["quantite"]), DecN(x["prix"]), x["appliquer_pmp"]!.GetValue<bool>(), Txt(x["commentaire"]), Txt(x["lot"]))).ToList();
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
                Assert.Equal(x["lots"]?.AsArray().Select(p => $"{p!["numero"]}|{Dec(p["quantite"]!)}") ?? [], o.Lots?.Select(p => $"{p.Numero}|{p.Quantite}") ?? []);
            }
            Assert.Equal(a["avertissements"]!.AsArray().Select(x => $"{x!["code"]}|{x["ele"]}|{x["emp"]}|{x["nombre"]}"),
                r.Avertissements.Select(x => $"{x.Code}|{x.Ele}|{x.Emp}|{x.Nombre}"));
            Assert.Equal(a["erreurs"]!.AsArray().Select(x => $"{x!["code"]}|{x["ele"]}"), r.Erreurs.Select(x => $"{x.Code}|{x.Ele}"));
            foreach (var e in r.Erreurs) Assert.True(ReglesInventaire.Messages.ContainsKey(e.Code));
        }
    }

    [Fact]
    public void Projection_identique_au_js()
    {
        var jeu = Jeu("04_projection.json");
        foreach (var c in jeu["projections"]!.AsArray())
        {
            var nom = c!["nom"]!.ToString();
            var evs = c["evenements"]!.AsArray().Select(x => new EvenementPrevu(Txt(x!["id"])!, Txt(x["type"])!, Txt(x["date"])!, Dec(x["quantite"]!))).ToList();
            var r = ReglesProjection.Projeter(Dec(c["stock"]!), Txt(c["aujourdhui"])!, evs);
            var a = c["attendu"]!;
            Assert.Equal(a["points"]!.AsArray().Select(x => $"{x!["date"]}|{Dec(x["entrees"]!)}|{Dec(x["sorties"]!)}|{Dec(x["disponible"]!)}"),
                r.Points.Select(x => $"{x.Date}|{x.Entrees}|{x.Sorties}|{x.Disponible}"));
            Assert.True(r.PremiereRupture == Txt(a["premiere_rupture"]) && r.Minimum.Date == Txt(a["minimum"]!["date"]) && r.Minimum.Disponible == Dec(a["minimum"]!["disponible"]!), $"{nom} : {r.PremiereRupture} {r.Minimum}");
            Assert.Equal(a["reservations"]!.AsArray().Select(x => $"{x!["id"]}|{x["date"]}|{Dec(x["demande"]!)}|{Dec(x["servi"]!)}|{Dec(x["manque"]!)}|{Txt(x["couverte_le"])}"),
                r.Reservations.Select(x => $"{x.Id}|{x.Date}|{x.Demande}|{x.Servi}|{x.Manque}|{x.CouverteLe}"));
            Assert.Equal(a["retards"]!.AsArray().Select(x => x!.ToString()), r.Retards);
            foreach (var m in c["minimum_jusqua"]!.AsArray())
                Assert.True(ReglesProjection.MinimumJusqua(r, Dec(c["stock"]!), Txt(m!["date"])!) == Dec(m["attendu"]!), $"{nom} : minimum au {m["date"]}");
        }
        foreach (var c in jeu["propositions"]!.AsArray())
        {
            var r = ReglesProjection.Proposer(DecN(c!["mini"]), DecN(c["maxi"]), Dec(c["disponible"]!), Dec(c["conditionnement"]!));
            var a = c["attendu"];
            Assert.True(a is null ? r is null : r is not null && r.Quantite == Dec(a["quantite"]!) && r.UnitesAchat == Dec(a["unites_achat"]!), $"{c["nom"]} : {r}");
        }
    }
}
