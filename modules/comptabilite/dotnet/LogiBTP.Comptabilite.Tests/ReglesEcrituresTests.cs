using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Comptabilite.Tests;

/// <summary>Jeu modules/comptabilite/tests/cas/03_ecritures.json : écriture d'une pièce (règle du serveur seul).</summary>
public class ReglesEcrituresTests
{
    private static string? Texte(JsonNode? n) => n?.GetValue<string>();
    private static decimal Nombre(JsonNode? n) => n?.GetValue<decimal>() ?? 0;
    private static DateOnly? Date(JsonNode? n) => n is null ? null : DateOnly.Parse(n.GetValue<string>());

    private static PieceComptable Piece(JsonObject b) => new(
        1, Texte(b["journal"])!, Date(b["date"])!.Value, Texte(b["numero"])!, Texte(b["reference"]), Texte(b["libelle"])!, Texte(b["sens"])!,
        b["signe"]!.GetValue<int>(), Texte(b["collectif"]), Texte(b["compte_tiers"]),
        b["lignes"]!.AsArray().Select(l => new LignePiece(Texte(l!["compte"]), Texte(l["taux"]), Nombre(l["montant"]), Texte(l["erreur"]))).ToList(),
        b["postes_ht"]!.AsArray().Select(x => new PostePiece(Texte(x!["libelle"])!, Texte(x["compte"]), Nombre(x["montant"]))).ToList(),
        b["postes_ttc"]!.AsArray().Select(x => new PostePiece(Texte(x!["libelle"])!, Texte(x["compte"]), Nombre(x["montant"]), Texte(x["auxiliaire"]),
            x["acompte"]?.GetValue<bool>() ?? false)).ToList(),
        b["tva"]!.AsArray().Select(t => new TvaPiece(Texte(t!["taux"])!, Nombre(t["taux_pct"]), Nombre(t["base"]), Nombre(t["montant"]), Texte(t["comportement"])!,
            Texte(t["exigibilite"])!, Texte(t["compte_collectee"]), Texte(t["compte_encaissement"]), Texte(t["compte_deductible"]), Texte(t["compte_autoliquidee"]))).ToList(),
        b["echeances"]!.AsArray().Select(e => new EcheancePiece(Date(e!["date"]), Nombre(e["montant"]), e["retenue"]!.GetValue<bool>())).ToList(),
        Nombre(b["total_ttc"]), Texte(b["compte_retenue"]), Texte(b["compte_defaut"]), Texte(b["compte_ecart_debit"]), Texte(b["compte_ecart_credit"]),
        Texte(b["analytique"]));

    [Fact]
    public void Ecritures_du_jeu()
    {
        var j = CasPartages.Lire(CasPartages.Chemin("modules", "comptabilite", "tests", "cas", "03_ecritures.json"));
        foreach (var c in j["cas"]!.AsArray())
        {
            var b = j["base"]!.DeepClone().AsObject();
            foreach (var (k, v) in c!["piece"]!.AsObject()) b[k] = v?.DeepClone();
            var r = ReglesEcritures.Ecrire(Piece(b));
            var a = c["attendu"]!;
            Assert.True(a["erreurs"]!.AsArray().Select(e => e!.GetValue<string>()).SequenceEqual(r.Erreurs), $"{c["nom"]} : {string.Join(", ", r.Erreurs)}");
            foreach (var e in r.Erreurs) Assert.True(ReglesEcritures.Messages.ContainsKey(e), e);
            if (a["lignes"] is not JsonArray attendues) continue;
            var obtenues = r.Lignes.Select(l => $"{l.Compte}|{l.Auxiliaire}|{l.Debit:0.00}|{l.Credit:0.00}").ToList();
            var voulues = attendues.Select(l => $"{Texte(l![0])}|{Texte(l[1])}|{Nombre(l[2]):0.00}|{Nombre(l[3]):0.00}").ToList();
            Assert.True(voulues.SequenceEqual(obtenues), $"{c["nom"]} :\n{string.Join("\n", obtenues)}");
            Assert.Equal(r.Lignes.Sum(l => l.Debit), r.Lignes.Sum(l => l.Credit));
        }
    }
}
