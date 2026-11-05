using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Stock.Tests;

/// <summary>Jeu partagé avec tracabilite.js : répartition d'une ligne entre ses lots, date limite proposée, stock par lot.</summary>
public class ReglesTracabiliteTests
{
    private static readonly JsonObject Jeu = CasPartages.Lire(CasPartages.Chemin("modules", "stock", "tests", "cas", "05_tracabilite.json"));
    private static decimal? Dec(JsonNode? n) => n is null ? null
        : decimal.TryParse(n.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : null;
    private static string? Txt(JsonNode? n) => n?.GetValue<string>();
    private static DateOnly? Date(JsonNode? n) => n is null ? null : DateOnly.Parse(n.GetValue<string>(), CultureInfo.InvariantCulture);
    private static long? Lot(JsonNode? n) => n?.GetValue<long>();

    [Fact]
    public void Repartition_identique_au_js()
    {
        foreach (var c in Jeu["repartitions"]!.AsArray())
        {
            var lots = c!["lots"]!.AsArray().Select(l => new LotReparti(Txt(l!["numero"]), Dec(l["quantite"]))).ToList();
            var r = ReglesTracabilite.Repartir(Dec(c["quantite"])!.Value, lots, Txt(c["suivi"])!);
            var a = c["attendu"]!;
            var nom = c["nom"]!.ToString();
            Assert.Equal(a["parts"]!.AsArray().Select(p => $"{p!["numero"]}|{Dec(p["quantite"])}"), r.Parts.Select(p => $"{p.Numero}|{p.Quantite}"));
            Assert.True(r.SansLot == Dec(a["sans_lot"]), $"{nom} : sans lot {r.SansLot}");
            Assert.Equal(a["erreurs"]!.AsArray().Select(e => $"{e!["code"]}|{e["index"]}"), r.Erreurs.Select(e => $"{e.Code}|{e.Index}"));
            Assert.Equal(a["avertissements"]!.AsArray().Select(e => e!["code"]!.ToString()), r.Avertissements);
            foreach (var e in r.Erreurs.Select(e => e.Code).Concat(r.Avertissements)) Assert.True(ReglesTracabilite.Messages.ContainsKey(e), e);
        }
    }

    [Fact]
    public void Date_limite_identique_au_js()
    {
        foreach (var c in Jeu["dates"]!.AsArray())
        {
            var a = c!["article"]!;
            var r = ReglesTracabilite.DateLimite(new PeremptionArticle(a["perissable"]!.GetValue<bool>(), a["duree"]?.GetValue<int>(), Txt(a["unite"])!),
                Date(c["fabrication"]), Date(c["reception"]));
            Assert.True(r == Date(c["attendu"]), $"{c["nom"]} : {r}");
        }
    }

    [Fact]
    public void Stock_par_lot_identique_au_js()
    {
        foreach (var c in Jeu["stocks"]!.AsArray())
        {
            List<QuantiteLot> Lire(string cle) => c![cle]!.AsArray().Select(x => new QuantiteLot(Txt(x!["date"])!, Dec(x["quantite"])!.Value, Lot(x["lot"]))).ToList();
            var r = ReglesTracabilite.StockParLot(Lire("mouvements"), Lire("comptages"), Txt(c!["t"])!);
            Assert.Equal(c["attendu"]!.AsArray().Select(x => $"{x!["lot"]}|{Dec(x["quantite"])}"), r.Select(x => $"{x.Lot}|{x.Quantite}"));
        }
    }
}
