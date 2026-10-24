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
    public void Empreinte_stable_normalisee_et_propre_a_la_cle()
    {
        var c = new Chiffrement("une");
        var e = c.Empreinte(" Commercial@Exemple.fr ");
        Assert.Equal(64, e!.Length);
        Assert.Equal(e, c.Empreinte("commercial@exemple.fr"));
        Assert.NotEqual(e, new Chiffrement("autre").Empreinte("commercial@exemple.fr"));
        Assert.Null(c.Empreinte(" "));
        Assert.Throws<ErreurChiffrement>(() => new Chiffrement(null).Empreinte("x"));
    }

    [Fact]
    public void Lecture_env()
    {
        var v = ExtensionsConfiguration.LireEnv(["# commentaire", "", "A=1", " B = \"deux = 2\" ", "sans_egal"]);
        Assert.Equal("1", v["A"]);
        Assert.Equal("deux = 2", v["B"]);
        Assert.Equal(2, v.Count);
    }

    [Fact]
    public void Rotation_les_chaines_precedentes_dechiffrent_encore()
    {
        var ancienne = new Chiffrement("ancienne");
        var valeur = ancienne.Chiffrer("secret");
        var nouvelle = new Chiffrement("nouvelle", Chiffrement.Liste(" ancienne , autre "));
        Assert.Equal("secret", nouvelle.Dechiffrer(valeur));
        Assert.Equal("secret", new Chiffrement("nouvelle").Dechiffrer(nouvelle.Chiffrer("secret")));
        Assert.Throws<ErreurChiffrement>(() => new Chiffrement("nouvelle").Dechiffrer(valeur));
        Assert.NotEqual(ancienne.Empreinte("a@b.fr"), nouvelle.Empreinte("a@b.fr"));
    }
}
