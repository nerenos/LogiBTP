using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Crm.Tests;

/// <summary>Jeu partagé avec demandes.js : contrôle des demandes.</summary>
public class ReglesDemandeTests
{
    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "crm", "tests", "cas", "03_demandes.json"));

    [Fact]
    public void Demandes_identiques_au_js()
    {
        foreach (var c in Jeu()["demandes"]!.AsArray())
        {
            var d = c!["demande"]!;
            var demande = new DemandeAControler(d["objet"]?.GetValue<string>(), d["etat"]?.GetValue<string>(), d["motif"]?.GetValue<string>(),
                d["cible_type"]?.GetValue<string>(), d["cible_id"]?.GetValue<string>(),
                d["montant_estime"] is JsonNode m ? decimal.Parse(m.GetValue<string>(), CultureInfo.InvariantCulture) : null);
            var attendu = c["attendu"]!.AsArray().Select(x => x!.GetValue<string>()).ToList();
            Assert.True(attendu.SequenceEqual(ReglesDemande.Controler(demande)), c["nom"]!.GetValue<string>());
        }
    }
}
