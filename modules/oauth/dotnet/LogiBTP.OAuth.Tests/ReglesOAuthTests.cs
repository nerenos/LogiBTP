using System.Text;
using Xunit;

namespace LogiBTP.OAuth.Tests;

public class ReglesOAuthTests
{
    private static readonly DateTimeOffset Maintenant = new(2026, 10, 23, 10, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Pkce_defi_S256_de_la_RFC_7636()
    {
        // Exemple de l'annexe B de la RFC 7636.
        Assert.Equal("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", ReglesOAuth.Defi("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));
        var p = ReglesOAuth.NouveauPkce();
        Assert.Equal(43, p.Verificateur.Length);
        Assert.Equal(ReglesOAuth.Defi(p.Verificateur), p.Defi);
    }

    [Fact]
    public void State_porte_la_societe()
    {
        Assert.Equal("demo", ReglesOAuth.SocieteDuState(ReglesOAuth.NouveauState("demo")));
        Assert.Null(ReglesOAuth.SocieteDuState(ReglesOAuth.NouveauState(null)));
        Assert.NotEqual(ReglesOAuth.NouveauState(null), ReglesOAuth.NouveauState(null));
        Assert.Throws<FormatException>(() => ReglesOAuth.SocieteDuState("sans-point"));
        Assert.Throws<FormatException>(() => ReglesOAuth.SocieteDuState(null));
    }

    [Fact]
    public void Url_autorisation_avec_parametres_du_fournisseur()
    {
        var url = ReglesOAuth.UrlAutorisation("https://accounts.google.com/o/oauth2/v2/auth", "client 1", "http://localhost:5173/api/oauth/retour",
            "openid email https://mail.google.com/", "_.abc", "defi", new Dictionary<string, string> { ["access_type"] = "offline", ["state"] = "ignoré" }, "a@b.fr");
        Assert.StartsWith("https://accounts.google.com/o/oauth2/v2/auth?client_id=client%201&redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fapi%2Foauth%2Fretour", url);
        Assert.Contains("&scope=openid%20email%20https%3A%2F%2Fmail.google.com%2F", url);
        Assert.Contains("&code_challenge=defi&code_challenge_method=S256", url);
        Assert.Contains("&state=_.abc", url);
        Assert.DoesNotContain("ignor", url);
        Assert.EndsWith("&access_type=offline&login_hint=a%40b.fr", url);
    }

    [Fact]
    public void Reponse_de_jeton_et_erreurs()
    {
        var r = ReglesOAuth.LireReponseJeton("""{"access_token":"a","expires_in":3599,"refresh_token":"r","scope":"s","token_type":"Bearer","id_token":"x.y.z"}""");
        Assert.Equal(("a", "r", 3599, "x.y.z"), (r.Acces, r.Rafraichissement, r.ExpireDans, r.IdToken));
        Assert.Equal(7200, ReglesOAuth.LireReponseJeton("""{"access_token":"a","expires_in":"7200"}""").ExpireDans);
        var e = Assert.Throws<ErreurOAuth>(() => ReglesOAuth.LireReponseJeton("""{"error":"invalid_grant","error_description":"Token has been expired or revoked."}"""));
        Assert.True(e.AReconnecter);
        Assert.False(Assert.Throws<ErreurOAuth>(() => ReglesOAuth.LireReponseJeton("""{"token_type":"Bearer"}""")).AReconnecter);
    }

    [Fact]
    public void Compte_lu_dans_l_id_token()
    {
        var charge = ReglesOAuth.Base64Url(Encoding.UTF8.GetBytes("""{"iss":"https://accounts.google.com","email":"boite.essai@gmail.com","email_verified":true}"""));
        Assert.Equal("boite.essai@gmail.com", ReglesOAuth.CompteDeIdToken($"entete.{charge}.signature"));
        var upn = ReglesOAuth.Base64Url(Encoding.UTF8.GetBytes("""{"preferred_username":"noreply@societe.fr"}"""));
        Assert.Equal("noreply@societe.fr", ReglesOAuth.CompteDeIdToken($"e.{upn}.s"));
        Assert.Null(ReglesOAuth.CompteDeIdToken("illisible"));
        Assert.Null(ReglesOAuth.CompteDeIdToken("a.@@@.c"));
    }

    [Fact]
    public void Fin_du_jeton_de_rafraichissement()
    {
        Assert.Equal(Maintenant.AddSeconds(100), ReglesOAuth.FinRafraichissement(Maintenant, 100, true, 7));
        Assert.Equal(Maintenant.AddDays(7), ReglesOAuth.FinRafraichissement(Maintenant, null, true, 7));
        Assert.Null(ReglesOAuth.FinRafraichissement(Maintenant, null, false, 7));
        Assert.Null(ReglesOAuth.FinRafraichissement(Maintenant, null, true, null));
    }

    [Fact]
    public void Pastilles()
    {
        Assert.Null(ReglesOAuth.Pastille(null, Maintenant));
        Assert.Equal("VERT", ReglesOAuth.Pastille(Maintenant.AddDays(30), Maintenant));
        Assert.Equal("ORANGE", ReglesOAuth.Pastille(Maintenant.AddDays(29), Maintenant));
        Assert.Equal("ORANGE", ReglesOAuth.Pastille(Maintenant.AddDays(7), Maintenant));
        Assert.Equal("ROUGE", ReglesOAuth.Pastille(Maintenant.AddDays(6), Maintenant));
        Assert.Equal("ROUGE", ReglesOAuth.Pastille(Maintenant.AddDays(-1), Maintenant));
        Assert.Equal("ROUGE", ReglesOAuth.PastilleConnexion("A_RECONNECTER", null, null, Maintenant));
        Assert.Equal("ORANGE", ReglesOAuth.PastilleConnexion("OK", Maintenant.AddDays(100), Maintenant.AddDays(10), Maintenant));
        Assert.Equal("VERT", ReglesOAuth.PastilleConnexion("OK", null, null, Maintenant));
        Assert.Null(ReglesOAuth.PastilleConnexion("DESACTIVEE", null, null, Maintenant));
    }

    [Fact]
    public void Rappels_un_seul_delai_le_plus_proche()
    {
        int[] delais = [30, 7, 1];
        Assert.Null(ReglesOAuth.DelaiAtteint(Maintenant.AddDays(31), delais, Maintenant));
        Assert.Equal(30, ReglesOAuth.DelaiAtteint(Maintenant.AddDays(30), delais, Maintenant));
        Assert.Equal(7, ReglesOAuth.DelaiAtteint(Maintenant.AddDays(6), delais, Maintenant));
        Assert.Equal(1, ReglesOAuth.DelaiAtteint(Maintenant.AddHours(3), delais, Maintenant));
        Assert.Equal(0, ReglesOAuth.DelaiAtteint(Maintenant.AddHours(-3), delais, Maintenant));
        var dus = ReglesOAuth.RappelsDus(Maintenant.AddDays(200), Maintenant.AddDays(5), null, delais, Maintenant);
        Assert.Equal([new RappelDu("RAFRAICHISSEMENT", Maintenant.AddDays(5), 7)], dus);
        // Autorisation de 7 jours : les rappels à 30 et 7 jours ne partent pas dès la connexion, celui à 1 jour oui.
        var connexion = Maintenant.AddDays(-2);
        Assert.Null(ReglesOAuth.DelaiAtteint(connexion.AddDays(7), delais, Maintenant, connexion));
        Assert.Equal(1, ReglesOAuth.DelaiAtteint(connexion.AddDays(7), delais, connexion.AddDays(6).AddHours(1), connexion));
        Assert.Empty(ReglesOAuth.RappelsDus(null, connexion.AddDays(7), connexion, delais, Maintenant));
    }
}
