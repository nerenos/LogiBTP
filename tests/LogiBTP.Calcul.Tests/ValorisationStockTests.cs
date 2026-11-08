using LogiBTP.Api.Btp;
using LogiBTP.Bibliotheque;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Recopie du PMP et du dernier PA par le Stock : les prix de l'élément suivent le calcul de la Bibliothèque (corrections novembre, lot 4).</summary>
public class ValorisationStockTests
{
    private static ResultatElement Prix(string scenario, decimal? dernierPa, decimal? pmp) =>
        SpecialisationStockBtp.CalculerPrix("[]", "{}", "u", scenario, null, dernierPa, pmp, 1.1m, 1.2m, null, false, 1m, new Dictionary<string, decimal?>(), []);

    [Fact]
    public void Dernier_pa_pose_dans_pa_puis_pr_avec_frais_generaux()
    {
        var r = Prix("DERNIER_PA", 10m, 12m);
        Assert.Equal(10m, r.Pa);
        Assert.Equal(11m, r.Pr);
    }

    [Fact]
    public void Pmp_pose_dans_pa_puis_pr_avec_frais_generaux()
    {
        var r = Prix("PMP", 10m, 12m);
        Assert.Equal(12m, r.Pa);
        Assert.Equal(13.2m, r.Pr);
    }
}
