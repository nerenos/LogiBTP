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

    private static readonly JsonObject JeuSousTraitance = CasPartages.Lire(CasPartages.Chemin("modules", "facture-electronique", "tests", "cas", "04_sous_traitance.json"));

    [Fact]
    public void Sous_traitance_comme_le_jeu_partage()
    {
        foreach (var c in JeuSousTraitance["cas"]!.AsArray())
        {
            var tva = c!["tva"]!.AsArray().Select(t => new TvaControlee(t!["categorie"]?.GetValue<string>(), t["vatex"]?.GetValue<string>())).ToList();
            var r = ReglesReception.ControlerSousTraitance(c["cadre"]?.GetValue<string>(), c["payeur"]!.GetValue<bool>(), tva, c["autoliquidation"]?.GetValue<bool>());
            var nom = c["nom"]!.GetValue<string>();
            Assert.True(c["paiement_direct"]!.GetValue<bool>() == r.PaiementDirect, nom);
            Assert.True(c["ecarts"]!.AsArray().Select(e => e!.GetValue<string>()).SequenceEqual(r.Ecarts), nom);
        }
    }

    [Fact]
    public void Exemple_S5_avec_payeur_lu_en_paiement_direct()
    {
        foreach (var nom in new[] { "S5_PAYEUR_EXTENDED-CTC-FR_CII.xml", "S5_PAYEUR_EXTENDED-CTC-FR_UBL.xml" })
        {
            var f = LogiBTP.FactureElectronique.Formats.Lecture.Lire(File.ReadAllBytes(CasPartages.Chemin("modules", "facture-electronique", "tests", "exemples", "logibtp", nom))).Facture;
            var r = ReglesReception.ControlerSousTraitance(f.CadreFacturation, f.Payeur is not null, ReglesReception.Ventilations(f), true);
            Assert.True(r.PaiementDirect, nom);
            Assert.Equal([EcartReception.AutoliquidationAbsente], r.Ecarts);
        }
    }
}
