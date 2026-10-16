using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Domaine;
using LogiBTP.Socle;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Rejoue les jeux de test BTP partagés avec le moteur JS du cœur (tests/cas/*.json).
/// Le même fichier doit passer dans les deux suites.
/// </summary>
public class CasPartagesTests
{
    private static string Dossier(params string[] fin) => CasPartages.Chemin(["tests", .. fin]);

    public static TheoryData<string> Fichiers()
    {
        var data = new TheoryData<string>();
        foreach (var f in CasPartages.Fichiers(Dossier("cas"))) data.Add(f);
        return data;
    }

    private static JsonObject Lire(string fichier) => CasPartages.Lire(Path.Combine(Dossier("cas"), fichier));

    private static EntreeCalcul Entree(JsonObject cas) => cas["entree"].Deserialize<EntreeCalcul>(JsonCalcul.Options)!;

    private static JsonObject? TrouverLigne(JsonArray lignes, string cle)
    {
        if (!cle.StartsWith("ecart:", StringComparison.Ordinal)) return CasPartages.Trouver(lignes, "lig_id", cle);
        var parent = cle[6..];
        return lignes.Select(n => n!.AsObject())
            .FirstOrDefault(o => o["lig_is_ecart_arrondi"]!.GetValue<bool>() && o["lig_parent_id"]?.ToJsonString() == parent);
    }

    private static List<string> Controler(JsonObject cas, ResultatCalcul res)
    {
        var a = cas["attendu"]!.AsObject();
        var r = JsonSerializer.SerializeToNode(res, JsonCalcul.Options)!.AsObject();
        var fautes = new List<string>();
        CasPartages.VerifierErreurs(a["erreurs"], res.Erreurs.Select(e => e.Code), fautes);
        if (a["avertissements"] is JsonArray av) CasPartages.VerifierErreurs(av, res.Avertissements.Select(e => e.Code), fautes);
        // Ventilation des frais annexes : détail (tranche, ligne, montant) et bilan par tranche.
        if (a["ventilations_lignes"] is JsonArray vl)
        {
            var attendu = vl.Select(n => (n!["vfl_source_lig_id"]!.GetValue<long>(), n["vfl_lig_id"]!.GetValue<long>(), n["vfl_montant"]!.GetValue<decimal>())).ToList();
            var obtenu = res.VentilationsLignes.Select(v => (v.VflSourceLigId, v.VflLigId, v.VflMontant)).ToList();
            if (!attendu.SequenceEqual(obtenu)) fautes.Add($"ventilations_lignes : attendu [{string.Join(", ", attendu)}], obtenu [{string.Join(", ", obtenu)}]");
        }
        foreach (var (id, att) in a["frais_annexes"]?.AsObject() ?? [])
            CasPartages.Verifier(att!.AsObject(), CasPartages.Trouver(r["frais_annexes"]!.AsArray(), "lig_id", id), $"frais_annexes[{id}]", fautes);
        if (a["document"] is JsonObject doc) CasPartages.Verifier(doc, r["document"]!.AsObject(), "document", fautes);
        foreach (var (cle, att) in a["lignes"]?.AsObject() ?? [])
            CasPartages.Verifier(att!.AsObject(), TrouverLigne(r["lignes"]!.AsArray(), cle), $"lignes[{cle}]", fautes);
        foreach (var (id, att) in a["metres"]?.AsObject() ?? [])
            CasPartages.Verifier(att!.AsObject(), CasPartages.Trouver(r["metres"]!.AsArray(), "mtr_id", id), $"metres[{id}]", fautes);
        foreach (var (id, att) in a["variables"]?.AsObject() ?? [])
            CasPartages.Verifier(att!.AsObject(), CasPartages.Trouver(r["variables"]!.AsArray(), "var_id", id), $"variables[{id}]", fautes);
        foreach (var att in a["tva"]?.AsArray() ?? [])
        {
            var code = att!["tva_code"]!.GetValue<string>();
            CasPartages.Verifier(att.AsObject(), CasPartages.Trouver(r["tva"]!.AsArray(), "tva_code", code), $"tva[{code}]", fautes);
        }
        return fautes;
    }

    [Theory]
    [MemberData(nameof(Fichiers))]
    public void Cas_partage(string fichier)
    {
        var cas = Lire(fichier);
        Assert.Empty(Controler(cas, MoteurDevisBtp.Calculer(Entree(cas))));
    }

    [Theory]
    [MemberData(nameof(Fichiers))]
    public void Stabilite_recalculer_le_resultat_ne_change_rien(string fichier)
    {
        var entree = Entree(Lire(fichier));
        var r1 = MoteurDevisBtp.Calculer(entree);
        entree.Document = r1.Document;
        entree.Lignes = r1.Lignes;
        entree.Metres = r1.Metres;
        entree.Variables = r1.Variables;
        entree.Ventilations = r1.Ventilations;
        var r2 = MoteurDevisBtp.Calculer(entree);
        Assert.Empty(new ComparateurBtp().Comparer(r1, r2));
    }

    /// <summary>
    /// Parité complète avec le moteur JS du cœur : tous les champs calculés, pas seulement les valeurs attendues.
    /// Prérequis : <c>npm run exporter-resultats</c> à la racine (sinon le test ne vérifie rien).
    /// </summary>
    [Theory]
    [MemberData(nameof(Fichiers))]
    public void Parite_avec_le_moteur_js(string fichier)
    {
        var chemin = Dossier("resultats-js", fichier);
        if (!File.Exists(chemin)) return;
        var js = JsonSerializer.Deserialize<ResultatCalcul>(File.ReadAllText(chemin), JsonCalcul.Options)!;
        var cs = MoteurDevisBtp.Calculer(Entree(Lire(fichier)));
        Assert.Empty(new ComparateurBtp().Comparer(js, cs));
        Assert.Equal(js.Tva.Select(t => (t.TvaCode, t.TvaBaseHt, t.TvaMontantNet)), cs.Tva.Select(t => (t.TvaCode, t.TvaBaseHt, t.TvaMontantNet)));
        Assert.Equal(js.Erreurs.Select(e => (e.LigId, e.Code)), cs.Erreurs.Select(e => (e.LigId, e.Code)));
        Assert.Equal(js.Avertissements.Select(e => (e.LigId, e.Code)), cs.Avertissements.Select(e => (e.LigId, e.Code)));
        Assert.Equal(js.VentilationsLignes.Select(v => (v.VflSourceLigId, v.VflLigId, v.VflMontant, v.VflVfrId)),
            cs.VentilationsLignes.Select(v => (v.VflSourceLigId, v.VflLigId, v.VflMontant, v.VflVfrId)));
        Assert.Equal(js.FraisAnnexes, cs.FraisAnnexes);
    }

    /// <summary>Colonnes BTP = colonnes génériques du module Document + colonnes du cœur (colonnes-btp.js).</summary>
    [Fact]
    public void Colonnes_btp_alignees_avec_le_moteur_js()
    {
        var types = CasPartages.Chemin("modules", "document", "js", "src", "types.js");
        var btp = CasPartages.Chemin("client", "src", "calcul", "colonnes-btp.js");
        var ligne = CasPartages.ColonnesJs(types, "COLONNES_LIGNE").Union(CasPartages.ColonnesJs(btp, "COLONNES_LIGNE_BTP"));
        var document = CasPartages.ColonnesJs(types, "COLONNES_DOCUMENT").Union(CasPartages.ColonnesJs(btp, "COLONNES_DOCUMENT_BTP"));
        Assert.Equal(ligne.Order(), AccesColonnes.Colonnes(typeof(DocumentLigneBtp)).Order());
        Assert.Equal(document.Order(), AccesColonnes.Colonnes(typeof(DocumentBtp)).Order());
    }
}
