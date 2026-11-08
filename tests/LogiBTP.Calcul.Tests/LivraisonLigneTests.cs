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

    [Fact]
    public void Arc_inchange_sans_trace() =>
        Assert.Null(Structure.MotifArc("A1", new DateOnly(2026, 11, 2), new DateOnly(2026, 11, 20), "A1", new DateOnly(2026, 11, 2), new DateOnly(2026, 11, 20)));

    [Fact]
    public void Arc_modifie_trace_avant_apres()
    {
        var m = Structure.MotifArc(null, null, new DateOnly(2026, 11, 20), "AR-7", new DateOnly(2026, 11, 8), new DateOnly(2026, 11, 25));
        Assert.Equal("ARC numéro  -> AR-7 ; date  -> 2026-11-08 ; livraison 2026-11-20 -> 2026-11-25", m);
    }
}
