using LogiBTP.Api.Reprise;
using LogiBTP.Fiches;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Reprise, lot 5 : nom des colonnes « x_ » tiré du libellé d'une zone supplémentaire.</summary>
public class ChampsRepriseTests
{
    [Theory]
    [InlineData("Zone Sup 01", "x_zone_sup_01")]
    [InlineData("Poids (kg)", "x_poids_kg")]
    [InlineData("Date du contrôle technique", "x_date_du_controle_technique")]
    [InlineData("1er contact", "x_champ_1er_contact")]
    [InlineData("—", "x_champ_")]
    public void Nom_de_colonne(string libelle, string attendu)
    {
        var nom = ChampsReprise.Nom(libelle);
        if (attendu.EndsWith('_')) Assert.StartsWith(attendu, nom + "_");
        else Assert.Equal(attendu, nom);
        Assert.True(ChampsSupplementaires.NomValide(nom), nom);
    }

    [Fact]
    public void Nom_coupe_a_la_longueur_permise()
    {
        var nom = ChampsReprise.Nom(new string('a', 60));
        Assert.Equal(43, nom.Length);
        Assert.True(ChampsSupplementaires.NomValide(nom));
    }
}
