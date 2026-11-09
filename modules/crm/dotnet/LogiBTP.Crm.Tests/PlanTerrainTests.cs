using LogiBTP.Crm.Web;
using Xunit;

namespace LogiBTP.Crm.Tests;

/// <summary>Case « Terrain » d'un plan (plan terrain-suites, lot 2) : enregistrée, gardée si non transmise, relue.</summary>
public class PlanTerrainTests
{
    private static PlanSaisi Saisie(bool? terrain) => new("R01", null, "Plan de masse", null, null, null, "chantier", "12", null, terrain);

    private static readonly EtatPlan Etat = new("BPE", "B", "B", 0, 0, false);

    [Fact]
    public void Case_cochee_enregistree_et_relue()
    {
        var p = new CrmPlan { PlaId = 3, PlaCreePar = "u" };
        ServiceCrm.RemplirPlan(p, Saisie(true));
        Assert.True(p.PlaTerrain);
        Assert.True(ServiceCrm.EnPlanDto(p, null, Etat, 2).Terrain);
    }

    [Fact]
    public void Case_non_transmise_inchangee()
    {
        var p = new CrmPlan { PlaTerrain = true };
        ServiceCrm.RemplirPlan(p, Saisie(null));
        Assert.True(p.PlaTerrain);
        ServiceCrm.RemplirPlan(p, Saisie(false));
        Assert.False(p.PlaTerrain);
        Assert.False(ServiceCrm.EnPlanDto(p, null, Etat, 0).Terrain);
    }

    [Fact]
    public void Nouveau_plan_non_coche()
    {
        var p = new CrmPlan();
        ServiceCrm.RemplirPlan(p, Saisie(null));
        Assert.False(p.PlaTerrain);
    }
}
