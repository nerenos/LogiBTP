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

    [Fact]
    public void Imputations_identiques_au_js()
    {
        foreach (var c in Jeu()["imputations"]!.AsArray())
        {
            Assert.Equal(Dec(c!["attendu"]), ResteAPayer.MaximumImputation(Dec(c["disponible"]), Dec(c["reste"])));
        }
    }

    private static JsonObject JeuCautions() => CasPartages.Lire(CasPartages.Chemin("modules", "reglement", "tests", "cas", "02_cautions.json"));

    private static DateOnly? Date(JsonNode? n) => n is null ? null : DateOnly.Parse(n.GetValue<string>(), CultureInfo.InvariantCulture);

    private static long? Long(JsonNode? n) => n is null ? null : n.GetValue<long>();

    [Fact]
    public void Consommations_de_cautions_identiques_au_js()
    {
        foreach (var c in JeuCautions()["consommations"]!.AsArray())
        {
            var cautions = c!["cautions"]!.AsArray().Select(x => new CautionRetenue(x!["id"]!.GetValue<long>(), Long(x["objet"]), Date(x["date"]), Dec(x["montant"]), Date(x["mainlevee"]))).ToList();
            var retenues = c["retenues"]!.AsArray().Select(x => new RetenueACouvrir(x!["id"]!.GetValue<long>(), Long(x["objet"]), Date(x["date_piece"]), Dec(x["montant"]))).ToList();
            var r = ResteAPayer.ConsommerCautions(cautions, retenues);
            var a = c["attendu"]!;
            Assert.Equal(a["allocations"]!.AsArray().Select(x => new AllocationCaution(x!["caution"]!.GetValue<long>(), x["retenue"]!.GetValue<long>(), Dec(x["montant"]))).ToList(), r.Allocations);
            Assert.Equal(a["retenues"]!.AsArray().Select(x => new RetenueCouverte(x!["id"]!.GetValue<long>(), Dec(x["cautionne"]), Dec(x["retenu"]))).ToList(), r.Retenues);
            Assert.Equal(a["cautions"]!.AsArray().Select(x => new CautionConsommee(x!["id"]!.GetValue<long>(), Dec(x["consomme"]), Dec(x["disponible"]))).ToList(), r.Cautions);
        }
    }

    [Fact]
    public void Exigibles_identiques_au_js()
    {
        foreach (var c in JeuCautions()["exigibles"]!.AsArray())
        {
            Assert.Equal(Dec(c!["attendu"]), ResteAPayer.ExigibleCaution(Dec(c["cautionne"]), Dec(c["pointe"]), Dec(c["reste"])));
        }
    }
}
