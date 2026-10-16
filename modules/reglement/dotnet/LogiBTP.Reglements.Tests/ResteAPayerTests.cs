using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Reglements.Tests;

/// <summary>Jeu partagé avec reste.js : échéances, pièces, non pointé, proposition de pointage.</summary>
public class ResteAPayerTests
{
    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "reglement", "tests", "cas", "01_reste.json"));

    private static decimal Dec(JsonNode? n) => decimal.Parse(n!.GetValue<string>(), CultureInfo.InvariantCulture);

    [Fact]
    public void Echeances_identiques_au_js()
    {
        foreach (var c in Jeu()["echeances"]!.AsArray())
        {
            var e = ResteAPayer.Echeance(Dec(c!["montant"]), Dec(c["pointe"]), Dec(c["seuil"]));
            Assert.Equal(Dec(c["attendu"]!["reste"]), e.Reste);
            Assert.Equal(c["attendu"]!["reglee"]!.GetValue<bool>(), e.Reglee);
        }
    }

    [Fact]
    public void Pieces_identiques_au_js()
    {
        foreach (var c in Jeu()["pieces"]!.AsArray())
        {
            var p = ResteAPayer.Piece(c!["echeances"]!.AsArray().Select(e => (Dec(e!["montant"]), Dec(e["pointe"]))), Dec(c["seuil"]));
            var a = c["attendu"]!;
            Assert.Equal((Dec(a["montant"]), Dec(a["pointe"]), Dec(a["reste"]), a["statut"]!.GetValue<string>()), (p.Montant, p.Pointe, p.Reste, p.Statut));
        }
    }

    [Fact]
    public void Non_pointes_identiques_au_js()
    {
        foreach (var c in Jeu()["non_pointes"]!.AsArray())
        {
            Assert.Equal(Dec(c!["attendu"]), ResteAPayer.NonPointe(Dec(c["montant"]), c["pointages"]!.AsArray().Select(p => Dec(p!["montant"]))));
        }
    }

    [Fact]
    public void Propositions_identiques_au_js()
    {
        foreach (var c in Jeu()["propositions"]!.AsArray())
        {
            var echeances = c!["echeances"]!.AsArray().Select(e => new EcheanceAPointer(e!["id"]!.GetValue<long>(),
                e["date"] is JsonNode d ? DateOnly.Parse(d.GetValue<string>(), CultureInfo.InvariantCulture) : null, Dec(e["reste"])));
            var attendu = c["attendu"]!.AsArray().Select(p => new PointagePropose(p!["id"]!.GetValue<long>(), Dec(p["montant"]))).ToList();
            Assert.Equal(attendu, ResteAPayer.Proposer(Dec(c["disponible"]), echeances));
        }
    }
}
