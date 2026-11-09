using LogiBTP.Api.Btp;
using LogiBTP.Domaine;
using LogiBTP.Socle.Web;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Ordre saisi par son numéro sans réseau, résolu à l'envoi (plan terrain-suites, lot 10 ; TS11 a).</summary>
public class NumeroOrdreTerrainTests
{
    private static LigneTerrain Libre(string? numero, long? ent = null, int? cha = null) =>
        new(null, null, cha, ent, 3, null, 60, null, null, null, Numero: numero);

    [Fact]
    public void Numero_resolu_donne_l_ordre_et_son_chantier()
    {
        var l = TerrainBtp.ResoudreNumero(Libre("OP-12"), [new TerrainBtp.OrdreNumero(40, 7)]);
        Assert.Equal(40L, l.EntId);
        Assert.Equal(7, l.ChaId);
        Assert.Equal(7, l.Chantier);
    }

    [Fact]
    public void Numero_inconnu_ou_ambigu_refuse()
    {
        var e = Assert.Throws<ExceptionMetier>(() => TerrainBtp.ResoudreNumero(Libre("OP-99"), []));
        Assert.Equal(ErreursTerrain.OrdreInconnu, e.Code);
        Assert.Equal(ErreursTerrain.OrdreInconnu,
            Assert.Throws<ExceptionMetier>(() => TerrainBtp.ResoudreNumero(Libre("OP-1"), [new(1, 2), new(3, 4)])).Code);
    }

    [Fact]
    public void Ordre_deja_choisi_ou_ligne_existante_inchangee()
    {
        var choisie = Libre("OP-12", 5, 2);
        Assert.Same(choisie, TerrainBtp.ResoudreNumero(choisie, []));
        var existante = Libre("OP-12") with { Id = 9, ChaId = 2 };
        Assert.Same(existante, TerrainBtp.ResoudreNumero(existante, []));
        var sansNumero = Libre(null, null, 2);
        Assert.Same(sansNumero, TerrainBtp.ResoudreNumero(sansNumero, []));
    }

    [Fact]
    public void Numero_compare_sans_casse_ni_espaces()
    {
        Assert.Equal("OP-2026-12", TerrainBtp.NumeroNormalise(" op-2026 -12 "));
    }

    [Fact]
    public void Ligne_sans_chantier_refusee_a_l_enregistrement()
    {
        Assert.Equal("TERRAIN_CHANTIER", Assert.Throws<ExceptionMetier>(() => Libre(null).Chantier).Code);
    }
}
