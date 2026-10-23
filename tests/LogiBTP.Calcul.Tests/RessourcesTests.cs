using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Domaine.Ressources;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Jeux partagés avec client/src/app/ressources/regles.js (client/test/ressources.test.js).</summary>
public class RessourcesTests
{
    private static JsonObject Jeu(string f) => CasPartages.Lire(CasPartages.Chemin("tests", "ressources", f));

    private static DateOnly? Jour(JsonNode? n) => n is null ? null : DateOnly.ParseExact(n.GetValue<string>(), "yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static List<string> Codes(JsonNode? n) => n!.AsArray().Select(x => x!.GetValue<string>()).ToList();

    private static Dictionary<string, TypeHabilitation> Types(JsonObject j) => j["types"]!.AsObject().ToDictionary(
        x => x.Key, x => new TypeHabilitation(x.Value!["duree_mois"]?.GetValue<int>(), x.Value["concerne"]!.GetValue<string>(), x.Value["actif"]!.GetValue<bool>()));

    private static HabilitationEvaluee Hab(JsonNode h) => new(h["code"]!.GetValue<string>(), Jour(h["obtenue_le"]), Jour(h["valide_jusqu_au"]));

    [Fact]
    public void Habilitations_identiques_au_js()
    {
        var j = Jeu("01_habilitations.json");
        var types = Types(j);
        foreach (var c in j["mois"]!.AsArray())
        {
            Assert.Equal(Jour(c!["attendu"]), ReglesRessources.AjouterMois(Jour(c["date"])!.Value, c["n"]!.GetValue<int>()));
        }
        foreach (var c in j["etats"]!.AsArray())
        {
            var h = Hab(c!["h"]!);
            var e = ReglesRessources.Etat(h, types.TryGetValue(h.Code, out var t) ? t.DureeMois : null, Jour(c["date"])!.Value, c["seuil"]?.GetValue<int>() ?? ReglesRessources.SeuilRenouvellement);
            var a = c["attendu"]!;
            var nom = c["nom"]!.GetValue<string>();
            Assert.True(a["etat"]!.GetValue<string>() == e.Etat, nom);
            Assert.True(Jour(a["fin"]) == e.Fin, nom);
            Assert.True(a["jours_restants"]?.GetValue<int>() == e.JoursRestants, nom);
        }
        foreach (var c in j["manquantes"]!.AsArray())
        {
            var obtenu = ReglesRessources.Manquantes(Codes(c!["exigees"]), c["habilitations"]!.AsArray().Select(x => Hab(x!)), types, Jour(c["date"])!.Value);
            Assert.True(Codes(c["attendu"]).SequenceEqual(obtenu), c["nom"]!.GetValue<string>());
        }
        foreach (var c in j["controles"]!.AsArray())
        {
            var obtenu = ReglesRessources.Controler(Hab(c!["h"]!), types, c["element"]!.GetValue<string>());
            Assert.True(Codes(c["attendu"]).SequenceEqual(obtenu), c["nom"]!.GetValue<string>());
        }
    }

    private static MissionEvaluee Mission(JsonNode m) => new(m["id"]?.GetValue<int>(), Jour(m["debut"]), Jour(m["fin"]),
        m["agence_id"]?.GetValue<long>(), m["taux_horaire"]?.GetValue<decimal>());

    [Fact]
    public void Missions_identiques_au_js()
    {
        var j = Jeu("02_missions.json");
        foreach (var c in j["controles"]!.AsArray())
        {
            var obtenu = ReglesRessources.ControlerMissions(c!["missions"]!.AsArray().Select(x => Mission(x!)).ToList());
            var attendu = c["attendu"]!.AsArray();
            var nom = c["nom"]!.GetValue<string>();
            Assert.True(attendu.Count == obtenu.Count, nom);
            for (var i = 0; i < attendu.Count; i++)
            {
                Assert.True(attendu[i]!["index"]!.GetValue<int>() == obtenu[i].Index, nom);
                Assert.True(Codes(attendu[i]!["codes"]).SequenceEqual(obtenu[i].Codes), nom);
            }
        }
        foreach (var c in j["en_cours"]!.AsArray())
        {
            var m = ReglesRessources.EnCours(c!["missions"]!.AsArray().Select(x => Mission(x!)), Jour(c["date"])!.Value);
            Assert.True(c["attendu"]?.GetValue<int>() == m?.Id, c["nom"]!.GetValue<string>());
        }
    }

    private static MembreEquipe Membre(JsonNode m) => new(m["type"]!.GetValue<string>(), m["id"]!.GetValue<string>(), m["chef"]!.GetValue<bool>());

    private static PeriodeEquipe Periode(JsonNode p) => new(Jour(p["du"]), Jour(p["au"]), p["membres"]!.AsArray().Select(m => Membre(m!)).ToList());

    private static LigneComposition Ligne(JsonNode l) => new(l["type"]!.GetValue<string>(), l["id"]!.GetValue<string>(), Jour(l["du"])!.Value, Jour(l["au"]), l["chef"]!.GetValue<bool>());

    private static string Texte(IEnumerable<PeriodeEquipe> l) => string.Join(" ; ", l.Select(p => $"{p.Du}→{p.Au}: {string.Join(",", p.Membres)}"));

    [Fact]
    public void Equipes_identiques_au_js()
    {
        var j = Jeu("03_equipes.json");
        foreach (var c in j["periodes"]!.AsArray())
        {
            var attendu = c!["attendu"]!.AsArray().Select(p => Periode(p!)).ToList();
            var obtenu = ReglesEquipes.Periodes(c["lignes"]!.AsArray().Select(l => Ligne(l!)).ToList());
            Assert.True(Texte(attendu) == Texte(obtenu), $"{c["nom"]} : {Texte(obtenu)}");
        }
        foreach (var c in j["lignes"]!.AsArray())
        {
            var attendu = c!["attendu"]!.AsArray().Select(l => Ligne(l!)).ToList();
            Assert.Equal(attendu, ReglesEquipes.Lignes(c["periodes"]!.AsArray().Select(p => Periode(p!))));
        }
        foreach (var c in j["controles"]!.AsArray())
        {
            var e = c!["equipe"]!;
            var attendu = c["attendu"]!.AsArray().Select(x => new ErreurEquipe(x!["code"]!.GetValue<string>(), x["periode"]?.GetValue<int>())).ToList();
            var obtenu = ReglesEquipes.Controler(e["id"]?.GetValue<int>(), e["code"]?.GetValue<string>(), e["libelle"]?.GetValue<string>(),
                e["periodes"]!.AsArray().Select(p => Periode(p!)).ToList());
            Assert.Equal(attendu, obtenu);
        }
    }

    [Fact]
    public void Equipe_qui_contient_une_equipe_qui_la_contient()
    {
        var sous = new Dictionary<int, HashSet<int>> { [1] = [2], [2] = [3], [3] = [] };
        Assert.True(ReglesEquipes.Contient(sous, 1, 3));
        Assert.False(ReglesEquipes.Contient(sous, 3, 1));
    }
}
