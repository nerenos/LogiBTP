using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Metres.Script;
using LogiBTP.Socle;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Metres.Tests;

/// <summary>
/// Jeux de conversion des métrés en lignes partagés avec le module JS (modules/metre/tests/conversion/*.json,
/// test/conversion.test.js) : même texte de script, puis exécution (mêmes résultats que l'ancien évaluateur).
/// Hôte minimal : une ligne (id 1) et un seul contexte pour les portées $ et @@.
/// </summary>
public class CasConversionTests
{
    private static string Dossier() => CasPartages.Chemin("modules", "metre", "tests", "conversion");

    public static TheoryData<string> Fichiers()
    {
        var data = new TheoryData<string>();
        foreach (var f in CasPartages.Fichiers(Dossier())) data.Add(f);
        return data;
    }

    [Theory]
    [MemberData(nameof(Fichiers))]
    public void Cas_partage(string fichier)
    {
        var cas = CasPartages.Lire(Path.Combine(Dossier(), fichier));
        var e = cas["entree"]!.AsObject();
        var a = cas["attendu"]!.AsObject();
        var metre = e["metre"].Deserialize<Metre>(JsonCalcul.Options)!;
        var lignes = e["metre_lignes"].Deserialize<List<LigneMetreAncienne>>(JsonCalcul.Options)!;
        var definitions = e["definitions"]?.Deserialize<List<VariableDefinition>>(JsonCalcul.Options) ?? [];

        var c = ConversionMetre.Convertir(metre, lignes, definitions);
        Assert.Equal(a["script"]!.AsArray().Select(n => n!.GetValue<string>()), c.MtrScript.Split('\n'));
        Assert.Equal(a["mtr_variable"]?.GetValue<string>(), c.MtrVariable);
        Assert.Equal((a["variables_ligne"]?.AsArray() ?? []).Select(n => n!.GetValue<long>()), c.VariablesLigne.Select(v => v.VarId));

        var portees = new Portees((_, _) => [0]);
        foreach (var (cible, v) in e["variables_existantes"]?.AsObject() ?? [])
        {
            var r = (ReferenceVariable)References.Analyser(cible);
            portees.Affecter(r.Portee, r.Nom, "=", v!.GetValue<decimal>(), 1);
        }
        var donnees = e["donnees"]?.AsObject();
        object? Resoudre(string texte)
        {
            var r = References.Analyser(texte);
            if (r is ReferenceVariable v) return portees.Lire(v.Portee, v.Nom, 1);
            var col = ((ReferenceDonnee)r).Colonne;
            return donnees is not null && donnees.TryGetPropertyValue(col, out var n)
                ? n!.GetValue<decimal>()
                : throw new ErreurCalcul("COLONNE_INCONNUE", $"Colonne inconnue {col}");
        }
        metre.MtrScript = c.MtrScript;
        metre.MtrVariable = c.MtrVariable;
        var res = ScriptMetre.Evaluer(metre, new ContexteScript { Resoudre = Resoudre, Portees = portees, LigneId = 1 });
        if (a["erreur"] is JsonNode erreur)
        {
            Assert.Equal([erreur.GetValue<string>()], res.Erreurs.Select(x => x.Code));
            return;
        }
        Assert.Empty(res.Erreurs);
        Assert.Equal(a["mtr_resultat"]!.GetValue<decimal>(), metre.MtrResultat);
        foreach (var (cible, v) in a["variables"]?.AsObject() ?? [])
        {
            var rv = (ReferenceVariable)References.Analyser(cible);
            Assert.Equal(v!.GetValue<decimal>(), portees.Lire(rv.Portee, rv.Nom, 1));
        }
    }

    [Fact]
    public void Composition_d_ouvrage_convertie_sans_lignes_de_metre()
    {
        // Composition de l'ouvrage de démonstration « Dalle béton » avant conversion (ancien db/116).
        const string json = """
            {"mode":"D","lignes":[{"lig_id":2,"lig_mtr_id":10,"lig_qte_source":"M"}],
             "metres":[{"mtr_id":10,"mtr_lig_id":2,"mtr_libelle":"Volume de béton par m²","mtr_unt_code":"m3","mtr_variable":null}],
             "metre_lignes":[{"mli_id":11,"mli_mtr_id":10,"mli_parent_id":null,"mli_ordre":1,"mli_type":"V","mli_operateur":"+","mli_formule":"1","mli_commentaire":"Surface (1 m²)"},
                             {"mli_id":12,"mli_mtr_id":10,"mli_parent_id":null,"mli_ordre":2,"mli_type":"V","mli_operateur":"*","mli_formule":"0,15","mli_commentaire":"Épaisseur"}],
             "variables":[{"var_id":5,"var_lig_id":2,"var_mtr_id":10,"var_portee":"@@","var_nom":"volume","var_operation":"=","var_formule":"{{lig_qte_vendue}}","var_ordre":1}]}
            """;
        var c = JsonNode.Parse(ConversionMetre.ConvertirComposition(json))!.AsObject();
        Assert.False(c.ContainsKey("metre_lignes"));
        Assert.Equal("D", c["mode"]!.GetValue<string>());
        Assert.Single(c["lignes"]!.AsArray());
        Assert.Equal(
            "// Métré converti depuis la saisie en lignes (valeurs, sous-détails, sous-totaux).\n" +
            "local L1 est un numérique = 1 // Surface (1 m²)\nlocal L2 est un numérique = 0,15 // Épaisseur\nRenvoyer L1 * L2",
            c["metres"]![0]!["mtr_script"]!.GetValue<string>());
        // La définition lit la quantité calculée : elle devient une variable de ligne.
        var v = c["variables"]![0]!;
        Assert.Null(v["var_mtr_id"]);
        Assert.Equal(2, v["var_lig_id"]!.GetValue<long>());
    }
}
