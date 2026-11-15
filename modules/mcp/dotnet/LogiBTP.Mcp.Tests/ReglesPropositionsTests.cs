using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Mcp.Tests;

/// <summary>Jeu partagé avec propositions.js : échéance, état affiché, contrôle d'une décision.</summary>
public class ReglesPropositionsTests
{
    private static readonly JsonObject Jeu = CasPartages.Lire(CasPartages.Chemin("modules", "mcp", "tests", "cas", "02_propositions.json"));

    private static IEnumerable<JsonObject> Cas(string nom) => Jeu[nom]!.AsArray().Select(c => c!.AsObject());

    private static DateOnly Date(JsonNode? n) => DateOnly.Parse(n!.GetValue<string>(), CultureInfo.InvariantCulture);

    private static string J(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    [Fact]
    public void Jeu_partage()
    {
        var fautes = new List<string>();
        foreach (var c in Cas("echeances"))
        {
            var obtenu = J(ReglesPropositions.EcheanceProposition(Date(c["aujourdhui"]), c["jours"]?.GetValue<int>()));
            if (obtenu != c["attendu"]!.GetValue<string>()) fautes.Add($"échéance « {c["nom"]} » : {obtenu}");
        }
        foreach (var c in Cas("etats"))
        {
            var obtenu = ReglesPropositions.EtatProposition(c["etat"]!.GetValue<string>(), Date(c["echeance"]), Date(c["aujourdhui"]));
            if (obtenu != c["attendu"]!.GetValue<string>()) fautes.Add($"état « {c["nom"]} » : {obtenu}");
        }
        foreach (var c in Cas("decisions"))
        {
            var p = c["proposition"]!;
            var d = c["decision"]!;
            var obtenu = ReglesPropositions.ControlerDecision(new PropositionAControler(p["etat"]?.GetValue<string>(), p["echeance"] is null ? null : Date(p["echeance"])),
                new DecisionSaisie(d["decision"]?.GetValue<string>(), d["motif"]?.GetValue<string>(), d["agent"]?.GetValue<bool>() ?? false,
                    d["usurpation"]?.GetValue<bool>() ?? false), Date(c["aujourdhui"]));
            var attendu = c["attendu"]!.AsArray().Select(x => x!.GetValue<string>()).ToList();
            if (!attendu.SequenceEqual(obtenu)) fautes.Add($"décision « {c["nom"]} » : [{string.Join(",", obtenu)}]");
        }
        Assert.True(fautes.Count == 0, string.Join("\n", fautes));
    }

    [Fact]
    public void Constantes_identiques_au_js()
    {
        var source = File.ReadAllText(CasPartages.Chemin("modules", "mcp", "js", "src", "propositions.js"));
        Assert.Contains($"export const ECHEANCE_PROPOSITION = {ReglesPropositions.EcheanceDefaut};", source);
        Assert.Contains($"export const ECHEANCE_PROPOSITION_MAX = {ReglesPropositions.EcheanceMax};", source);
    }
}
