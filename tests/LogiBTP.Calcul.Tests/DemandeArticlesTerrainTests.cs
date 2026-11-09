using LogiBTP.Api.Btp;
using LogiBTP.Documents;
using LogiBTP.Socle.Web;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Articles de la bibliothèque simplifiée dans la demande d'approvisionnement (plan terrain-suites, lot 18 ; TS15 a).</summary>
public class DemandeArticlesTerrainTests
{
    [Fact]
    public void Ligne_E_DAP_portant_l_article()
    {
        var a = new TerrainBtp.ArticleDemande(42, "VIS6", "Vis 6 x 60", "Vis 6 &times; 60", 3.5m, "bt", 7);
        var l = TerrainBtp.LigneArticleDemande(100, 2, a, 5);
        Assert.Equal(TL.Element, l.LigTylId);
        Assert.Equal(42, l.LigArtId);
        Assert.Equal("VIS6", l.LigCode);
        Assert.Equal("Vis 6 &times; 60", l.LigLibelleHtml);
        Assert.Equal(3.5m, l.LigQte);
        Assert.Equal("bt", l.LigUntCode);
        Assert.Equal(7, l.LigNatId);
        Assert.Equal(5, l.LigTvaId);
        Assert.Equal(0, l.LigPa);
        Assert.Equal(100, l.LigEntId);
        Assert.Equal(2, l.LigOrdre);
    }

    [Fact]
    public void Unite_de_l_article_seulement()
    {
        Assert.Equal("bt", TerrainBtp.UniteDemande(null, "u", "bt", null, []));
        Assert.Equal("u", TerrainBtp.UniteDemande(" ", "u", null, null, []));
        Assert.Equal("pal", TerrainBtp.UniteDemande("pal", "m2", null, null, ["pal"]));
        Assert.Equal("m2", TerrainBtp.UniteDemande("m2", "m2", "pal", null, []));
        var e = Assert.Throws<ExceptionMetier>(() => TerrainBtp.UniteDemande("kg", "m2", "pal", "m2", ["rl"]));
        Assert.Equal("TERRAIN_DEMANDE_UNITE", e.Code);
    }
}
