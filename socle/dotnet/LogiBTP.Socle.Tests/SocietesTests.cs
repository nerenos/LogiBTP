using LogiBTP.Socle.Web;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
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

    [Theory]
    [InlineData("Host=localhost;Port=5433;Database=logibtp_demo;Username=logibtp;Password=logibtp", "logibtp_demo")]
    [InlineData("Server=x;Initial Catalog=LogiBTP Acme;", "LogiBTP_Acme")]
    [InlineData("Host=localhost;Username=logibtp", null)]
    [InlineData("", null)]
    [InlineData("Database=../secret", "_secret")]
    public void Nom_de_base_de_la_connexion(string connexion, string? attendu) =>
        Assert.Equal(attendu, SocieteCourante.NomBase(connexion));

    [Fact]
    public void Portee_imposee_a_une_societe_hors_requete()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:LogiBTP"] = "Database=logibtp",
            ["Societes:Liste:acme:Connexion"] = "Database=logibtp_acme",
        }).Build();
        var sp = new ServiceCollection().AddSocietes(configuration).BuildServiceProvider();
        var societes = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<OptionsSocietes>>().Value.Societes().ToList();
        Assert.Equal([null, "acme"], societes.Select(s => s.Code));
        Assert.Equal("ACME", societes[1].Libelle);
        using (var defaut = sp.CreateScope()) Assert.True(defaut.ServiceProvider.GetRequiredService<SocieteCourante>().Principale);
        using var portee = sp.CreerPorteeSociete(societes[1]);
        Assert.Equal("logibtp_acme", portee.ServiceProvider.GetRequiredService<SocieteCourante>().Base);
    }
}
