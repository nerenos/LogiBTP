using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Documents.Tests;

using Entree = EntreeDocument<Document, DocumentLigne>;
using Moteur = MoteurDocument<Document, DocumentLigne>;
using Resultat = ResultatDocument<Document, DocumentLigne>;

/// <summary>
/// Jeux du module Document (moteur générique), partagés avec le module JS (modules/document/tests/cas).
/// </summary>
public class CasDocumentTests
{
    private static string Dossier(params string[] fin) => CasPartages.Chemin(["modules", "document", "tests", .. fin]);

    public static TheoryData<string> Fichiers()
    {
        var data = new TheoryData<string>();
        foreach (var f in CasPartages.Fichiers(Dossier("cas"))) data.Add(f);
        return data;
    }

    private static Entree LireEntree(string fichier) =>
        CasPartages.Lire(Path.Combine(Dossier("cas"), fichier))["entree"].Deserialize<Entree>(JsonCalcul.Options)!;

    [Theory]
    [MemberData(nameof(Fichiers))]
    public void Cas_partage(string fichier)
    {
        var cas = CasPartages.Lire(Path.Combine(Dossier("cas"), fichier));
        var a = cas["attendu"]!.AsObject();
        var res = Moteur.Calculer(LireEntree(fichier));
        var r = JsonSerializer.SerializeToNode(res, JsonCalcul.Options)!.AsObject();
        var fautes = new List<string>();
        CasPartages.VerifierErreurs(a["erreurs"], res.Erreurs.Select(e => e.Code), fautes);
        if (a["document"] is JsonObject doc) CasPartages.Verifier(doc, r["document"]!.AsObject(), "document", fautes);
        foreach (var (id, att) in a["lignes"]?.AsObject() ?? [])
            CasPartages.Verifier(att!.AsObject(), CasPartages.Trouver(r["lignes"]!.AsArray(), "lig_id", id), $"lignes[{id}]", fautes);
        foreach (var att in a["tva"]?.AsArray() ?? [])
        {
            var code = att!["tva_code"]!.GetValue<string>();
            CasPartages.Verifier(att.AsObject(), CasPartages.Trouver(r["tva"]!.AsArray(), "tva_code", code), $"tva[{code}]", fautes);
        }
        if (a["pied"] is JsonArray pied)
        {
            var obtenu = r["pied"]!.AsArray();
            Assert.Equal(pied.Count, obtenu.Count);
            for (var i = 0; i < pied.Count; i++)
            {
                // Lignes d'un groupe : tableau comparé à part (Verifier compare des valeurs).
                var att = pied[i]!.AsObject().DeepClone().AsObject();
                var lignes = att["lignes"];
                att.Remove("lignes");
                CasPartages.Verifier(att, obtenu[i]!.AsObject(), $"pied[{i}]", fautes);
                if (!JsonNode.DeepEquals(lignes, obtenu[i]!["lignes"])) fautes.Add($"pied[{i}].lignes : attendu {lignes?.ToJsonString()}, obtenu {obtenu[i]!["lignes"]?.ToJsonString()}");
            }
        }
        Assert.Empty(fautes);
    }

    [Theory]
    [MemberData(nameof(Fichiers))]
    public void Stabilite(string fichier)
    {
        var entree = LireEntree(fichier);
        var r1 = Moteur.Calculer(entree);
        entree.Document = r1.Document;
        entree.Lignes = r1.Lignes;
        var r2 = Moteur.Calculer(entree);
        Assert.Empty(new ComparateurCalcul().Comparer(r1.Document, r1.Lignes, r2.Document, r2.Lignes));
    }

    /// <summary>Parité complète avec le moteur générique JS (prérequis : npm run exporter-resultats).</summary>
    [Theory]
    [MemberData(nameof(Fichiers))]
    public void Parite_avec_le_moteur_js(string fichier)
    {
        var chemin = Dossier("resultats-js", fichier);
        if (!File.Exists(chemin)) return;
        var js = JsonSerializer.Deserialize<Resultat>(File.ReadAllText(chemin), JsonCalcul.Options)!;
        var cs = Moteur.Calculer(LireEntree(fichier));
        Assert.Empty(new ComparateurCalcul().Comparer(js.Document, js.Lignes, cs.Document, cs.Lignes));
        Assert.Equal(js.Tva.Select(t => (t.TvaCode, t.TvaBaseHt, t.TvaMontantNet)), cs.Tva.Select(t => (t.TvaCode, t.TvaBaseHt, t.TvaMontantNet)));
        Assert.Equal(js.Erreurs.Select(e => (e.LigId, e.Code)), cs.Erreurs.Select(e => (e.LigId, e.Code)));
    }

    [Fact]
    public void Colonnes_generiques_alignees_avec_le_module_js()
    {
        var types = CasPartages.Chemin("modules", "document", "js", "src", "types.js");
        Assert.Equal(CasPartages.ColonnesJs(types, "COLONNES_LIGNE").Order(), AccesColonnes.Colonnes(typeof(DocumentLigne)).Order());
        Assert.Equal(CasPartages.ColonnesJs(types, "COLONNES_DOCUMENT").Order(), AccesColonnes.Colonnes(typeof(Document)).Order());
    }
}
