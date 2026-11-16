using LogiBTP.Api.Reprise;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Règles de la reprise de la structure (plan reprise-mde-optim, lot 9).</summary>
public class StructureRepriseTests
{
    [Theory]
    [InlineData(null, 0)]
    [InlineData(-5.0, 0)]
    [InlineData(0.15, 0.15)]
    [InlineData(1.0, 1)]
    [InlineData(62.5, 0.625)]
    public void Pourcentage_en_fraction(double? valeur, double attendu) =>
        Assert.Equal((decimal)attendu, StructureReprise.Fraction(valeur is null ? null : (decimal)valeur.Value));

    [Theory]
    [InlineData("En cours", false, false)]
    [InlineData("Terminé", true, false)]
    [InlineData("Réception faite", true, false)]
    [InlineData("Soldée", false, true)]
    [InlineData("Clôturé", false, true)]
    [InlineData(null, false, false)]
    public void Etat_d_apres_le_libelle(string? libelle, bool termine, bool clos) =>
        Assert.Equal((termine, clos), StructureReprise.EtatDe(libelle));

    [Theory]
    [InlineData("Obtenu", StructureReprise.StatutProjet.Obtenu)]
    [InlineData("Gagné", StructureReprise.StatutProjet.Obtenu)]
    [InlineData("Refusé", StructureReprise.StatutProjet.Perdu)]
    [InlineData("Abandonné", StructureReprise.StatutProjet.Abandonne)]
    [InlineData("Offre remise", StructureReprise.StatutProjet.Remis)]
    [InlineData("À l'étude", StructureReprise.StatutProjet.EnCours)]
    [InlineData(null, StructureReprise.StatutProjet.EnCours)]
    public void Statut_du_projet_d_apres_le_libelle(string? libelle, string attendu) =>
        Assert.Equal(attendu, StructureReprise.StatutProjetDe(libelle));

    [Fact]
    public void Statut_du_chantier()
    {
        Assert.Equal(StructureReprise.StatutChantier.Clos, StructureReprise.StatutChantierDe(false, true, null));
        Assert.Equal(StructureReprise.StatutChantier.Termine, StructureReprise.StatutChantierDe(true, false, null));
        Assert.Equal(StructureReprise.StatutChantier.Termine, StructureReprise.StatutChantierDe(false, false, new DateOnly(2024, 6, 30)));
        Assert.Equal(StructureReprise.StatutChantier.Ouvert, StructureReprise.StatutChantierDe(false, false, null));
    }
}
