using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Xunit;

namespace LogiBTP.Socle.Tests;

/// <summary>Chiffrement des valeurs secrètes (AES-256-GCM, clé de l'installation) et lecture du fichier .env.</summary>
public class ChiffrementTests
{
    [Fact]
    public void Aller_retour_et_nonce_aleatoire()
    {
        var c = new Chiffrement("chaine-de-test");
        var a = c.Chiffrer("Mot de passe é€");
        Assert.StartsWith(Chiffrement.Prefixe, a);
        Assert.NotEqual(a, c.Chiffrer("Mot de passe é€"));
        Assert.Equal("Mot de passe é€", c.Dechiffrer(a));
        Assert.Equal("clair", c.Dechiffrer("clair"));
        Assert.Null(c.Chiffrer(null));
    }

    [Fact]
    public void Autre_cle_ou_sans_cle_refuse()
    {
        var a = new Chiffrement("une").Chiffrer("x");
        Assert.Throws<ErreurChiffrement>(() => new Chiffrement("autre").Dechiffrer(a));
        var sans = new Chiffrement(null);
        Assert.False(sans.EstConfigure);
        Assert.Throws<ErreurChiffrement>(() => sans.Chiffrer("x"));
    }

    [Fact]
    public void Lecture_env()
    {
        var v = ExtensionsConfiguration.LireEnv(["# commentaire", "", "A=1", " B = \"deux = 2\" ", "sans_egal"]);
        Assert.Equal("1", v["A"]);
        Assert.Equal("deux = 2", v["B"]);
        Assert.Equal(2, v.Count);
    }
}
