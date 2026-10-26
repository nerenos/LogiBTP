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

    private static PeriodeEquipe Periode(JsonNode p) => new(Jour(p["du"]), p["membres"]!.AsArray().Select(m => Membre(m!)).ToList());

    private static LigneComposition Ligne(JsonNode l) => new(l["type"]!.GetValue<string>(), l["id"]!.GetValue<string>(), Jour(l["du"])!.Value, Jour(l["au"]), l["chef"]!.GetValue<bool>());

    private static string Texte(IEnumerable<PeriodeDatee> l) => string.Join(" ; ", l.Select(p => $"{p.Du}→{p.Au}: {string.Join(",", p.Membres)}"));

    [Fact]
    public void Equipes_identiques_au_js()
    {
        var j = Jeu("03_equipes.json");
        foreach (var c in j["fins"]!.AsArray())
        {
            var obtenu = ReglesEquipes.Fins(c!["periodes"]!.AsArray().Select(p => Periode(p!)));
            Assert.Equal(c["attendu"]!.AsArray().Select(a => (Jour(a!["du"]), Jour(a["au"]))).ToList(), obtenu.Select(p => ((DateOnly?)p.Du, p.Au)).ToList());
        }
        foreach (var c in j["periodes"]!.AsArray())
        {
            var attendu = c!["attendu"]!.AsArray().Select(p => new PeriodeDatee(Jour(p!["du"])!.Value, Jour(p["au"]), p["membres"]!.AsArray().Select(m => Membre(m!)).ToList())).ToList();
            var obtenu = ReglesEquipes.Periodes(c["lignes"]!.AsArray().Select(l => Ligne(l!)).ToList(), c["debuts"]!.AsArray().Select(d => Jour(d)!.Value));
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
    private static AffectationMateriel Affectation(JsonNode a) => new(a["type"]!.GetValue<string>(), a["id"]?.GetValue<string>(), Jour(a["du"]), Jour(a["au"]));

    [Fact]
    public void Affectations_identiques_au_js()
    {
        var j = Jeu("04_affectations.json");
        foreach (var c in j["controles"]!.AsArray())
        {
            var attendu = c!["attendu"]!.AsArray().Select(x => new ErreurAffectation(x!["code"]!.GetValue<string>(), x["affectation"]!.GetValue<int>())).ToList();
            Assert.Equal(attendu, ReglesAffectations.Controler(c["materiel"]!.GetValue<string>(), c["affectations"]!.AsArray().Select(a => Affectation(a!)).ToList()));
        }
        foreach (var c in j["a_date"]!.AsArray())
        {
            var affectations = c!["affectations"]!.AsArray().Select(a => Affectation(a!)).ToList();
            foreach (var (date, attendu) in c["dates"]!.AsObject())
                Assert.Equal(attendu?.GetValue<int>(), ReglesAffectations.A(affectations, Jour(JsonValue.Create(date))!.Value));
        }
    }

    [Fact]
    public void Materiel_porteur_en_boucle()
    {
        var porteurs = new Dictionary<string, string> { ["2"] = "1", ["3"] = "2" };
        Assert.True(ReglesAffectations.Boucle(porteurs, "1", "3"));
        Assert.False(ReglesAffectations.Boucle(porteurs, "4", "3"));
    }

    private static decimal? Nombre(JsonNode? n) => n?.GetValue<decimal>();

    private static ReleveCompteur Releve(JsonNode r) =>
        new(r["unite"]?.GetValue<string>(), Jour(r["date"]), Nombre(r["valeur"]), r["remise"]?.GetValue<bool>() ?? false);

    [Fact]
    public void Compteurs_identiques_au_js()
    {
        var j = Jeu("05_compteurs.json");
        foreach (var c in j["controles"]!.AsArray())
        {
            var attendu = c!["attendu"]!.AsArray().Select(x => new ErreurReleve(x!["code"]!.GetValue<string>(), x["releve"]!.GetValue<int>())).ToList();
            Assert.Equal(attendu, ReglesCompteurs.Controler(Codes(c["unites"]), c["releves"]!.AsArray().Select(r => Releve(r!)).ToList()));
        }
        foreach (var c in j["a_date"]!.AsArray())
        {
            var releves = c!["releves"]!.AsArray().Select(r => Releve(r!)).ToList();
            foreach (var (date, attendu) in c["dates"]!.AsObject())
                Assert.Equal(Nombre(attendu), ReglesCompteurs.A(releves, c["unite"]!.GetValue<string>(), Jour(JsonValue.Create(date))!.Value));
        }
        foreach (var c in j["cumuls"]!.AsArray())
        {
            var attendu = c!["attendu"]!.AsArray().Select(x => new PointCompteur(x!["releve"]!.GetValue<int>(), Jour(x["date"])!.Value, x["valeur"]!.GetValue<decimal>(), x["cumul"]!.GetValue<decimal>())).ToList();
            Assert.Equal(attendu, ReglesCompteurs.Cumuls(c["releves"]!.AsArray().Select(r => Releve(r!)).ToList(), c["unite"]!.GetValue<string>()));
        }
        foreach (var c in j["evenements"]!.AsArray())
        {
            var e = c!["evenement"]!;
            var evt = new EvenementMateriel(e["type"]?.GetValue<string>(), Jour(e["date"]), Jour(e["fin"]), e["libelle"]?.GetValue<string>(), Nombre(e["litres"]), Nombre(e["cout"]));
            Assert.Equal(Codes(c["attendu"]), ReglesCompteurs.ControlerEvenement(evt));
        }
    }

    private static PlanEntretien Plan(JsonNode p) => new(p["code"]!.GetValue<string>(), null, Nombre(p["heures"]), Nombre(p["km"]), p["mois"]?.GetValue<int>(), p["actif"]?.GetValue<bool>() ?? true);

    private static PointCompteurs? Point(JsonNode? p) => p is null ? null : new(Jour(p["date"]), Nombre(p["H"]), Nombre(p["KM"]));

    [Fact]
    public void Entretiens_identiques_au_js()
    {
        var j = Jeu("06_entretiens.json");
        foreach (var c in j["plans"]!.AsArray())
        {
            var listes = c!["listes"]!.AsArray().Select(l => l!.AsArray().Select(p => Plan(p!)).ToList()).ToList();
            var attendu = c["attendu"]!.AsArray().Select(x => (x!["code"]!.GetValue<string>(), Nombre(x["heures"]))).ToList();
            Assert.Equal(attendu, ReglesEntretiens.PlansEffectifs(listes).Select(p => (p.Code, p.Heures)).ToList());
        }
        var releves = j["releves"]!.AsArray().Select(r => Releve(r!)).ToList();
        foreach (var (date, attendu) in j["cumuls"]!.AsObject())
            Assert.Equal(Nombre(attendu), ReglesEntretiens.CumulA(releves, "H", Jour(JsonValue.Create(date))!.Value));
        foreach (var c in j["moyennes"]!.AsArray())
            Assert.Equal(Nombre(c!["attendu"]), ReglesEntretiens.MoyenneUsage(releves, "H", Jour(c["date"])!.Value, c["jours"]!.GetValue<int>()));
        foreach (var c in j["echeances"]!.AsArray())
        {
            var m = c!["moyennes"]!;
            var e = ReglesEntretiens.Echeance(Plan(c["plan"]!), Point(c["reference"]), Point(c["courant"])!, Nombre(m["H"]), Nombre(m["KM"]));
            var a = c["attendu"]!;
            Assert.Equal(a["etat"]!.GetValue<string>(), e.Etat);
            Assert.Equal(Jour(a["date"]), e.Date);
            var criteres = a["criteres"]!.AsArray();
            Assert.Equal(criteres.Count, e.Criteres.Count);
            for (var i = 0; i < criteres.Count; i++)
            {
                var x = criteres[i]!;
                var y = e.Criteres[i];
                Assert.Equal(x["critere"]!.GetValue<string>(), y.Critere);
                if (y.Echeance is DateOnly d) Assert.Equal(Jour(x["echeance"]), d);
                else Assert.Equal(x["echeance"]!.GetValue<decimal>(), (decimal)y.Echeance);
                Assert.Equal(x["reste"]!.GetValue<decimal>(), y.Reste);
                Assert.Equal(Jour(x["date"]), y.Date);
            }
        }
    }
}
