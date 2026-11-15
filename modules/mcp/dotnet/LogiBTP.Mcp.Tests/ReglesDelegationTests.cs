using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Mcp.Tests;

/// <summary>Jeu partagé avec delegation.js : modèles, garde-fous actifs, interdits, droits effectifs, contrôles, échéances, quotas, classement.</summary>
public class ReglesDelegationTests
{
    private static readonly JsonObject Jeu = CasPartages.Lire(CasPartages.Chemin("modules", "mcp", "tests", "cas", "01_delegation.json"));

    // Lecture du jeu.
    private static List<string>? Liste(JsonNode? n) => n?.AsArray().Select(x => x!.GetValue<string>()).ToList();

    private static Dictionary<string, IReadOnlyList<string>>? Arbre(JsonNode? n) =>
        n?.AsObject().ToDictionary(kv => kv.Key, kv => (IReadOnlyList<string>)Liste(kv.Value)!);

    private static DroitsProfil Profil(JsonNode? nom)
    {
        var o = Jeu["profils"]![nom!.GetValue<string>()]!;
        return new DroitsProfil(o["total"]!.GetValue<bool>(),
            (o["lignes"]?.AsObject() ?? []).ToDictionary(kv => kv.Key,
                kv => (IReadOnlyDictionary<string, string>)kv.Value!.AsObject().ToDictionary(a => a.Key, a => a.Value!.GetValue<string>())));
    }

    private static PlafondDelegation Plafond(JsonNode? n) =>
        new(n?["modele"]?.GetValue<string>(), Arbre(n?["actions"]), n?["portee"]?.GetValue<string>());

    private static OptionsDelegation Options(JsonNode c) => new(Arbre(Jeu["catalogue"]), Arbre(Jeu["noeuds"]), Liste(c["interdits"]) ?? []);

    private static IEnumerable<JsonObject> Cas(string nom) => Jeu[nom]!.AsArray().Select(c => c!.AsObject());

    // Comparaison : clés des objets triées (l'ordre des lignes n'a pas de sens).
    private static string Canonique(JsonNode? n) => n switch
    {
        null => "null",
        JsonObject o => "{" + string.Join(",", o.OrderBy(kv => kv.Key, StringComparer.Ordinal).Select(kv => $"\"{kv.Key}\":{Canonique(kv.Value)}")) + "}",
        JsonArray a => "[" + string.Join(",", a.Select(Canonique)) + "]",
        _ => n.ToJsonString(),
    };

    private static JsonArray? Json(IEnumerable<string>? l) => l is null ? null : new(l.Select(x => (JsonNode)x).ToArray());

    private static JsonObject Json(DroitsProfil d) => new()
    {
        ["total"] = d.Total,
        ["lignes"] = new JsonObject(d.Lignes.Select(kv => KeyValuePair.Create(kv.Key,
            (JsonNode?)new JsonObject(kv.Value.Select(a => KeyValuePair.Create(a.Key, (JsonNode?)a.Value)))))),
    };

    private static void Verifier(List<string> fautes, string section, JsonObject c, JsonNode? obtenu)
    {
        if (Canonique(c["attendu"]) != Canonique(obtenu))
            fautes.Add($"{section} « {c["nom"] ?? c["modele"]} » : attendu {Canonique(c["attendu"])}, obtenu {Canonique(obtenu)}");
    }

    [Fact]
    public void Jeu_partage()
    {
        var fautes = new List<string>();
        foreach (var c in Cas("modeles"))
            Verifier(fautes, "modèle", c, Json(ReglesDelegation.ActionsModele(c["modele"]!.GetValue<string>())));
        foreach (var c in Cas("actifs"))
            Verifier(fautes, "actifs", c, Json(ReglesDelegation.GardesFousActifs(Liste(c["levables"]), Liste(c["leves"]))));
        foreach (var c in Cas("interdits"))
            Verifier(fautes, "interdit", c, ReglesDelegation.EstInterdit(c["noeud"]!.GetValue<string>(), c["action"]!.GetValue<string>(), Liste(c["interdits"])));
        foreach (var c in Cas("effectifs"))
            Verifier(fautes, "effectifs", c, Json(ReglesDelegation.DroitsEffectifs(Profil(c["profil"]), Plafond(c["plafond"]), Liste(c["gardes_fous"]), Options(c))));
        foreach (var c in Cas("controles"))
        {
            var d = c["delegation"]!;
            var p = c["delegant"]!;
            Verifier(fautes, "contrôle", c, Json(ReglesDelegation.ControlerDelegation(
                new DelegationSaisie(d["modele"]?.GetValue<string>(), d["jours"]?.GetValue<int>(), Liste(d["leves"])),
                new Delegant(p["total"]!.GetValue<bool>(), Liste(p["levables"]), Liste(p["modeles"]), p["jours_max"]?.GetValue<int>()))));
        }
        foreach (var c in Cas("echeances"))
            Verifier(fautes, "échéance", c, ReglesDelegation.EcheanceDelegation(DateOnly.Parse(c["debut"]!.GetValue<string>(), CultureInfo.InvariantCulture),
                c["jours"]?.GetValue<int>(), c["jours_max"]?.GetValue<int>()).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        foreach (var c in Cas("quotas"))
        {
            var q = c["quotas"];
            var r = ReglesDelegation.AppliquerQuota(c["demandes"]!.GetValue<int>(), c["deja"]!.GetValue<int>(),
                q is null ? null : new QuotasDelegation(q["appel"]?.GetValue<int>(), q["jour"]?.GetValue<int>(), q["alerte"]?.GetValue<int>()));
            Verifier(fautes, "quota", c, new JsonObject { ["accordes"] = r.Accordes, ["tronque"] = r.Tronque, ["erreur"] = r.Erreur, ["alerte"] = r.Alerte });
        }
        foreach (var c in Cas("classements"))
        {
            var o = c["outil"]!;
            Verifier(fautes, "classement", c, ReglesDelegation.ClasserOutil(
                new OutilAgent(o["noeud"]!.GetValue<string>(), o["action"]!.GetValue<string>(), o["envoi"]?.GetValue<bool>() ?? false),
                Profil(c["profil"]), Plafond(c["plafond"]), Liste(c["gardes_fous"]), Options(c)));
        }
        Assert.True(fautes.Count == 0, string.Join("\n", fautes));
    }
}
