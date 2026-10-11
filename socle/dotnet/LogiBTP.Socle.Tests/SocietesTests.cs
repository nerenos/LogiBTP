using LogiBTP.Socle.Web;
using Xunit;

namespace LogiBTP.Socle.Tests;

public class SocietesTests
{
    private static readonly string[] Domaines = ["localhost", "logibtp.fr"];

    [Theory]
    [InlineData("localhost:5173", null)]
    [InlineData("acme.localhost:5173", "acme")]
    [InlineData("ACME.LogiBTP.fr", "acme")]
    [InlineData("logibtp.fr", null)]
    [InlineData("www.logibtp.fr", null)]
    [InlineData("filiale.acme.logibtp.fr", "filiale.acme")]
    [InlineData("127.0.0.1:5080", null)]
    [InlineData("[::1]:5080", null)]
    [InlineData("autre-domaine.com", null)]
    [InlineData("", null)]
    public void Sous_domaine_designe_la_societe(string hote, string? attendu) =>
        Assert.Equal(attendu, ExtensionsSocietes.SousDomaine(hote, Domaines));
}
