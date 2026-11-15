using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Stock.Tests;

/// <summary>Jeu partagé avec ventilation.js : ventilation stock / commandes / achat d'une demande d'appro, réappro sous le mini.</summary>
public class ReglesVentilationTests
{
    private static readonly JsonObject Jeu = CasPartages.Lire(CasPartages.Chemin("modules", "stock", "tests", "cas", "07_ventilation.json"));
    private static decimal Dec(JsonNode n) => decimal.Parse(n.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture);
    private static decimal? DecN(JsonNode? n) => n is null ? null : Dec(n);
    private static string? Txt(JsonNode? n) => n?.GetValue<string>();
    private static string Nb(decimal? d) => d is { } x ? x.ToString("0.############################", CultureInfo.InvariantCulture) : "";

    [Fact]
    public void Ventilation_identique_au_js()
    {
        foreach (var c in Jeu["cas"]!.AsArray())
        {
            var besoins = c!["besoins"]!.AsArray().Select(b => new BesoinStock(Txt(b!["id"])!, Txt(b["article"])!, Dec(b["quantite"]!), Txt(b["date_besoin"])!, Txt(b["depot_prefere"]))).ToList();
            var depots = c["depots"]!.AsArray().Select(d => new DepotDisponible(Txt(d!["id"])!, d["articles"]!.AsArray().Select(a => new ArticleDuDepot(Txt(a!["article"])!, Dec(a["stock"]!), DecN(a["mini"]), DecN(a["maxi"]),
                a["evenements"]!.AsArray().Select(e => new EvenementPrevu(Txt(e!["id"])!, Txt(e["type"])!, Txt(e["date"])!, Dec(e["quantite"]!))).ToList())).ToList())).ToList();
            var commandes = c["commandes"]!.AsArray().Select(x => new CommandeARecevoir(Txt(x!["id"])!, Txt(x["article"])!, Dec(x["reste"]!), Txt(x["date_livraison"])!, Txt(x["fournisseur"]))).ToList();
            var articles = c["articles"]!.AsArray().Select(a => new ArticleFournisseur(Txt(a!["article"])!, Txt(a["fournisseur"]), Dec(a["conditionnement"]!))).ToList();
            var r = c["proche_mini"] is { } p
                ? ReglesVentilation.Ventiler(Txt(c["aujourdhui"])!, besoins, depots, commandes, articles, Dec(p))
                : ReglesVentilation.Ventiler(Txt(c["aujourdhui"])!, besoins, depots, commandes, articles);
            var a = c["attendu"]!;
            Assert.Equal(a["besoins"]!.AsArray().Select(b => $"{b!["id"]}|{b["article"]}|{Nb(Dec(b["quantite"]!))}|" + string.Join(";", b["parts"]!.AsArray()
                    .Select(x => $"{x!["nature"]}|{Txt(x["depot"])}|{Txt(x["commande"])}|{Txt(x["fournisseur"])}|{Nb(Dec(x["quantite"]!))}|{Nb(DecN(x["unites_achat"]))}"))),
                r.Besoins.Select(b => $"{b.Id}|{b.Article}|{Nb(b.Quantite)}|" + string.Join(";", b.Parts
                    .Select(x => $"{x.Nature}|{x.Depot}|{x.Commande}|{x.Fournisseur}|{Nb(x.Quantite)}|{Nb(x.UnitesAchat)}"))));
            Assert.Equal(a["reappros"]!.AsArray().Select(d => $"{d!["depot"]}>" + string.Join("/", d["fournisseurs"]!.AsArray().Select(f => $"{Txt(f!["fournisseur"])}:" + string.Join(";", f["lignes"]!.AsArray()
                    .Select(l => $"{l!["article"]}|{l["motif"]}|{Nb(Dec(l["disponible"]!))}|{Nb(DecN(l["mini"]))}|{Nb(DecN(l["maxi"]))}|{Nb(Dec(l["quantite"]!))}|{Nb(Dec(l["unites_achat"]!))}"))))),
                r.Reappros.Select(d => $"{d.Depot}>" + string.Join("/", d.Fournisseurs.Select(f => $"{f.Fournisseur}:" + string.Join(";", f.Lignes
                    .Select(l => $"{l.Article}|{l.Motif}|{Nb(l.Disponible)}|{Nb(l.Mini)}|{Nb(l.Maxi)}|{Nb(l.Quantite)}|{Nb(l.UnitesAchat)}"))))));
        }
    }
}
