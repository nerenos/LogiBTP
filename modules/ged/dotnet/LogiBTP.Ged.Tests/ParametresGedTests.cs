using System.Text.Json;
using LogiBTP.Ged.Web;
using Xunit;

namespace LogiBTP.Ged.Tests;

/// <summary>Limite de dépôt exposée au client par les paramètres de la GED (plan terrain-suites, lot 11 ; TS12).</summary>
public class ParametresGedTests
{
    private sealed class SpecialisationLimitee : SpecialisationGed
    {
        public override long TailleMaxDepot => 12L * 1024 * 1024;
    }

    [Fact]
    public void Limite_de_depot_egale_a_la_specialisation()
    {
        var p = new ServiceGed(null!, new SpecialisationLimitee(), null!).ParametresDepuis(new Dictionary<string, JsonElement>());
        Assert.Equal(12L * 1024 * 1024, p.TailleMaxDepot);
        Assert.Equal(new SpecialisationGed().TailleMaxDepot, new ServiceGed(null!, new SpecialisationGed(), null!).ParametresDepuis(new Dictionary<string, JsonElement>()).TailleMaxDepot);
    }

    [Fact]
    public void Parametres_lus_de_la_base_conserves()
    {
        var p = new ServiceGed(null!, new SpecialisationGed(), null!).ParametresDepuis(new Dictionary<string, JsonElement>
        {
            ["editions_conservees"] = JsonSerializer.SerializeToElement(3),
            ["taille_max_depot"] = JsonSerializer.SerializeToElement(1),
        });
        Assert.Equal(3, p.EditionsConservees);
        // La limite vient toujours de la spécialisation, jamais d'un paramètre en base.
        Assert.Equal(new SpecialisationGed().TailleMaxDepot, p.TailleMaxDepot);
    }
}
