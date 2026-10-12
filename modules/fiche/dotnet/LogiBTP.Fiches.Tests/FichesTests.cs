using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Fiches.Tests;

public class ValidationFicheTests
{
    public static TheoryData<string> Cas()
    {
        var data = new TheoryData<string>();
        foreach (var c in CasPartages.Lire(CasPartages.Chemin("modules", "fiche", "tests", "cas", "01_validation.json"))["cas"]!.AsArray()) data.Add(c!["nom"]!.GetValue<string>());
        return data;
    }

    /// <summary>Jeu partagé avec validation.js : même code d'erreur pour chaque cas.</summary>
    [Theory]
    [MemberData(nameof(Cas))]
    public void Validation_identique_au_js(string nom)
    {
        var cas = CasPartages.Lire(CasPartages.Chemin("modules", "fiche", "tests", "cas", "01_validation.json"))["cas"]!.AsArray()
            .First(c => c!["nom"]!.GetValue<string>() == nom)!;
        var champ = cas["champ"].Deserialize<ChampFiche>(JsonCalcul.Options)!;
        var valeur = JsonSerializer.Deserialize<JsonElement>(cas["valeur"]?.ToJsonString() ?? "null");
        Assert.Equal(cas["attendu"]?.GetValue<string>(), ValidationFiche.Valider(champ, valeur));
    }
}

public class ConstructeurFicheTests
{
    /// <summary>Colonne CHAR(n) (information_schema : « character ») : valeur passée en texte, jamais CAST AS character (1 caractère).</summary>
    [Fact]
    public void Colonne_char_non_tronquee()
    {
        var t = new TypeFicheResolu("personne", "personne", "per_id", null,
            new DefinitionFiche { Champs = [new() { Code = "siren", Colonne = "per_siren", Type = "texte" }] },
            [], new Dictionary<string, string> { ["per_siren"] = "character" });
        var r = new ConstructeurFiche(t).Insertion(new Dictionary<string, string?> { ["siren"] = "404833048" }, null);
        Assert.DoesNotContain("AS character", r.Texte);
        Assert.Equal("404833048", r.Parametres[0].Valeur);
    }

    private static TypeFicheResolu Type() => new("salarie", "demo_salarie", "sal_id", "sal_proprietes",
        new DefinitionFiche
        {
            Champs =
            [
                new() { Code = "nom", Colonne = "sal_nom", Type = "texte" },
                new() { Code = "salaire_brut", Colonne = "sal_salaire", Type = "nombre", Confidentiel = true },
                new() { Code = "calcule", Colonne = "sal_calcule", Type = "texte", LectureSeule = true },
            ],
        },
        [], new Dictionary<string, string> { ["sal_nom"] = "character varying", ["sal_salaire"] = "numeric", ["sal_id"] = "integer" });

    [Fact]
    public void Lecture_alias_par_code_et_empreinte()
    {
        var r = new ConstructeurFiche(Type()).Lire("12");
        Assert.Equal("SELECT t.\"sal_nom\" AS \"nom\", t.\"sal_salaire\" AS \"salaire_brut\", t.\"sal_calcule\" AS \"calcule\", t.\"sal_proprietes\" AS \"_proprietes\", "
            + "t.\"sal_id\"::text AS \"_id\", md5(row_to_json(t)::text) AS \"_h\" FROM \"demo_salarie\" t WHERE t.\"sal_id\"::text = @p0", r.Texte);
    }

    [Fact]
    public void Mise_a_jour_typee_et_proprietes_fusionnees()
    {
        var r = new ConstructeurFiche(Type()).MiseAJour("12", new Dictionary<string, string?> { ["salaire_brut"] = "2 500,5", ["nom"] = null }, "{\"badge\":\"B1\"}");
        Assert.Equal("UPDATE \"demo_salarie\" t SET \"sal_salaire\" = CAST(@p0 AS numeric), \"sal_nom\" = NULL, "
            + "\"sal_proprietes\" = coalesce(\"sal_proprietes\", '{}'::jsonb) || CAST(@p1 AS jsonb) WHERE t.\"sal_id\"::text = @p2", r.Texte);
        Assert.Equal("2500.5", r.Parametres[0].Valeur);
    }

    [Fact]
    public void Champ_inconnu_ou_en_lecture_seule_refuse()
    {
        var c = new ConstructeurFiche(Type());
        Assert.Equal("CHAMP", Assert.Throws<ErreurFiche>(() => c.MiseAJour("1", new Dictionary<string, string?> { ["calcule"] = "x" }, null)).Code);
        Assert.Equal("CHAMP", Assert.Throws<ErreurFiche>(() => c.MiseAJour("1", new Dictionary<string, string?> { ["\"; DROP TABLE x; --"] = "x" }, null)).Code);
        Assert.Equal("IDENTIFIANT", Assert.Throws<ErreurFiche>(() => new ConstructeurFiche(Type() with { Table = "x; DROP" }).Lire("1")).Code);
    }

    [Fact]
    public void Insertion_avec_identifiant_renvoye()
    {
        var r = new ConstructeurFiche(Type()).Insertion(new Dictionary<string, string?> { ["nom"] = "Martin" }, null);
        Assert.Equal("INSERT INTO \"demo_salarie\" (\"sal_nom\", \"sal_proprietes\") VALUES (CAST(@p0 AS character varying), CAST(@p1 AS jsonb)) RETURNING \"sal_id\"::text AS id", r.Texte);
        Assert.Equal("{}", r.Parametres[1].Valeur);
    }
}
