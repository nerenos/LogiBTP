using LogiBTP.Api.Reprise;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Règles de la reprise de la bibliothèque (plan reprise-mde-optim, lot 8) : perte, remises des tarifs.</summary>
public class BibliothequeRepriseTests
{
    [Theory]
    [InlineData(null, "1")]
    [InlineData("0", "1")]
    [InlineData("0.05", "1.05")]
    [InlineData("1.1", "1.1")]
    [InlineData("5", "1.05")]
    public void Coefficient_de_perte(string? valeur, string attendu) =>
        Assert.Equal(decimal.Parse(attendu, System.Globalization.CultureInfo.InvariantCulture),
            BibliothequeReprise.CoefPerte(valeur is null ? null : decimal.Parse(valeur, System.Globalization.CultureInfo.InvariantCulture)));

    [Theory]
    [InlineData("0", null)]
    [InlineData("0.3", "30")]
    [InlineData("12.5", "12.5")]
    [InlineData("150", "100")]
    public void Remise_en_pourcentage(string valeur, string? attendu) =>
        Assert.Equal(attendu is null ? null : decimal.Parse(attendu, System.Globalization.CultureInfo.InvariantCulture),
            BibliothequeReprise.RemisePct(decimal.Parse(valeur, System.Globalization.CultureInfo.InvariantCulture)));
}
