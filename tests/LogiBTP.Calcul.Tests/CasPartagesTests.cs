using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using LogiBTP.Calcul;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Rejoue les jeux de test partagés avec le moteur JS (tests/cas/*.json, tests/expressions.json).
/// Le même fichier doit passer dans les deux suites.
/// </summary>
public class CasPartagesTests
{
    private static string RacineTests()
    {
        var d = new DirectoryInfo(AppContext.BaseDirectory);
        while (d is not null && !File.Exists(Path.Combine(d.FullName, "LogiBTP.slnx"))) d = d.Parent;
        return Path.Combine(d?.FullName ?? throw new DirectoryNotFoundException("LogiBTP.slnx introuvable"), "tests");
    }

    public static TheoryData<string> Fichiers()
    {
        var data = new TheoryData<string>();
        foreach (var f in Directory.GetFiles(Path.Combine(RacineTests(), "cas"), "*.json").Order(StringComparer.Ordinal))
        {
            data.Add(Path.GetFileName(f));
        }
        return data;
    }

    private static JsonObject Lire(string fichier) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(RacineTests(), "cas", fichier)))!.AsObject();

    private static bool Egal(JsonNode? attendu, JsonNode? obtenu)
    {
        if (attendu is null) return obtenu is null;
        if (obtenu is null) return false;
        var a = attendu.AsValue();
        var o = obtenu.AsValue();
        return a.GetValueKind() switch
        {
            JsonValueKind.Number => o.GetValueKind() == JsonValueKind.Number && a.GetValue<decimal>() == o.GetValue<decimal>(),
            JsonValueKind.True or JsonValueKind.False => o.GetValueKind() == a.GetValueKind(),
            _ => o.GetValueKind() == JsonValueKind.String && a.GetValue<string>() == o.GetValue<string>(),
        };
    }

    private static void Verifier(JsonObject attendu, JsonObject? obtenu, string chemin, List<string> fautes)
    {
        if (obtenu is null) { fautes.Add($"{chemin} : introuvable"); return; }
        foreach (var (champ, v) in attendu)
        {
            obtenu.TryGetPropertyValue(champ, out var o);
            if (!Egal(v, o)) fautes.Add($"{chemin}.{champ} : attendu {v?.ToJsonString() ?? "null"}, obtenu {o?.ToJsonString() ?? "null"}");
        }
    }

    private static JsonObject? Trouver(JsonArray liste, string champ, string valeur) =>
        liste.Select(n => n!.AsObject()).FirstOrDefault(o => o[champ]?.ToJsonString().Trim('"') == valeur);

    private static JsonObject? TrouverLigne(JsonArray lignes, string cle)
    {
        if (!cle.StartsWith("ecart:", StringComparison.Ordinal)) return Trouver(lignes, "lig_id", cle);
        var parent = cle[6..];
        return lignes.Select(n => n!.AsObject())
            .FirstOrDefault(o => o["lig_is_ecart_arrondi"]!.GetValue<bool>() && o["lig_parent_id"]?.ToJsonString() == parent);
    }

    private static List<string> Controler(JsonObject cas, ResultatCalcul res)
    {
        var a = cas["attendu"]!.AsObject();
        var r = JsonSerializer.SerializeToNode(res, JsonCalcul.Options)!.AsObject();
        var fautes = new List<string>();

        var codes = res.Erreurs.Select(e => e.Code).Order(StringComparer.Ordinal).ToList();
        var codesAttendus = (a["erreurs"]?.AsArray().Select(n => n!.GetValue<string>()) ?? []).Order(StringComparer.Ordinal).ToList();
        if (!codes.SequenceEqual(codesAttendus))
        {
            fautes.Add($"erreurs : attendu [{string.Join(", ", codesAttendus)}], obtenu {JsonSerializer.Serialize(res.Erreurs, JsonCalcul.Options)}");
        }
        if (a["document"] is JsonObject doc) Verifier(doc, r["document"]!.AsObject(), "document", fautes);
        foreach (var (cle, att) in a["lignes"]?.AsObject() ?? [])
            Verifier(att!.AsObject(), TrouverLigne(r["lignes"]!.AsArray(), cle), $"lignes[{cle}]", fautes);
        foreach (var (id, att) in a["metres"]?.AsObject() ?? [])
            Verifier(att!.AsObject(), Trouver(r["metres"]!.AsArray(), "mtr_id", id), $"metres[{id}]", fautes);
        foreach (var (id, att) in a["metre_lignes"]?.AsObject() ?? [])
            Verifier(att!.AsObject(), Trouver(r["metre_lignes"]!.AsArray(), "mli_id", id), $"metre_lignes[{id}]", fautes);
        foreach (var (id, att) in a["variables"]?.AsObject() ?? [])
            Verifier(att!.AsObject(), Trouver(r["variables"]!.AsArray(), "var_id", id), $"variables[{id}]", fautes);
        foreach (var att in a["tva"]?.AsArray() ?? [])
        {
            var code = att!["tva_code"]!.GetValue<string>();
            Verifier(att.AsObject(), Trouver(r["tva"]!.AsArray(), "tva_code", code), $"tva[{code}]", fautes);
        }
        return fautes;
    }

    private static EntreeCalcul Entree(JsonObject cas) => cas["entree"].Deserialize<EntreeCalcul>(JsonCalcul.Options)!;

    [Theory]
    [MemberData(nameof(Fichiers))]
    public void Cas_partage(string fichier)
    {
        var cas = Lire(fichier);
        var res = MoteurCalcul.Calculer(Entree(cas));
        Assert.Empty(Controler(cas, res));
    }

    [Theory]
    [MemberData(nameof(Fichiers))]
    public void Stabilite_recalculer_le_resultat_ne_change_rien(string fichier)
    {
        var entree = Entree(Lire(fichier));
        var r1 = MoteurCalcul.Calculer(entree);
        entree.Document = r1.Document;
        entree.Lignes = r1.Lignes;
        entree.Metres = r1.Metres;
        entree.MetreLignes = r1.MetreLignes;
        entree.Variables = r1.Variables;
        var r2 = MoteurCalcul.Calculer(entree);
        Assert.Empty(ComparateurCalcul.Comparer(r1, r2));
    }

    /// <summary>
    /// Parité complète avec le moteur JS : comparer tous les champs calculés, pas seulement les valeurs attendues.
    /// Prérequis : <c>npm run exporter-resultats</c> dans client/ (sinon le test ne vérifie rien).
    /// </summary>
    [Theory]
    [MemberData(nameof(Fichiers))]
    public void Parite_avec_le_moteur_js(string fichier)
    {
        var chemin = Path.Combine(RacineTests(), "resultats-js", fichier);
        if (!File.Exists(chemin)) return;
        var js = JsonSerializer.Deserialize<ResultatCalcul>(File.ReadAllText(chemin), JsonCalcul.Options)!;
        var cs = MoteurCalcul.Calculer(Entree(Lire(fichier)));
        Assert.Empty(ComparateurCalcul.Comparer(js, cs));
        Assert.Equal(js.Tva.Select(t => (t.TvaCode, t.TvaBaseHt, t.TvaMontantNet)), cs.Tva.Select(t => (t.TvaCode, t.TvaBaseHt, t.TvaMontantNet)));
        Assert.Equal(js.Erreurs.Select(e => (e.LigId, e.Code)), cs.Erreurs.Select(e => (e.LigId, e.Code)));
    }

    [Fact]
    public void Colonnes_alignees_avec_le_moteur_js()
    {
        var types = File.ReadAllText(Path.Combine(RacineTests(), "..", "client", "src", "calcul", "types.js"));
        HashSet<string> Extraire(string nom)
        {
            var bloc = Regex.Match(types, $@"{nom} = new Set\(\[(.*?)\]\)", RegexOptions.Singleline).Groups[1].Value;
            return Regex.Matches(bloc, "'([a-z_]+)'").Select(m => m.Groups[1].Value).ToHashSet();
        }
        Assert.Equal(Extraire("COLONNES_LIGNE").Order(), AccesColonnes.ColonnesLigne.Order());
        Assert.Equal(Extraire("COLONNES_DOCUMENT").Order(), AccesColonnes.ColonnesDocument.Order());
    }

    public static TheoryData<string> Expressions()
    {
        var data = new TheoryData<string>();
        var jeu = JsonNode.Parse(File.ReadAllText(Path.Combine(RacineTests(), "expressions.json")))!;
        foreach (var c in jeu["cas"]!.AsArray()) data.Add(c!["formule"]!.GetValue<string>());
        return data;
    }

    [Theory]
    [MemberData(nameof(Expressions))]
    public void Analyseur_expressions(string formule)
    {
        var jeu = JsonNode.Parse(File.ReadAllText(Path.Combine(RacineTests(), "expressions.json")))!;
        var cas = jeu["cas"]!.AsArray().First(c => c!["formule"]!.GetValue<string>() == formule)!;
        var variables = jeu["variables"]!.AsObject();
        decimal Resoudre(string reference)
        {
            var r = References.Analyser(reference);
            var cle = r is ReferenceVariable v ? v.Portee + v.Nom : ((ReferenceDonnee)r).Colonne;
            return variables.TryGetPropertyValue(cle, out var n)
                ? n!.GetValue<decimal>()
                : throw new ErreurCalcul("VARIABLE_INCONNUE", $"Variable {{{{{reference}}}}} non définie");
        }

        if (cas["erreur"] is JsonNode erreur)
        {
            var e = Assert.Throws<ErreurCalcul>(() => Expression.Evaluer(formule, Resoudre));
            Assert.Equal(erreur.GetValue<string>(), e.Code);
        }
        else
        {
            Assert.Equal(cas["resultat"]!.GetValue<decimal>(), Expression.Evaluer(formule, Resoudre));
        }
    }

    [Theory]
    [InlineData(2.5, 0, 3)]
    [InlineData(-2.5, 0, -3)]
    [InlineData(0.125, 2, 0.13)]
    [InlineData(1.005, 2, 1.01)]
    public void Arrondi_commercial_jamais_bancaire(double valeur, int precision, double attendu) =>
        Assert.Equal((decimal)attendu, ArrondiCalcul.Arrondir((decimal)valeur, precision));

    [Fact]
    public void Format_nombre_libelle() =>
        Assert.Equal("12,5", ArrondiCalcul.FormatNombre(decimal.Parse("12.500000", CultureInfo.InvariantCulture)));
}
