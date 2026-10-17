using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Metres.Script;
using LogiBTP.Socle;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Metres.Tests;

/// <summary>
/// Jeux du langage de script partagés avec le module JS (modules/metre/tests/scripts/*.json, test/cas-script.test.js) :
/// un fichier par thème, plusieurs cas par fichier. Hôte minimal : une ligne (id 1) et un seul contexte pour $ et @@.
/// </summary>
public class CasScriptTests
{
    private static string Dossier() => CasPartages.Chemin("modules", "metre", "tests", "scripts");

    public static TheoryData<string, int> Cas()
    {
        var data = new TheoryData<string, int>();
        foreach (var f in CasPartages.Fichiers(Dossier()))
        {
            var jeu = CasPartages.Lire(Path.Combine(Dossier(), f));
            for (var k = 0; k < jeu["cas"]!.AsArray().Count; k++) data.Add(f, k);
        }
        return data;
    }

    private static object? Valeur(JsonNode? n) => n?.GetValueKind() switch
    {
        null or JsonValueKind.Null => null,
        JsonValueKind.Number => n.GetValue<decimal>(),
        JsonValueKind.True or JsonValueKind.False => n.GetValue<bool>(),
        _ => n.GetValue<string>(),
    };

    private static JsonNode? Noeud(object? v) => v switch
    {
        null => null,
        decimal d => JsonValue.Create(d),
        bool b => JsonValue.Create(b),
        char c => JsonValue.Create(c.ToString()),
        _ => JsonValue.Create(v.ToString()),
    };

    [Theory]
    [MemberData(nameof(Cas))]
    public void Cas_partage(string fichier, int rang)
    {
        var cas = CasPartages.Lire(Path.Combine(Dossier(), fichier))["cas"]![rang]!.AsObject();
        var entree = cas["entree"]!.AsObject();
        var a = cas["attendu"]!.AsObject();

        var donnees = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var (col, v) in entree["donnees"]?.AsObject() ?? []) donnees[col] = Valeur(v);
        var portees = new Portees((_, _) => [0]);
        foreach (var (cible, v) in entree["variables_existantes"]?.AsObject() ?? [])
        {
            var r = (ReferenceVariable)References.Analyser(cible);
            portees.Affecter(r.Portee, r.Nom, "=", v!.GetValue<decimal>(), 1);
        }
        var ecrivables = entree["ecrivables"]?.AsArray().Select(n => n!.GetValue<string>()).ToHashSet() ?? [];
        var script = entree["script"] is JsonArray lignes ? string.Join("\n", lignes.Select(n => n!.GetValue<string>())) : entree["script"]!.GetValue<string>();
        var contexte = new ContexteScript
        {
            Resoudre = texte => References.Analyser(texte) switch
            {
                ReferenceVariable v => portees.LireValeur(v.Portee, v.Nom, 1),
                ReferenceDonnee d => donnees.TryGetValue(d.Colonne, out var x) ? x : throw new ErreurCalcul("COLONNE_INCONNUE", $"Colonne inconnue {d.Colonne}"),
                _ => throw new InvalidOperationException(),
            },
            Ecrire = (reference, valeur) =>
            {
                if (!ecrivables.Contains(reference)) throw new ErreurCalcul("ECRITURE_INTERDITE", $"{{{{{reference}}}}} ne peut pas être modifié");
                donnees[reference] = valeur;
            },
            Portees = portees,
            LigneId = 1,
        };
        var res = Interpreteur.Executer(script, contexte);

        var fautes = new List<string>();
        if (!CasPartages.Egal(a["resultat"], Noeud(res.Resultat))) fautes.Add($"resultat : attendu {a["resultat"]}, obtenu {res.Resultat}");
        foreach (var (nom, att) in a["variables"]?.AsObject() ?? [])
        {
            var v = res.Variables.FirstOrDefault(x => x.Nom == nom);
            if (v is null) { fautes.Add($"variable {nom} : absente"); continue; }
            var obtenu = new JsonObject
            {
                ["valeur"] = Noeud(v.Valeur), ["type"] = v.Type.ToString(), ["local"] = v.Local, ["parametre"] = v.Parametre, ["defaut"] = Noeud(v.Defaut),
            };
            var champs = att is JsonObject o ? o : new JsonObject { ["valeur"] = att?.DeepClone() };
            CasPartages.Verifier(champs, obtenu, $"variable {nom}", fautes);
        }
        if (a["nb_variables"] is { } nb && res.Variables.Count != nb.GetValue<int>()) fautes.Add($"nb_variables : attendu {nb}, obtenu {res.Variables.Count}");
        foreach (var (cible, v) in a["portees"]?.AsObject() ?? [])
        {
            var rv = (ReferenceVariable)References.Analyser(cible);
            var valeur = portees.LireValeur(rv.Portee, rv.Nom, 1);
            if (!CasPartages.Egal(v, Noeud(valeur))) fautes.Add($"portée {cible} : attendu {v}, obtenu {valeur}");
        }
        foreach (var (col, v) in a["donnees"]?.AsObject() ?? [])
        {
            if (!CasPartages.Egal(v, Noeud(donnees.GetValueOrDefault(col)))) fautes.Add($"donnée {col} : attendu {v}, obtenu {donnees.GetValueOrDefault(col)}");
        }
        var erreurs = res.Erreurs.Select(e => $"{e.Code}@{e.Ligne}:{e.Colonne}").ToList();
        var attErreurs = (a["erreurs"]?.AsArray() ?? []).Select(e => $"{e!["code"]}@{e["ligne"]}:{e["colonne"]}").ToList();
        if (!erreurs.SequenceEqual(attErreurs))
        {
            fautes.Add($"erreurs : attendu [{string.Join(", ", attErreurs)}], obtenu [{string.Join(", ", res.Erreurs.Select(e => $"{e.Code}@{e.Ligne}:{e.Colonne} {e.Message}"))}]");
        }
        var avert = res.Avertissements.Select(x => x.Code).ToList();
        var attAvert = (a["avertissements"]?.AsArray() ?? []).Select(x => x!.GetValue<string>()).ToList();
        if (!avert.SequenceEqual(attAvert)) fautes.Add($"avertissements : attendu [{string.Join(", ", attAvert)}], obtenu [{string.Join(", ", avert)}]");
        Assert.Empty(fautes);
    }
}
