using System.Text.Json;
using LogiBTP.Api.Btp;
using LogiBTP.Domaine;
using LogiBTP.Socle;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Éditions des tranches à quantité et des variables du document (plan metres-tranches-document, lot 6) :
/// quantité et PU d'une tranche imprimés quand la quantité n'est pas 1, montants des lignes égaux à ceux du moteur,
/// variables $$ du document dans les données de l'édition.
/// </summary>
public class EditionTrancheTests
{
    private static ResultatCalcul Calculer(string fichier) => MoteurDevisBtp.Calculer(
        CasPartages.Lire(Path.Combine(CasPartages.Chemin(["tests", "cas"]), fichier))["entree"]
            .Deserialize<EntreeCalcul>(JsonCalcul.Options)!);

    [Fact]
    public void Tranche_a_quantite_imprime_qte_et_pu()
    {
        var r = Calculer("26_metre_document.json");
        var lignes = SourceDocumentEdition.LignesImprimees(r, r.Lignes.ToDictionary(l => l.LigId));
        var tranche = lignes.Single(o => o!["lig_id"]!.GetValue<long>() == 2)!;
        Assert.Equal(2m, tranche["qte"]!.GetValue<decimal>());
        Assert.Equal(2m, tranche["qte_tranche"]!.GetValue<decimal>());
        var montant = tranche["montant"]!.GetValue<decimal>();
        Assert.Equal(montant, tranche["pu"]!.GetValue<decimal>() * 2);
        // Ligne sans tranche : pas de quantité de tranche.
        Assert.Null(lignes.Single(o => o!["lig_id"]!.GetValue<long>() == 1)!["qte_tranche"]);
        // Les montants imprimés des lignes comptées font le total du moteur.
        Assert.Equal(r.Document.EntTotalHt, lignes.Where(o => o!["compte_total"]!.GetValue<bool>()).Sum(o => o!["montant"]!.GetValue<decimal>()));
    }

    [Fact]
    public void Tranche_sans_quantite_n_imprime_ni_qte_ni_pu()
    {
        var r = Calculer("15_ensemble_tranche_parametree.json");
        var lignes = SourceDocumentEdition.LignesImprimees(r, r.Lignes.ToDictionary(l => l.LigId));
        Assert.All(lignes.Where(o => o!["type"]!.GetValue<string>() == "TITRE"), t =>
        {
            Assert.Null(t!["qte"]);
            Assert.Null(t["pu"]);
            Assert.Null(t["qte_tranche"]);
        });
    }

    [Fact]
    public void Variables_du_document_dans_les_donnees()
    {
        var v = SourceDocumentEdition.VariablesDocument(Calculer("26_metre_document.json"));
        // Surface : écrite par le métré du document puis réécrite par la définition $$ de la grille (évaluée après).
        Assert.Equal(160m, v["Surface"]!.GetValue<decimal>());
        Assert.True(v.ContainsKey("Hsp"));
    }
}
