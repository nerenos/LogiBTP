using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Bibliotheque.Tests;

public class CalculElementTests
{
    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "bibliotheque", "tests", "cas", "01_calcul.json"));

    public static TheoryData<string> Cas()
    {
        var data = new TheoryData<string>();
        foreach (var c in Jeu()["cas"]!.AsArray()) data.Add(c!["nom"]!.GetValue<string>());
        return data;
    }

    private static JsonNode? Valeur(decimal? v) => v is null ? null : JsonValue.Create(v.Value);

    /// <summary>Jeu partagé avec calcul.js : PA, PR, PV, coefficient, PV net, prix par unité et alertes identiques.</summary>
    [Theory]
    [MemberData(nameof(Cas))]
    public void Calcul_identique_au_js(string nom)
    {
        var jeu = Jeu();
        var cas = jeu["cas"]!.AsArray().First(c => c!["nom"]!.GetValue<string>() == nom)!;
        var entree = cas["entree"].Deserialize<EntreeElement>(JsonCalcul.Options)!;
        var r = CalculElement.Calculer(entree, jeu["date"]!.GetValue<string>());
        var attendu = cas["attendu"]!.AsObject();
        var fautes = new List<string>();
        foreach (var (champ, v) in new[] { ("pa", r.Pa), ("pr", r.Pr), ("pv", r.Pv), ("coef_benef", r.CoefBenef), ("pv_net", r.PvNet) })
            if (!CasPartages.Egal(Valeur(v), attendu[champ])) fautes.Add($"{champ} : attendu {attendu[champ]?.ToJsonString() ?? "null"}, obtenu {v}");
        Assert.Equal(attendu["alertes"]!.AsArray().Select(a => a!.GetValue<string>()), r.Alertes);
        var unites = attendu["prix_unites"]!.AsArray();
        Assert.Equal(unites.Count, r.PrixUnites.Count);
        for (var i = 0; i < unites.Count; i++)
        {
            var a = unites[i]!.AsObject();
            var o = r.PrixUnites[i];
            Assert.Equal(a["unite"]!.GetValue<string>(), o.Unite);
            foreach (var (champ, v) in new[] { ("ratio", o.Ratio), ("pa", o.Pa), ("pr", o.Pr), ("pv_net", o.PvNet) })
                if (!CasPartages.Egal(Valeur(v), a[champ])) fautes.Add($"{o.Unite}.{champ} : attendu {a[champ]?.ToJsonString() ?? "null"}, obtenu {v}");
        }
        Assert.True(fautes.Count == 0, string.Join(Environment.NewLine, fautes));
    }

    [Fact]
    public void Conversions_identiques_au_js()
    {
        foreach (var c in Jeu()["conversions"]!.AsArray())
        {
            var e = c!["element"].Deserialize<EntreeElement>(JsonCalcul.Options)!;
            var q = CalculElement.Convertir(decimal.Parse(c["quantite"]!.GetValue<string>(), System.Globalization.CultureInfo.InvariantCulture), c["de"]!.GetValue<string>(), c["vers"]!.GetValue<string>(), e);
            Assert.True(CasPartages.Egal(JsonValue.Create(Math.Round(q, 6, MidpointRounding.AwayFromZero)), c["attendu"]), c["nom"]!.GetValue<string>());
        }
    }

    [Fact]
    public void Code_d_appel_avec_prefixe_hors_de_la_bibliotheque()
    {
        Assert.Equal("BET01", CalculElement.CodeAppel("GEN", "BET01", "GEN"));
        Assert.Equal("FOUR:BET01", CalculElement.CodeAppel("FOUR", "BET01", "GEN"));
        Assert.Equal(("FOUR", "BET01"), CalculElement.AnalyserCodeAppel("four: BET01", "GEN"));
        Assert.Equal(("GEN", "BET01"), CalculElement.AnalyserCodeAppel("BET01", "GEN"));
    }
}

public class CoefficientsElementTests
{
    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "bibliotheque", "tests", "cas", "02_coefficients.json"));

    public static TheoryData<string> Cas()
    {
        var data = new TheoryData<string>();
        foreach (var c in Jeu()["cas"]!.AsArray()) data.Add(c!["nom"]!.GetValue<string>());
        return data;
    }

    /// <summary>Jeu partagé avec coefficientsEffectifs (calcul.js) : valeurs et sources identiques.</summary>
    [Theory]
    [MemberData(nameof(Cas))]
    public void Resolution_identique_au_js(string nom)
    {
        var jeu = Jeu();
        var cas = jeu["cas"]!.AsArray().First(c => c!["nom"]!.GetValue<string>() == nom)!;
        var periodes = jeu["periodes"].Deserialize<List<PeriodeCoefficients>>(JsonCalcul.Options)!;
        var e = cas["element"].Deserialize<CoefficientsSaisis>(JsonCalcul.Options)!;
        var d = jeu["defauts"]!;
        var r = CoefficientsElement.Resoudre(e, periodes, cas["date"]!.GetValue<string>(), d["coef_fg_defaut"]!.GetValue<decimal>(), d["coef_benef_defaut"]!.GetValue<decimal>());
        var a = cas["attendu"]!;
        Assert.True(CasPartages.Egal(JsonValue.Create(r.CoefFg), a["coef_fg"]), $"FG {r.CoefFg}");
        Assert.True(CasPartages.Egal(JsonValue.Create(r.CoefBenef), a["coef_benef"]), $"Bénéfice {r.CoefBenef}");
        Assert.Equal(a["sources"]!["coef_fg"]!["portee"]!.GetValue<string>(), r.SourceFg.Portee);
        Assert.Equal(a["sources"]!["coef_benef"]!["portee"]!.GetValue<string>(), r.SourceBenef.Portee);
        Assert.Equal(a["sources"]!["coef_fg"]!["debut"]?.GetValue<string>(), r.SourceFg.Debut);
    }
}

/// <summary>Codes du module : Codes.cs ↔ modules/bibliotheque/js/src/codes.js.</summary>
public class CodesTests
{
    [Fact]
    public void Parite_avec_le_js()
    {
        Assert.Empty(Constantes.Ecarts(CasPartages.Chemin("modules", "bibliotheque", "js", "src", "codes.js"), "GESTION_ELEMENT", typeof(GestionElement)));
        Assert.Empty(Constantes.Ecarts(CasPartages.Chemin("modules", "bibliotheque", "js", "src", "codes.js"), "GENRE_POSTE", typeof(GenrePoste)));
        Assert.Empty(Constantes.Ecarts(CasPartages.Chemin("modules", "bibliotheque", "js", "src", "codes.js"), "SCENARIO_PA", typeof(ScenarioPa)));
    }
}

public class PremierTarifTests
{
    public static IEnumerable<object[]> NomsDesCas()
        => CasPartages.Lire(CasPartages.Chemin("modules", "bibliotheque", "tests", "cas", "03_premier_tarif.json"))["cas"]!.AsArray().Select(c => new object[] { c!["nom"]!.GetValue<string>() });

    [Theory]
    [MemberData(nameof(NomsDesCas))]
    public void Cas_partages_avec_le_js(string nom)
    {
        var cas = CasPartages.Lire(CasPartages.Chemin("modules", "bibliotheque", "tests", "cas", "03_premier_tarif.json"))["cas"]!.AsArray().First(c => c!["nom"]!.GetValue<string>() == nom)!;
        decimal? pa = cas["pa_fixe"] is null ? null : decimal.Parse(cas["pa_fixe"]!.GetValue<string>(), System.Globalization.CultureInfo.InvariantCulture);
        var r = PremierTarif.Appliquer(cas["autres"]!.GetValue<int>(), cas["principal"]!.GetValue<bool>(), cas["scenario"]?.GetValue<string>(), pa);
        Assert.Equal(cas["attendu"]!["principal"]!.GetValue<bool>(), r.Principal);
        Assert.Equal(cas["attendu"]!["scenario"]!.GetValue<string>(), r.Scenario);
    }

    [Fact]
    public void Premier_tarif_sans_pa_devient_principal_et_change_le_scenario()
        => Assert.Equal((true, "FOURNISSEUR_PRINCIPAL"), PremierTarif.Appliquer(0, false, "FIXE", null));

    [Fact]
    public void Second_tarif_ne_change_rien()
        => Assert.Equal((false, "FIXE"), PremierTarif.Appliquer(2, false, "FIXE", null));

    [Fact]
    public void Element_avec_pa_saisi_garde_son_scenario()
        => Assert.Equal((true, "FIXE"), PremierTarif.Appliquer(0, false, "FIXE", 5m));
}
