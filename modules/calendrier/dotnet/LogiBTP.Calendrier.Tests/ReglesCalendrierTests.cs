using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Calendrier.Tests;

/// <summary>Jeux partagés avec calendrier.js : jours fermés, plages, temps de travail, contrôles.</summary>
public class ReglesCalendrierTests
{
    private static JsonObject Jeu(string f) => CasPartages.Lire(CasPartages.Chemin("modules", "calendrier", "tests", "cas", f));

    private static DateOnly? Jour(JsonNode? n) => n is null ? null : DateOnly.ParseExact(n.GetValue<string>(), "yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static List<string> Codes(JsonNode? n) => n!.AsArray().Select(x => x!.GetValue<string>()).ToList();

    public static RegleFerme Regle(JsonNode r) => new(r["regle"]!.GetValue<string>(), r["libelle"]?.GetValue<string>() ?? "", Jour(r["date"]),
        r["mois"]?.GetValue<int>(), r["jour"]?.GetValue<int>(), r["rang"]?.GetValue<int>(), r["decalage"]?.GetValue<int>(), Jour(r["du"]), Jour(r["au"]),
        r["actif"]?.GetValue<bool>() ?? true);

    public static CalendrierTravail Calendrier(JsonNode c) => new(c["cycle_semaines"]?.GetValue<int>() ?? 1, Jour(c["reference"]),
        c["plages"]!.AsArray().Select(p => new Plage(p!["jour"]!.GetValue<int>(), p["debut"]!.GetValue<int>(), p["fin"]!.GetValue<int>(),
            p["semaine"]?.GetValue<int>() ?? 1, Jour(p["du"]), Jour(p["au"]))).ToList());

    [Fact]
    public void Jours_fermes_identiques_au_js()
    {
        var j = Jeu("01_feries.json");
        VerifierPaques(j);
        VerifierRegles(j);
        VerifierFermes(j);
        VerifierControles(j);
    }

    private static void VerifierPaques(JsonObject j)
    {
		j["paques"]!.AsArray().ToList().ForEach(c => Assert.Equal(Jour(c!["attendu"]), ReglesCalendrier.Paques(c["annee"]!.GetValue<int>())));
    }

    private static void VerifierRegles(JsonObject j)
    {
		j["regles"]!.AsArray().ToList().ForEach(c => Assert.True(c!["attendu"]!.AsArray().Select(x => Jour(x)!.Value).SequenceEqual(
			ReglesCalendrier.DatesRegle(Regle(c["regle"]!), 
			c["annee"]!.GetValue<int>())), c["nom"]!.GetValue<string>())
		);
    }

    private static void VerifierFermes(JsonObject j)
    {
        foreach (var c in j["fermes"]!.AsArray())
        {
            var obtenu = ReglesCalendrier.JoursFermes(
                c!["regles"]!.AsArray().Select(x => Regle(x!)),
                Jour(c["du"])!.Value,
                Jour(c["au"])!.Value);
            var attendu = c["attendu"]!.AsArray();
            var nom = c["nom"]!.GetValue<string>();
            Assert.True(attendu.Count == obtenu.Count, nom);
            for (var i = 0; i < attendu.Count; i++)
            {
                Assert.True(Jour(attendu[i]!["date"]) == obtenu[i].Date, nom);
                Assert.True(Codes(attendu[i]!["libelles"]).SequenceEqual(obtenu[i].Libelles), nom);
            }
        }
    }

    private static void VerifierControles(JsonObject j)
    {
        j["controles"]!.AsArray().ToList().ForEach(c => Assert.True(Codes(c!["attendu"]).SequenceEqual(ReglesCalendrier.ControlerRegle(Regle(c["regle"]!))), c["nom"]!.GetValue<string>()));
    }

    [Fact]
    public void Temps_de_travail_identique_au_js()
    {
        var j = Jeu("02_travail.json");
        var fermes = j["fermes"]!.AsArray()
            .Select(f => new JourFerme(Jour(f!["date"])!.Value, Codes(f["libelles"])))
            .ToList();
        CalendrierTravail Cal(JsonNode c) => Calendrier(c["valeur"] ?? j["calendriers"]![c["calendrier"]!.GetValue<string>()]!);

        VerifierSemaines(j, Cal);
        VerifierJournees(j, Cal, fermes);
        VerifierAjouts(j, Cal, fermes);
        VerifierDurees(j, Cal, fermes);
        VerifierProchains(j, Cal, fermes);
        VerifierControlesCalendrier(j, Cal);
    }

    private static void VerifierSemaines(JsonObject j, Func<JsonNode, CalendrierTravail> cal)
    {
        j["semaines"]!.AsArray().ToList().ForEach(c => Assert.True(c!["attendu"]!.GetValue<int>() == ReglesCalendrier.SemaineDuCycle(cal(c), Jour(c["date"])!.Value), c["nom"]!.GetValue<string>()));
    }

    private static void VerifierJournees(JsonObject j, Func<JsonNode, CalendrierTravail> cal, List<JourFerme> fermes)
    {
        foreach (var c in j["journees"]!.AsArray())
        {
            var e = ReglesCalendrier.Journee(cal(c!), fermes, Jour(c!["date"])!.Value);
            var a = c["attendu"]!;
            var nom = c["nom"]!.GetValue<string>();
            Assert.True(a["minutes"]!.GetValue<int>() == e.Minutes, nom);
            Assert.True(FermeeEgale(a, e), nom);
            Assert.True(
                a["plages"]!.AsArray()
                    .Select(p => new Intervalle(p!["debut"]!.GetValue<int>(), p["fin"]!.GetValue<int>()))
                    .SequenceEqual(e.Plages),
                nom);
        }
    }

    private static bool FermeeEgale(JsonNode attendu, Journee obtenue) =>
		attendu["fermee"] is null
			? obtenue.Fermee is null
			: obtenue.Fermee?.SequenceEqual(Codes(attendu["fermee"])) ?? false;

    private static void VerifierAjouts(JsonObject j, Func<JsonNode, CalendrierTravail> cal, List<JourFerme> fermes)
    {
        foreach (var c in j["ajouts"]!.AsArray())
        {
            var nom = c!["nom"]!.GetValue<string>();
            if (c["erreur"] is { } erreur)
            {
                var x = Assert.Throws<ErreurCalendrier>(() =>
                    ReglesCalendrier.AjouterMinutesTravail(
                        cal(c), fermes, Instant.Lire(c["debut"]!.GetValue<string>()), c["minutes"]!.GetValue<int>()));
                Assert.Equal(erreur.GetValue<string>(), x.Code);
            }
            else
            {
                var fin = ReglesCalendrier.AjouterMinutesTravail(
                    cal(c), fermes, Instant.Lire(c["debut"]!.GetValue<string>()), c["minutes"]!.GetValue<int>());
                Assert.True(c["attendu"]!.GetValue<string>() == fin.ToString(), nom);
            }
        }
    }

    private static void VerifierDurees(JsonObject j, Func<JsonNode, CalendrierTravail> cal, List<JourFerme> fermes)
    {
        foreach (var c in j["durees"]!.AsArray())
        {
            var m = ReglesCalendrier.MinutesTravail(
                cal(c!), fermes,
                Instant.Lire(c!["debut"]!.GetValue<string>()),
                Instant.Lire(c["fin"]!.GetValue<string>()));
            Assert.True(c["attendu"]!.GetValue<int>() == m, c["nom"]!.GetValue<string>());
        }
    }

    private static void VerifierProchains(JsonObject j, Func<JsonNode, CalendrierTravail> cal, List<JourFerme> fermes)
    {
        foreach (var c in j["prochains"]!.AsArray())
        {
            if (c!["erreur"] is { } erreur)
            {
                var x = Assert.Throws<ErreurCalendrier>(() =>
                    ReglesCalendrier.ProchainTravail(cal(c), fermes, Instant.Lire(c["instant"]!.GetValue<string>())));
                Assert.Equal(erreur.GetValue<string>(), x.Code);
            }
            else
            {
                var nom = c["nom"]!.GetValue<string>();
                Assert.True(
                    c["attendu"]!.GetValue<string>() ==
                        ReglesCalendrier.ProchainTravail(cal(c), fermes, Instant.Lire(c["instant"]!.GetValue<string>())).ToString(),
                    nom);
            }
        }
    }

    private static void VerifierControlesCalendrier(JsonObject j, Func<JsonNode, CalendrierTravail> cal)
    {
        j["controles"]!.AsArray().ToList().ForEach(c => Assert.True(Codes(c!["attendu"]).SequenceEqual(ReglesCalendrier.ControlerCalendrier(cal(c))), c["nom"]!.GetValue<string>()));
    }
}
