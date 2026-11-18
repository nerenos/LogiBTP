using LogiBTP.Api.Reprise;
using LogiBTP.Domaine;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Règles de la reprise des achats et de la sous-traitance (plan reprise-mde-optim, lot 12).</summary>
public class AchatsRepriseTests
{
    private static PieceSource Piece(string type, decimal total) => new()
    {
        Origine = ("t", "1"), TypeDocument = type, Date = new DateOnly(2024, 1, 1), Statut = PiecesReprise.Statut.Envoye, TotalHt = total, TotalTtc = total * 1.2m,
        Lignes = [SourcesAchats.Element("1", 3, null, "Retour", 1, total, null, total, null, null, null, null)],
    };

    [Fact]
    public void Avoir_negatif_rendu_positif()
    {
        var p = SourcesAchats.Signe(Piece(TypesDocument.AAvoir, -50));
        Assert.Equal(50, p.TotalHt);
        Assert.Equal(60, p.TotalTtc);
        Assert.Equal(50, p.Lignes[0].Pa);
        Assert.Equal(50, p.Lignes[0].MontantHt);
    }

    [Fact]
    public void Facture_inchangee() => Assert.Equal(-50, SourcesAchats.Signe(Piece(TypesDocument.AFacture, -50)).TotalHt);

    [Theory]
    [InlineData(-20.0, TypesDocument.AAvoir)]
    [InlineData(20.0, TypesDocument.AFacture)]
    public void Regule_negative_en_avoir(double total, string attendu) =>
        Assert.Equal(attendu, SourcesAchats.TypeFactureOuAvoir(TypesDocument.AFacture, (decimal)total));

    [Theory]
    [InlineData(true, false, PiecesReprise.Statut.Brouillon)]
    [InlineData(false, false, PiecesReprise.Statut.Valide)]
    [InlineData(false, true, PiecesReprise.Statut.Envoye)]
    public void Statut_d_une_piece_d_achat(bool brouillon, bool facture, string attendu) => Assert.Equal(attendu, SourcesAchats.StatutDe(brouillon, facture));

    [Fact]
    public void Ligne_d_achat_au_prix_d_achat()
    {
        var l = SourcesAchats.Element("1", 3, "CIM", "Ciment", 20, 7, 10, 126, "U", null, 1, 8);
        Assert.Equal(7, l.Pa);
        Assert.Equal(1, l.CoefFg);
        Assert.Equal(0.9m, l.CoefRemise);
        Assert.Equal(8, l.ChantierId);
    }
}
