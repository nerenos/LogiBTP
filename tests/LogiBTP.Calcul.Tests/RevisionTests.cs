using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Domaine;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Jeu partagé avec client/src/app/structure/revision.js (client/test/revision.test.js).</summary>
public class RevisionTests
{
    private static readonly JsonObject J = CasPartages.Lire(CasPartages.Chemin("tests", "revision", "01_revision.json"));

    private static decimal? Dec(JsonNode? n) => n is null ? null : decimal.Parse(n.GetValue<string>(), CultureInfo.InvariantCulture);

    private static DateOnly? Mois(JsonNode? n) => n is null ? null : ReglesRevision.LireMois(n.GetValue<string>());

    private static FormuleRevision Formule(JsonNode f) => new(Dec(f["partie_fixe"])!.Value,
        f["termes"]!.AsArray().Select(t => new TermeRevision(t!["index"]!.GetValue<string>(), Dec(t["poids"])!.Value)).ToList(),
        f["precision"]?.GetValue<int>() ?? 3, f["arrondi"]?.GetValue<string>() ?? ArrondiRevision.Proche);

    private static Dictionary<string, SerieIndex> Series() => J["series"]!.AsObject().ToDictionary(x => x.Key, x => new SerieIndex(
        x.Value!["valeurs"]!.AsArray().Select(v => new ValeurIndex(Mois(v!["mois"])!.Value, Dec(v["valeur"])!.Value, v["provisoire"]?.GetValue<bool>() ?? false,
            v["base"]?.GetValue<string>())).ToList(),
        x.Value["raccordements"]?.AsObject().ToDictionary(r => r.Key, r => Dec(r.Value)!.Value)));

    private static string? MoisTexte(DateOnly? d) => d?.ToString("yyyy-MM", CultureInfo.InvariantCulture);

    [Fact]
    public void Formules_identiques_au_js()
    {
        foreach (var c in J["formules"]!.AsArray())
            Assert.Equal(c!["attendu"]!.AsArray().Select(x => x!.GetValue<string>()).ToList(), ReglesRevision.ControlerFormule(Formule(c["formule"]!)));
    }

    [Fact]
    public void Coefficients_identiques_au_js()
    {
        var series = Series();
        foreach (var c in J["coefficients"]!.AsArray())
        {
            var r = ReglesRevision.Coefficient(Formule(c!["formule"]!), series, Mois(c["mois_zero"])!.Value, Mois(c["mois_index"])!.Value);
            var a = c["attendu"]!;
            Assert.Equal(Dec(a["coef"]), r.Coef);
            Assert.Equal(a["provisoire"]!.GetValue<bool>(), r.Provisoire);
            Assert.Equal(a["manquants"]!.AsArray().Select(x => x!.GetValue<string>()).ToList(), r.Manquants);
        }
    }

    [Fact]
    public void Pieces_identiques_au_js()
    {
        var series = Series();
        foreach (var c in J["pieces"]!.AsArray())
        {
            var p = c!["parametres"]!;
            var parametres = new ParametresRevision(p["type_prix"]!.GetValue<string>(), Mois(p["mois_zero"]), Formule(p["formule"]!), p["decalage"]?.GetValue<int>() ?? 0,
                Mois(p["debut_travaux"]), p["actualisation_baisse"]?.GetValue<bool>() ?? false);
            var r = ReglesRevision.CoefficientPiece(parametres, series, Mois(c["mois_piece"])!.Value);
            Assert.Equal(Dec(c["attendu"]!["coef"]), r.Coef);
            Assert.Equal(c["attendu"]!["mois_index"]?.GetValue<string>(), MoisTexte(r.MoisIndex));
        }
    }

    [Fact]
    public void Regularisations_identiques_au_js()
    {
        foreach (var c in J["regularisations"]!.AsArray())
        {
            var periodes = c!["periodes"]!.AsArray().Select(p => new PeriodeRevision(p!["id"]!.GetValue<string>(), Dec(p["base"])!.Value, Dec(p["coef"]), Dec(p["deja"])!.Value)).ToList();
            var attendu = c["attendu"]!.AsArray().Select(a => new RevisionPeriode(a!["id"]!.GetValue<string>(), Dec(a["revision"])!.Value, Dec(a["a_facturer"])!.Value)).ToList();
            Assert.Equal(attendu, ReglesRevision.Regulariser(periodes, c["precision"]!.GetValue<int>()));
        }
    }

    [Fact]
    public void Erreurs_identiques_au_js() =>
        Assert.Empty(Constantes.Ecarts(CasPartages.Chemin("client", "src", "app", "structure", "revision.js"), "ERREUR_REVISION", typeof(ErreursRevision)));
}
