using LogiBTP.Api.Reprise;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Règles de la reprise des pièces de vente (plan reprise-mde-optim, lot 10).</summary>
public class PiecesRepriseTests
{
    [Theory]
    [InlineData("Accepté", PiecesReprise.Statut.Valide)]
    [InlineData("Signé client", PiecesReprise.Statut.Valide)]
    [InlineData("Envoyé", PiecesReprise.Statut.Envoye)]
    [InlineData("Refusé", PiecesReprise.Statut.Envoye)]
    [InlineData("En cours", PiecesReprise.Statut.Brouillon)]
    [InlineData(null, PiecesReprise.Statut.Brouillon)]
    public void Statut_d_apres_le_libelle(string? libelle, string attendu) => Assert.Equal(attendu, PiecesReprise.StatutDe(libelle));

    [Theory]
    [InlineData(0, "A")]
    [InlineData(1, "A")]
    [InlineData(2, "B")]
    [InlineData(26, "Z")]
    [InlineData(27, "AA")]
    [InlineData(53, "BA")]
    public void Indice_de_version(int rang, string attendu) => Assert.Equal(attendu, PiecesReprise.Indice(rang));

    [Theory]
    [InlineData("DC000012", 12)]
    [InlineData("DEV-0005-B", 5)]
    [InlineData("FAC2024/0042", 42)]
    [InlineData("SANS", null)]
    [InlineData(null, null)]
    public void Rang_du_numero_source(string? numero, int? attendu) => Assert.Equal(attendu, PiecesReprise.RangDe(numero));

    [Theory]
    [InlineData(30L, "J", (short)30)]
    [InlineData(2L, "S", (short)14)]
    [InlineData(3L, "M", (short)90)]
    [InlineData(1L, "A", (short)365)]
    public void Validite_en_jours(long nombre, string periode, short attendu) => Assert.Equal(attendu, SourcesPieces.ValiditeJours(nombre, periode));

    [Fact]
    public void Validite_absente_ou_aberrante() => Assert.Null(SourcesPieces.ValiditeJours(0, "J"));

    [Theory]
    [InlineData(1.0, 2)]
    [InlineData(12.5, 2)]
    [InlineData(0.125, 3)]
    [InlineData(0.0000001, 2)]
    [InlineData(1.123456, 6)]
    public void Precision_de_la_quantite(double qte, short attendu) => Assert.Equal(attendu, SourcesPieces.Precision((decimal)qte));
}
