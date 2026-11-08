using LogiBTP.Api.Btp;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Produit interne du chantier de suivi du matériel (plan materiel-suites, lot 7, MO4).</summary>
public class ProduitInterneMaterielTests
{
    [Fact]
    public void Materiel_pointe_10_h_sur_deux_chantiers_credite_le_chantier_de_suivi_du_meme_total()
    {
        var cout = 37.5m;
        var deboursesChantiers = new[] { 360, 240 }.Sum(m => SpecialisationRentabiliteBtp.MontantProduitInterne(m, cout, false));
        Assert.Equal(375m, deboursesChantiers);
    }

    [Fact]
    public void Materiel_loue_ou_sans_cout_ne_produit_rien()
    {
        Assert.Equal(0m, SpecialisationRentabiliteBtp.MontantProduitInterne(120, 40m, true));
        Assert.Equal(0m, SpecialisationRentabiliteBtp.MontantProduitInterne(120, null, false));
    }
}
