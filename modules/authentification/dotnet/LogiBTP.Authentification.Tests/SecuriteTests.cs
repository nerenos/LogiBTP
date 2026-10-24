using LogiBTP.Authentification.Web;
using LogiBTP.Socle;
using Xunit;

namespace LogiBTP.Authentification.Tests;

/// <summary>Adresses (préfixe compté, plages de confiance) et jetons d'accès (signature, base, expiration, révocation).</summary>
public class SecuriteTests
{
    [Theory]
    [InlineData("192.168.1.20", "192.168.1.20")]
    [InlineData("::ffff:10.0.0.5", "10.0.0.5")]
    [InlineData("2a01:cb00:1234:5678:aaaa:bbbb:cccc:dddd", "2a01:cb00:1234:5678::/64")]
    [InlineData("pas une adresse", null)]
    public void Prefixe_compte(string adresse, string? attendu) => Assert.Equal(attendu, Adresses.Prefixe(adresse));

    [Fact]
    public void Plages_de_confiance()
    {
        string[] plages = ["192.168.0.0/16", "10.1.2.3", "fd00::/8", "illisible"];
        Assert.True(Adresses.DansPlages("192.168.40.2", plages));
        Assert.True(Adresses.DansPlages("10.1.2.3", plages));
        Assert.False(Adresses.DansPlages("10.1.2.4", plages));
        Assert.True(Adresses.DansPlages("fd12::1", plages));
        Assert.True(Adresses.DansPlages("::ffff:192.168.1.1", plages));
        Assert.False(Adresses.DansPlages("8.8.8.8", plages));
        Assert.False(Adresses.DansPlages("8.8.8.8", null));
        Assert.Equal(["illisible"], Adresses.PlagesInvalides(plages));
    }

    private static SessionLue Session() => new(7, 3, "jp.martin", "Jean-Pierre Martin", "SAISIE", false, "individu", "12",
        DateTimeOffset.UtcNow.AddHours(1), false, DateTimeOffset.UtcNow);

    [Fact]
    public void Jeton_lu_dans_sa_base_seulement()
    {
        var jetons = new JetonsAcces(new Chiffrement("chaine de test de l'installation"));
        var jeton = jetons.Emettre(Session(), "logibtp");
        var lue = jetons.Lire(jeton, "logibtp", out var api);
        Assert.NotNull(lue);
        Assert.False(api);
        Assert.Equal(("jp.martin", "SAISIE", 7L), (lue!.Code, lue.Profil, lue.SesId));
        Assert.Null(jetons.Lire(jeton, "logibtp_demo", out _));
        Assert.True(jetons.Lire(jetons.Emettre(Session(), "logibtp", api: true), "logibtp", out var estApi) is not null && estApi);
    }

    [Fact]
    public void Jeton_falsifie_ou_d_une_autre_cle_refuse()
    {
        var jetons = new JetonsAcces(new Chiffrement("chaine A"));
        var jeton = jetons.Emettre(Session(), "logibtp");
        var parties = jeton.Split('.');
        var falsifie = parties[0] + "." + parties[1].Replace('A', 'B') + "." + parties[2];
        Assert.Null(jetons.Lire(falsifie, "logibtp", out _));
        Assert.Null(new JetonsAcces(new Chiffrement("chaine B")).Lire(jeton, "logibtp", out _));
        Assert.Null(jetons.Lire("pas.un.jeton", "logibtp", out _));
        Assert.Null(jetons.Lire(null, "logibtp", out _));
    }

    [Fact]
    public void Revocation_immediate_par_l_epoque()
    {
        var jetons = new JetonsAcces(new Chiffrement("chaine C"));
        var jeton = jetons.Emettre(Session(), "logibtp");
        JetonsAcces.Invalider();
        Assert.Null(jetons.Lire(jeton, "logibtp", out _));
        Assert.NotNull(jetons.Lire(jetons.Emettre(Session(), "logibtp"), "logibtp", out _));
    }

    [Fact]
    public void Session_expiree_refusee()
    {
        var jetons = new JetonsAcces(new Chiffrement("chaine D"));
        Assert.Null(jetons.Lire(jetons.Emettre(Session() with { ExpireLe = DateTimeOffset.UtcNow.AddSeconds(-1) }, "logibtp"), "logibtp", out _));
    }

    [Fact]
    public void Nom_de_machine_lisible() =>
        Assert.Equal("Edge sur Windows", ServiceAuthentification.NomNavigateur("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0"));
}
