using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Documents.Tests;

/// <summary>Jeu partagé avec zones-entete.js (modules/document/tests/zones/01_zones_entete.json) : nom, validation, portée, zones d'un document.</summary>
public class ZonesEnteteTests
{
    private static JsonNode Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "document", "tests", "zones", "01_zones_entete.json"));

    public static TheoryData<int> Noms()
    {
        var data = new TheoryData<int>();
        for (var i = 0; i < Jeu()["noms"]!.AsArray().Count; i++) data.Add(i);
        return data;
    }

    public static TheoryData<int> Validations()
    {
        var data = new TheoryData<int>();
        for (var i = 0; i < Jeu()["validations"]!.AsArray().Count; i++) data.Add(i);
        return data;
    }

    public static TheoryData<int> Documents()
    {
        var data = new TheoryData<int>();
        for (var i = 0; i < Jeu()["documents"]!.AsArray().Count; i++) data.Add(i);
        return data;
    }

    private static List<OptionZone>? Valeurs(JsonNode? n) => n?.AsArray().Select(v => new OptionZone { Valeur = v!["valeur"]!.GetValue<string>(), Libelle = v["libelle"]?.GetValue<string>() }).ToList();

    private static ZoneEntete Zone(JsonNode z) => new(z["colonne"]!.GetValue<string>(), z["type"]!.GetValue<string>(), z["libelle"]!.GetValue<string>(),
        z["groupe"]?.GetValue<string>(), z["ordre"]?.GetValue<int>() ?? 0, z["obligatoire"]?.GetValue<bool>() ?? false, Valeurs(z["valeurs"]),
        z["famille"]?.GetValue<string>(), z["type_document"]?.GetValue<string>(), z["actif"]?.GetValue<bool>() ?? true);

    [Theory]
    [MemberData(nameof(Noms))]
    public void Nom_identique_au_js(int i)
    {
        var n = Jeu()["noms"]![i]!;
        Assert.Equal(n["attendu"]!.GetValue<bool>(), ZonesEntete.NomValide(n["colonne"]!.GetValue<string>()));
    }

    [Theory]
    [MemberData(nameof(Validations))]
    public void Validation_identique_au_js(int i)
    {
        var v = Jeu()["validations"]![i]!;
        var z = v["zone"]!;
        var obtenu = ZonesEntete.ErreursCreation(z["colonne"]?.GetValue<string>(), z["type"]?.GetValue<string>(), z["libelle"]?.GetValue<string>(), Valeurs(z["valeurs"]),
            z["famille"]?.GetValue<string>(), z["type_document"]?.GetValue<string>());
        var attendu = v["attendu"]!.AsArray().Select(e => new ErreurZone(e!["champ"]!.GetValue<string>(), e["code"]!.GetValue<string>())).ToList();
        Assert.Equal(attendu, obtenu);
    }

    [Fact]
    public void Portee_identique_au_js()
    {
        var jeu = Jeu();
        foreach (var p in jeu["portees"]!.AsArray())
        {
            var z = Zone(jeu["zones"]!.AsArray().First(x => x!["colonne"]!.GetValue<string>() == p!["zone"]!.GetValue<string>())!);
            Assert.Equal(p["attendu"]!.GetValue<string>(), ZonesEntete.Portee(z.Famille, z.TypeDocument));
        }
    }

    [Theory]
    [MemberData(nameof(Documents))]
    public void Zones_d_un_document_identiques_au_js(int i)
    {
        var jeu = Jeu();
        var d = jeu["documents"]![i]!;
        var zones = jeu["zones"]!.AsArray().Select(z => Zone(z!)).ToList();
        var obtenu = ZonesEntete.DuType(zones, d["famille"]!.GetValue<string>(), d["type"]!.GetValue<string>()).Select(z => z.Colonne).ToList();
        Assert.Equal(d["attendu"]!.AsArray().Select(x => x!.GetValue<string>()).ToList(), obtenu);
    }

    public static TheoryData<int> Saisies()
    {
        var data = new TheoryData<int>();
        for (var k = 0; k < Jeu()["saisies"]!.AsArray().Count; k++) data.Add(k);
        return data;
    }

    public static TheoryData<int> Reprises()
    {
        var data = new TheoryData<int>();
        for (var k = 0; k < Jeu()["reprises"]!.AsArray().Count; k++) data.Add(k);
        return data;
    }

    private static Dictionary<string, JsonNode?> Valeurs(JsonObject o) => o.ToDictionary(kv => kv.Key, kv => kv.Value?.DeepClone());

    [Theory]
    [MemberData(nameof(Saisies))]
    public void Saisie_identique_au_js(int i)
    {
        var jeu = Jeu();
        var s = jeu["saisies"]![i]!;
        var zones = jeu["zones_saisie"]!.AsArray().Select(z => Zone(z!)).ToList();
        var obtenu = ZonesEntete.ErreursSaisie(zones, s["famille"]!.GetValue<string>(), s["type"]!.GetValue<string>(), Valeurs(s["valeurs"]!.AsObject()), s["validation"]!.GetValue<bool>());
        var attendu = s["attendu"]!.AsArray().Select(e => new ErreurZone(e!["champ"]!.GetValue<string>(), e["code"]!.GetValue<string>())).ToList();
        Assert.Equal(attendu, obtenu);
    }

    [Theory]
    [MemberData(nameof(Reprises))]
    public void Reprise_identique_au_js(int i)
    {
        var jeu = Jeu();
        var r = jeu["reprises"]![i]!;
        var zones = jeu["zones_saisie"]!.AsArray().Select(z => Zone(z!)).ToList();
        var obtenu = ZonesEntete.Reprises(zones, Valeurs(r["valeurs"]!.AsObject()), r["famille"]!.GetValue<string>(), r["type"]!.GetValue<string>());
        var attendu = r["attendu"]!.AsObject();
        Assert.Equal(attendu.Select(kv => kv.Key).Order().ToList(), obtenu.Keys.Order().ToList());
        foreach (var kv in attendu) Assert.Equal(kv.Value!.ToJsonString(), obtenu[kv.Key]!.ToJsonString());
    }
}
