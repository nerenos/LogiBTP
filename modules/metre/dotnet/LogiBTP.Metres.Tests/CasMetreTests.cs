using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Metres.Tests;

/// <summary>
/// Jeux partagés avec le module JS (modules/metre/tests/cas/*.json) : le module se teste sans document hôte.
/// Hôte minimal : une ligne (id 1) et un seul contexte pour les portées $ et @@.
/// </summary>
public class CasMetreTests
{
    private static string Dossier() => CasPartages.Chemin("modules", "metre", "tests", "cas");

    public static TheoryData<string> Fichiers()
    {
        var data = new TheoryData<string>();
        foreach (var f in CasPartages.Fichiers(Dossier())) data.Add(f);
        return data;
    }

    private sealed record Execution(Metre Metre, List<MetreLigne> Lignes, List<VariableDefinition> Definitions, Portees Portees);

    private static Execution Executer(JsonObject entree)
    {
        var portees = new Portees((_, _) => [0]);
        foreach (var (cible, v) in entree["variables_existantes"]?.AsObject() ?? [])
        {
            var r = (ReferenceVariable)References.Analyser(cible);
            portees.Affecter(r.Portee, r.Nom, "=", v!.GetValue<decimal>(), 1);
        }
        var donnees = entree["donnees"]?.AsObject();
        decimal Resoudre(string texte)
        {
            var r = References.Analyser(texte);
            if (r is ReferenceVariable v) return portees.Lire(v.Portee, v.Nom, 1);
            var col = ((ReferenceDonnee)r).Colonne;
            return donnees is not null && donnees.TryGetPropertyValue(col, out var n)
                ? n!.GetValue<decimal>()
                : throw new ErreurCalcul("COLONNE_INCONNUE", $"Colonne inconnue {col}");
        }
        var metre = entree["metre"].Deserialize<Metre>(JsonCalcul.Options)!;
        var lignes = entree["metre_lignes"].Deserialize<List<MetreLigne>>(JsonCalcul.Options)!;
        var definitions = entree["definitions"]?.Deserialize<List<VariableDefinition>>(JsonCalcul.Options) ?? [];
        new EvaluateurMetre(Resoudre, (p, n, val) => portees.Affecter(p, n, "=", val, 1)).Evaluer(metre, lignes);
        foreach (var d in definitions.OrderBy(d => d.VarOrdre).ThenBy(d => d.VarId)) Variables.Evaluer(d, Resoudre, portees, 1);
        return new Execution(metre, lignes, definitions, portees);
    }

    [Theory]
    [MemberData(nameof(Fichiers))]
    public void Cas_partage(string fichier)
    {
        var cas = CasPartages.Lire(Path.Combine(Dossier(), fichier));
        var a = cas["attendu"]!.AsObject();
        var entree = cas["entree"]!.AsObject();
        if (a["erreur"] is JsonNode erreur)
        {
            var e = Assert.Throws<ErreurCalcul>(() => Executer(entree));
            Assert.Equal(erreur.GetValue<string>(), e.Code);
            return;
        }
        var r = Executer(entree);
        var fautes = new List<string>();
        var obtenu = JsonSerializer.SerializeToNode(r.Metre, JsonCalcul.Options)!.AsObject();
        if (!CasPartages.Egal(a["mtr_resultat"], obtenu["mtr_resultat"])) fautes.Add($"mtr_resultat : attendu {a["mtr_resultat"]}, obtenu {obtenu["mtr_resultat"]}");
        var lignes = JsonSerializer.SerializeToNode(r.Lignes, JsonCalcul.Options)!.AsArray();
        foreach (var (id, att) in a["metre_lignes"]?.AsObject() ?? [])
            CasPartages.Verifier(att!.AsObject(), CasPartages.Trouver(lignes, "mli_id", id), $"metre_lignes[{id}]", fautes);
        var defs = JsonSerializer.SerializeToNode(r.Definitions, JsonCalcul.Options)!.AsArray();
        foreach (var (id, att) in a["definitions"]?.AsObject() ?? [])
            CasPartages.Verifier(att!.AsObject(), CasPartages.Trouver(defs, "var_id", id), $"definitions[{id}]", fautes);
        foreach (var (cible, v) in a["variables"]?.AsObject() ?? [])
        {
            var rv = (ReferenceVariable)References.Analyser(cible);
            var valeur = r.Portees.Lire(rv.Portee, rv.Nom, 1);
            if (valeur != v!.GetValue<decimal>()) fautes.Add($"variable {cible} : attendu {v}, obtenu {valeur}");
        }
        Assert.Empty(fautes);
    }
}
