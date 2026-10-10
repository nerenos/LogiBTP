using LogiBTP.Documents.Web;
using Xunit;

namespace LogiBTP.Documents.Tests;

public class NettoyageHtmlTests
{
    private readonly NettoyageHtml _n = new();

    [Theory]
    [InlineData("<p>Ligne 1</p><p>Ligne 2</p>", "<p>Ligne 1</p><p>Ligne 2</p>")]
    [InlineData("Ligne 1<br>Ligne 2", "Ligne 1<br>Ligne 2")]
    [InlineData("Ligne 1<div>Ligne 2</div>", "Ligne 1<div>Ligne 2</div>")]
    [InlineData("<ul><li>a</li><li>b</li></ul>", "<ul><li>a</li><li>b</li></ul>")]
    public void Les_sauts_de_ligne_sont_conserves(string entree, string attendu) =>
        Assert.Equal(attendu, _n.Nettoyer(entree));

    [Fact]
    public void Une_balise_interdite_est_retiree_sans_perdre_son_texte() =>
        Assert.Equal("Texte <b>gras</b>", _n.Nettoyer("<font color=\"red\">Texte </font><b>gras</b>"));

    [Fact]
    public void Les_scripts_sont_supprimes() =>
        Assert.DoesNotContain("alert", _n.Nettoyer("<p onclick=\"alert(1)\">A</p><script>alert(2)</script>"));

    [Fact]
    public void Les_styles_autorises_sont_conserves() =>
        Assert.Equal("<span style=\"color: rgba(180, 35, 24, 1); font-weight: bold\">ST25</span>",
            _n.Nettoyer("<span style=\"color: rgb(180, 35, 24); font-weight: bold; position: fixed\">ST25</span>"));
}
