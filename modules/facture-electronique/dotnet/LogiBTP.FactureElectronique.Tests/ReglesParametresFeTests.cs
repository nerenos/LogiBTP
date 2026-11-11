using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.FactureElectronique.Web;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.FactureElectronique.Tests;

/// <summary>Jeu partagé avec js/ui/modeles.js (controlerParametres) : contrôle des paramètres avant l'enregistrement.</summary>
public class ReglesParametresFeTests
{
    private static readonly JsonObject Jeu = CasPartages.Lire(CasPartages.Chemin("modules", "facture-electronique", "tests", "cas", "02_parametres.json"));
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

    [Fact]
    public void Controle_des_parametres()
    {
        var connecteurs = Jeu["connecteurs"]!.AsArray().Select(x => x!.GetValue<string>()).ToList();
        var n = 0;
        foreach (var c in Jeu["cas"]!.AsArray())
        {
            var p = Jeu["base"]!.DeepClone().AsObject();
            foreach (var (cle, valeur) in c!["modif"]!.AsObject()) p[cle] = valeur?.DeepClone();
            var dto = p.Deserialize<ParametresFeDto>(Json)!;
            var attendu = c["attendu"]!.AsArray().Select(x => x!.GetValue<string>()).ToList();
            Assert.True(attendu.SequenceEqual(ReglesParametresFe.Controler(dto, connecteurs)),
                $"{c["nom"]} : {string.Join(", ", ReglesParametresFe.Controler(dto, connecteurs))}");
            n++;
        }
        Assert.True(n >= 15);
        Assert.All(ReglesParametresFe.Messages.Keys, k => Assert.False(string.IsNullOrEmpty(ReglesParametresFe.Messages[k])));
    }
}
