using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Sav.Tests;

/// <summary>Jeu partagé avec garantie.js : numéro de série, fin et état de la garantie, contrôle d'un équipement.</summary>
public class ReglesGarantieTests
{
    private static readonly JsonObject Jeu = CasPartages.Lire(CasPartages.Chemin("modules", "sav", "tests", "cas", "01_garantie.json"));
    private static string? Txt(JsonNode? n) => n?.GetValue<string>();
    private static DateOnly? Date(JsonNode? n) => n is null ? null : DateOnly.ParseExact(n.GetValue<string>(), "yyyy-MM-dd", CultureInfo.InvariantCulture);
    private static string? Iso(DateOnly? d) => d?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    private static decimal? Dec(JsonNode? n) => n is null ? null : decimal.Parse(n.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture);
    private static int? Entier(JsonNode? n) => n?.GetValue<int>();

    [Fact]
    public void Numero_identique_au_js()
    {
        foreach (var c in Jeu["numeros"]!.AsArray())
            Assert.True(ReglesGarantie.Numero(Txt(c!["numero"])) == Txt(c["attendu"]), c["nom"]!.ToString());
    }

    [Fact]
    public void Fin_identique_au_js()
    {
        foreach (var c in Jeu["fins"]!.AsArray())
        {
            var r = ReglesGarantie.Fin(Date(c!["pose"]), Entier(c["duree_mois"]), Date(c["fin_saisie"]));
            Assert.True(Iso(r) == Txt(c["attendu"]), $"{c["nom"]} : {Iso(r)}");
        }
    }

    [Fact]
    public void Etat_identique_au_js()
    {
        foreach (var c in Jeu["etats"]!.AsArray())
        {
            var r = ReglesGarantie.Etat(Date(c!["pose"]), Entier(c["duree_mois"]), Date(c["fin_saisie"]), Date(c["date"])!.Value);
            var a = c["attendu"]!;
            var nom = c["nom"]!.ToString();
            Assert.True(r.Etat == Txt(a["etat"]), $"{nom} : {r.Etat}");
            Assert.True(Iso(r.Fin) == Txt(a["fin"]), $"{nom} : fin {Iso(r.Fin)}");
            Assert.True(r.JoursRestants == Entier(a["jours_restants"]), $"{nom} : {r.JoursRestants} jours");
        }
    }

    [Fact]
    public void Controle_identique_au_js()
    {
        foreach (var c in Jeu["controles"]!.AsArray())
        {
            var e = c!["equipement"]!;
            var r = ReglesGarantie.Controler(Txt(e["numero"]), e["article"]?.GetValue<long>(), Date(e["pose"]), Dec(e["duree_mois"]),
                Date(e["fin_saisie"]), Date(c["aujourdhui"])!.Value);
            Assert.Equal(c["attendu"]!.AsArray().Select(x => x!.GetValue<string>()), r);
            foreach (var code in r) Assert.True(ReglesGarantie.Messages.ContainsKey(code), code);
        }
    }
}
