using LogiBTP.Api.Btp;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Rapprochement des pleins d'un fichier de cartes carburant (db/281, plan materiel-suites, lot 10, MO6).</summary>
public class PleinsCarburantTests
{
    private static readonly List<MaterielCarte> Materiels =
    [
        new(1, "7001 2345", "AA-123-AA", "H_KM"),
        new(2, null, "BB-456-BB", "KM"),
        new(3, "7001 2345", "CC-789-CC", "H"),
    ];

    [Fact]
    public void Plein_rapproche_par_carte_quand_un_seul_materiel_la_porte()
    {
        Assert.Equal(1, PleinsCarburantMateriel.Rapprocher("70012345", "AA-123-AA", [Materiels[0], Materiels[1]]));
    }

    [Fact]
    public void Carte_ambigue_ou_inconnue_retombe_sur_l_immatriculation()
    {
        Assert.Equal(3, PleinsCarburantMateriel.Rapprocher("7001 2345", "cc 789 cc", Materiels));
        Assert.Equal(2, PleinsCarburantMateriel.Rapprocher("9999", "bb-456-bb", Materiels));
    }

    [Fact]
    public void Plein_non_rapproche_sans_carte_ni_immatriculation_connues()
    {
        Assert.Null(PleinsCarburantMateriel.Rapprocher("9999", "ZZ-000-ZZ", Materiels));
        Assert.Null(PleinsCarburantMateriel.Rapprocher(null, null, Materiels));
    }
}
