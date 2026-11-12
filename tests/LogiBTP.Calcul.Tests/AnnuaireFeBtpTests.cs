using LogiBTP.Api.Btp;
using LogiBTP.Domaine;
using LogiBTP.FactureElectronique;
using LogiBTP.FactureElectronique.Web;
using LogiBTP.FactureElectronique.Web.Connecteurs;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Annuaire des plateformes sur la fiche personne (plans/facturation-electronique.md, lot 20).</summary>
public class AnnuaireFeBtpTests
{
    [Fact]
    public void Ligne_retenue_active_et_la_plus_precise()
    {
        LigneAnnuaire L(string id, string? siret, string? suffixe, string etat = EtatLigneAnnuaire.Active, string type = TypePlateformeAnnuaire.Pa) =>
            new(id, type, etat, "100000009", siret, null, suffixe);
        var lignes = new[]
        {
            L("100000009_COMPTA", null, "COMPTA"), L("100000009", null, null), L("100000009_12345678900011", "12345678900011", null),
            L("100000009_OFF", null, null, EtatLigneAnnuaire.Inactive),
        };
        Assert.Equal("100000009_12345678900011", ServiceFactureElectronique.ChoisirLigneAnnuaire(lignes, "12345678900011").Adresse);
        Assert.Equal("100000009", ServiceFactureElectronique.ChoisirLigneAnnuaire(lignes, null).Adresse);
        Assert.Equal("100000009", ServiceFactureElectronique.ChoisirLigneAnnuaire(lignes, "99999999900011").Adresse);
        Assert.False(ServiceFactureElectronique.ChoisirLigneAnnuaire([L("x", null, null, EtatLigneAnnuaire.Inactive)], null).Trouve);
        Assert.False(ServiceFactureElectronique.ChoisirLigneAnnuaire([], null).Trouve);
    }

    [Fact]
    public async Task Plateforme_simulee_lue_par_le_connecteur()
    {
        var c = new ConnecteurSimule(new PlateformeSimulee(new MagasinFluxMemoire(), TimeProvider.System));
        c.Plateforme.Annuaire.Ajouter(new LigneAnnuaire("100000009_STATUTS", TypePlateformeAnnuaire.Pa, EtatLigneAnnuaire.Active, "100000009", null, "R1", "STATUTS"));
        var r = await c.RechercherLignesAnnuaireAsync(new RechercheAnnuaire([new FiltreAnnuaire("siren", "100000009")]));
        var choix = ServiceFactureElectronique.ChoisirLigneAnnuaire(r.Resultats, null);
        Assert.True(choix.Trouve);
        Assert.Equal("STATUTS", choix.Suffixe);
        Assert.Equal("R1", choix.CodeRoutage);
        Assert.Equal(PlateformeAnnuaireFe.Pa, AnnuaireFeBtp.PlateformeDe(choix.TypePlateforme));
        Assert.Equal(PlateformeAnnuaireFe.Ppf, AnnuaireFeBtp.PlateformeDe(TypePlateformeAnnuaire.Ppf));
        var vide = await c.RechercherLignesAnnuaireAsync(new RechercheAnnuaire([new FiltreAnnuaire("siren", "999999999")]));
        Assert.False(ServiceFactureElectronique.ChoisirLigneAnnuaire(vide.Resultats, null).Trouve);
    }

    [Theory]
    [InlineData("100000009", null, "100000009")]
    [InlineData("100 000 009", null, "100000009")]
    [InlineData(null, "10000000900011", "100000009")]
    [InlineData("12", "abc", null)]
    [InlineData(null, null, null)]
    public void Siren_utilisable(string? siren, string? siret, string? attendu) => Assert.Equal(attendu, AnnuaireFeBtp.SirenDe(siren, siret));

    [Theory]
    [InlineData("B2B", "FR", null, AvertissementAnnuaireFe.NonVerifie)]
    [InlineData(null, "FR", false, AvertissementAnnuaireFe.HorsAnnuaire)]
    [InlineData("B2G", "FR", false, AvertissementAnnuaireFe.HorsAnnuaire)]
    [InlineData("B2B", "FR", true, null)]
    [InlineData("B2C", "FR", false, null)]
    [InlineData("INTERNATIONAL", "BE", false, null)]
    [InlineData("B2B", "BE", false, null)]
    public void Avertissement_a_l_emission(string? type, string? pays, bool? dans, string? attendu) =>
        Assert.Equal(attendu, AnnuaireFeBtp.Avertissement(type, pays, dans));
}
