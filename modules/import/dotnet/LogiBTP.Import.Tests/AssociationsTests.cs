using System.Globalization;
using System.Text.Json;
using LogiBTP.Import.Reprise;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Import.Tests;

/// <summary>Rapprochement des référentiels : Associations.cs ↔ correspondances.js (jeu js/test/associations-cas.json).</summary>
public class AssociationsTests
{
    private static readonly JsonElement Jeu = JsonDocument.Parse(File.ReadAllText(
        CasPartages.Chemin("modules", "import", "js", "test", "associations-cas.json"))).RootElement;

    private static string? Texte(JsonElement e, string nom) => e.GetProperty(nom).ValueKind == JsonValueKind.Null ? null : e.GetProperty(nom).GetString();

    [Fact]
    public void Unites_taux_et_options_comme_le_js()
    {
        var unites = Jeu.GetProperty("unites").EnumerateArray()
            .Select(u => new UniteCible(u.GetProperty("code").GetString()!, u.GetProperty("libelle").GetString()!,
                u.GetProperty("synonymes").EnumerateArray().Select(s => s.GetString()!).ToList())).ToList();
        foreach (var c in Jeu.GetProperty("cas_unites").EnumerateArray())
            Assert.True(Texte(c, "attendu") == Associations.Unite(Texte(c, "valeur"), unites), $"unité {Texte(c, "valeur")}");

        var taux = Jeu.GetProperty("taux").EnumerateArray()
            .Select(t => new TauxCible(t.GetProperty("id").GetInt64(), decimal.Parse(t.GetProperty("taux").GetString()!, CultureInfo.InvariantCulture),
                t.GetProperty("categorie").GetString()!)).ToList();
        foreach (var c in Jeu.GetProperty("cas_taux").EnumerateArray())
        {
            var p = Texte(c, "pourcentage") is { } s ? decimal.Parse(s, CultureInfo.InvariantCulture) : (decimal?)null;
            var attendu = c.GetProperty("attendu").ValueKind == JsonValueKind.Null ? (long?)null : c.GetProperty("attendu").GetInt64();
            Assert.True(attendu == Associations.Taux(p, taux), $"taux {p}");
        }

        var options = Jeu.GetProperty("options").EnumerateArray()
            .Select(o => new OptionCible(o.GetProperty("code").GetString()!, o.GetProperty("libelle").GetString()!)).ToList();
        foreach (var c in Jeu.GetProperty("cas_options").EnumerateArray())
            Assert.True(Texte(c, "attendu") == Associations.Option(Texte(c, "code"), Texte(c, "libelle"), options), $"option {Texte(c, "code")}");
    }

    [Fact]
    public void Taux_d_une_categorie_et_code_libre()
    {
        var taux = new List<TauxCible> { new(1, 20, "N"), new(4, 20, "A") };
        Assert.Equal(4, Associations.Taux(20, taux, "A"));
        Assert.Null(Associations.Taux(0, taux, "A"));

        var pris = new HashSet<string> { "CHQ", "CHQ_2", "ABCDEFGHIJ" };
        Assert.Equal("VIR", Associations.CodeLibre("VIR", 10, pris.Contains));
        Assert.Equal("CHQ_3", Associations.CodeLibre("CHQ", 10, pris.Contains));
        Assert.Equal("ABCDEFGH_2", Associations.CodeLibre("ABCDEFGHIJK", 10, pris.Contains));
    }

    [Fact]
    public void Pays_iso_et_registre_des_codes()
    {
        Assert.Equal("FR", PaysIso.Code(" fr "));
        Assert.Null(PaysIso.Code("France"));
        Assert.Null(PaysIso.Code("ZZ"));
        Assert.Contains("BE", FichierCorrespondances.CiblesModule["PAYS"]);

        var r = new RegistreCorrespondances();
        r.InscrireCode("PMEUNITEMESURE", "M2  ", "m2");
        Assert.Equal("m2", r.TrouverCode("PMEUNITEMESURE", "M2"));
        Assert.Null(r.TrouverCode("PMEUNITEMESURE", "KG"));
        Assert.Equal(0, r.Nombre);
    }
}
