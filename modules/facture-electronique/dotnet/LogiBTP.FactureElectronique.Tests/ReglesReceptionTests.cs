using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.FactureElectronique.Tests;

/// <summary>Jeu partagé avec js/src/reception.js (estFichierFacture) : fichier proposé comme facture reçue hors plateforme (lot 14).</summary>
public class ReglesReceptionTests
{
    private static readonly JsonObject Jeu = CasPartages.Lire(CasPartages.Chemin("modules", "facture-electronique", "tests", "cas", "03_fichiers_facture.json"));

    [Fact]
    public void Fichier_de_facture_comme_le_jeu_partage()
    {
        foreach (var c in Jeu["cas"]!.AsArray())
        {
            var attendu = c!["attendu"]!.GetValue<bool>();
            Assert.True(attendu == ReglesReception.EstFichierFacture(c["fichier"]?.GetValue<string>(), c["type"]?.GetValue<string>()), c["nom"]!.GetValue<string>());
        }
    }
}
