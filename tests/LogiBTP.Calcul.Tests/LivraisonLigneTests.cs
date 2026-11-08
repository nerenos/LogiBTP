using LogiBTP.Api.Btp;
using LogiBTP.Domaine;
using LogiBTP.Socle.Web;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Date de livraison d'une ligne de commande validée (corrections de novembre, lot 7).</summary>
public class LivraisonLigneTests
{
    [Theory]
    [InlineData(TypesDocument.ACommande)]
    [InlineData(TypesDocument.TCommande)]
    public void Commande_validee_acceptee(string type) => Structure.ControlerLivraisonLigne(type, true);

    [Fact]
    public void Piece_d_un_autre_type_refusee()
    {
        var e = Assert.Throws<ExceptionMetier>(() => Structure.ControlerLivraisonLigne(TypesDocument.VCommande, true));
        Assert.Equal("LIVRAISON_TYPE", e.Code);
    }

    [Fact]
    public void Commande_non_validee_refusee()
    {
        var e = Assert.Throws<ExceptionMetier>(() => Structure.ControlerLivraisonLigne(TypesDocument.ACommande, false));
        Assert.Equal("LIVRAISON_NON_VALIDEE", e.Code);
    }
}
