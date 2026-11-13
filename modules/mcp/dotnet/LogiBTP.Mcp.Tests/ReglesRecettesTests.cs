using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Mcp.Tests;

/// <summary>Jeu partagé avec recettes.js : marques du prompt, contrôle, recette permise, prompt rempli.</summary>
public class ReglesRecettesTests
{
    private static readonly JsonObject Jeu = CasPartages.Lire(CasPartages.Chemin("modules", "mcp", "tests", "cas", "03_recettes.json"));

    private static IEnumerable<JsonObject> Cas(string nom) => Jeu[nom]!.AsArray().Select(c => c!.AsObject());

    private static List<string> Liste(JsonNode? n) => n?.AsArray().Select(x => x!.GetValue<string>()).ToList() ?? [];

    /// <summary>Paramètres d'une recette du jeu.</summary>
    public static List<ParametreRecette> Parametres(JsonNode? n) => n?.AsArray().Select(p => new ParametreRecette(p!["nom"]?.GetValue<string>(),
        p["type"]?.GetValue<string>(), p["libelle"]?.GetValue<string>(), p["requis"]?.GetValue<bool>() ?? false)).ToList() ?? [];

    private static string? Valeur(JsonNode? n) => n is JsonValue v && v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : n?.ToJsonString();

    [Fact]
    public void Jeu_partage()
    {
        var fautes = new List<string>();
        var catalogue = Liste(Jeu["catalogue"]);
        foreach (var c in Cas("marques"))
        {
            var obtenu = ReglesRecettes.ParametresPrompt(c["prompt"]!.GetValue<string>());
            if (!obtenu.SequenceEqual(Liste(c["attendu"]))) fautes.Add($"marques « {c["nom"]} » : [{string.Join(",", obtenu)}]");
        }
        foreach (var c in Cas("controles"))
        {
            var r = c["recette"]!;
            var obtenu = ReglesRecettes.ControlerRecette(new RecetteSaisie(r["code"]?.GetValue<string>(), r["libelle"]?.GetValue<string>(), r["prompt"]?.GetValue<string>(),
                Parametres(r["parametres"]), Liste(r["outils"]), r["sortie"]?.GetValue<string>()), catalogue);
            if (!obtenu.SequenceEqual(Liste(c["attendu"]))) fautes.Add($"contrôle « {c["nom"]} » : [{string.Join(",", obtenu)}]");
        }
        foreach (var c in Cas("permises"))
        {
            var r = c["recette"]!;
            var obtenu = ReglesRecettes.RecettePermise(r["active"]?.GetValue<bool>() ?? true, Liste(r["outils"]), Liste(c["permis"]));
            if (obtenu != c["attendu"]!.GetValue<bool>()) fautes.Add($"permise « {c["nom"]} » : {obtenu}");
        }
        foreach (var c in Cas("remplissages"))
        {
            var r = c["recette"]!;
            var valeurs = c["valeurs"]!.AsObject().ToDictionary(kv => kv.Key, kv => Valeur(kv.Value));
            var obtenu = ReglesRecettes.RemplirPrompt(r["prompt"]?.GetValue<string>(), Parametres(r["parametres"]), valeurs);
            if (obtenu.Texte != c["attendu"]!["texte"]!.GetValue<string>() || !obtenu.Manquants.SequenceEqual(Liste(c["attendu"]!["manquants"])))
                fautes.Add($"remplissage « {c["nom"]} » : {obtenu.Texte} [{string.Join(",", obtenu.Manquants)}]");
        }
        Assert.True(fautes.Count == 0, string.Join("\n", fautes));
    }

    [Fact]
    public void Constantes_identiques_au_js()
    {
        var source = File.ReadAllText(CasPartages.Chemin("modules", "mcp", "js", "src", "recettes.js"));
        Assert.Contains($"export const LIBELLE_RECETTE_MAX = {ReglesRecettes.LibelleMax};", source);
        Assert.Contains($"export const PROMPT_RECETTE_MAX = {ReglesRecettes.PromptMax};", source);
        Assert.Contains($"export const VALEUR_PARAMETRE_MAX = {ReglesRecettes.ValeurMax};", source);
        Assert.Equal(500, ReglesRecettes.ValeurParametre(TypeParametreRecette.Texte, new string('x', 600)).Length);
    }
}
