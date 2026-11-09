using LogiBTP.Api.Btp;
using LogiBTP.Crm;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Plans en vigueur sur le terrain (plan terrain-suites, lot 3 ; TS1 a, TS2 b) : règle d'indice du module CRM reprise.</summary>
public class PlansTerrainTests
{
    private static readonly Dictionary<string, string> Effets = new() { ["BPE"] = "ACCEPTE", ["VAO"] = "ACCEPTE", ["REF"] = "REFUSE", ["SO"] = "NEUTRE" };
    private static readonly DateOnly Aujourdhui = new(2026, 11, 8);
    private static readonly DateOnly Diffuse = new(2026, 10, 1);

    private static IndiceTerrainSource Indice(long id, string indice, DateOnly? date, params string?[] visas) =>
        new(id, indice, date, 100 + id, null, visas.Select(v => new VisaAEvaluer(v, Diffuse.AddDays(15))).ToList());

    private static PlanTerrainSource Plan(long id, string repere, bool terrain, params IndiceTerrainSource[] indices) =>
        new(id, repere, $"Plan {repere}", null, "chantier", "7", terrain, indices);

    [Fact]
    public void Indice_B_vise_BPE_montre_et_indice_C_en_attente_ignore()
    {
        var p = Plan(1, "R01", false, Indice(1, "A", Diffuse, "BPE"), Indice(2, "B", Diffuse, "BPE"), Indice(3, "C", Diffuse, (string?)null));
        var r = Assert.Single(TerrainBtp.PlansEnVigueur([p], Effets, Aujourdhui));
        Assert.Equal("B", r.Indice.Indice);
        Assert.Equal(102, r.Indice.DgeId);
    }

    [Fact]
    public void Plan_refuse_ou_sans_indice_valide_absent()
    {
        var refuse = Plan(1, "R01", true, Indice(1, "A", Diffuse, "REF"));
        var aDiffuser = Plan(2, "R02", true, Indice(2, "A", null));
        var sansIndice = Plan(3, "R03", true);
        Assert.Empty(TerrainBtp.PlansEnVigueur([refuse, aDiffuser, sansIndice], Effets, Aujourdhui));
    }

    [Fact]
    public void Plan_coche_terrain_en_tete()
    {
        var autre = Plan(1, "A01", false, Indice(1, "A", Diffuse, "VAO"));
        var coche = Plan(2, "Z99", true, Indice(2, "", Diffuse, "BPE"));
        var r = TerrainBtp.PlansEnVigueur([autre, coche], Effets, Aujourdhui);
        Assert.Equal([2L, 1L], r.Select(x => x.Plan.Id));
        Assert.Equal("", r[0].Indice.Indice);
    }
}
