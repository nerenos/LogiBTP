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
        foreach (var c in j["paques"]!.AsArray()) Assert.Equal(Jour(c!["attendu"]), ReglesCalendrier.Paques(c["annee"]!.GetValue<int>()));
        foreach (var c in j["regles"]!.AsArray())
        {
            var obtenu = ReglesCalendrier.DatesRegle(Regle(c!["regle"]!), c["annee"]!.GetValue<int>());
            Assert.True(c["attendu"]!.AsArray().Select(x => Jour(x)!.Value).SequenceEqual(obtenu), c["nom"]!.GetValue<string>());
        }
        foreach (var c in j["fermes"]!.AsArray())
        {
            var obtenu = ReglesCalendrier.JoursFermes(c!["regles"]!.AsArray().Select(x => Regle(x!)), Jour(c["du"])!.Value, Jour(c["au"])!.Value);
            var attendu = c["attendu"]!.AsArray();
            var nom = c["nom"]!.GetValue<string>();
            Assert.True(attendu.Count == obtenu.Count, nom);
            for (var i = 0; i < attendu.Count; i++)
            {
                Assert.True(Jour(attendu[i]!["date"]) == obtenu[i].Date, nom);
                Assert.True(Codes(attendu[i]!["libelles"]).SequenceEqual(obtenu[i].Libelles), nom);
            }
        }
        foreach (var c in j["controles"]!.AsArray())
        {
            Assert.True(Codes(c!["attendu"]).SequenceEqual(ReglesCalendrier.ControlerRegle(Regle(c["regle"]!))), c["nom"]!.GetValue<string>());
        }
    }

    [Fact]
    public void Temps_de_travail_identique_au_js()
    {
        var j = Jeu("02_travail.json");
        CalendrierTravail Cal(JsonNode c) => Calendrier(c["valeur"] ?? j["calendriers"]![c["calendrier"]!.GetValue<string>()]!);
        var fermes = j["fermes"]!.AsArray().Select(f => new JourFerme(Jour(f!["date"])!.Value, Codes(f["libelles"]))).ToList();
        foreach (var c in j["semaines"]!.AsArray())
        {
            Assert.True(c!["attendu"]!.GetValue<int>() == ReglesCalendrier.SemaineDuCycle(Cal(c), Jour(c["date"])!.Value), c["nom"]!.GetValue<string>());
        }
        foreach (var c in j["journees"]!.AsArray())
        {
            var e = ReglesCalendrier.Journee(Cal(c!), fermes, Jour(c["date"])!.Value);
            var a = c["attendu"]!;
            var nom = c["nom"]!.GetValue<string>();
            Assert.True(a["minutes"]!.GetValue<int>() == e.Minutes, nom);
            Assert.True((a["fermee"] is null ? null : Codes(a["fermee"])) is var f && (f is null ? e.Fermee is null : e.Fermee is not null && f.SequenceEqual(e.Fermee)), nom);
            Assert.True(a["plages"]!.AsArray().Select(p => new Intervalle(p!["debut"]!.GetValue<int>(), p["fin"]!.GetValue<int>())).SequenceEqual(e.Plages), nom);
        }
        foreach (var c in j["ajouts"]!.AsArray())
        {
            var nom = c!["nom"]!.GetValue<string>();
            if (c["erreur"] is { } erreur)
            {
                var x = Assert.Throws<ErreurCalendrier>(() => ReglesCalendrier.AjouterMinutesTravail(Cal(c), fermes, Instant.Lire(c["debut"]!.GetValue<string>()), c["minutes"]!.GetValue<int>()));
                Assert.Equal(erreur.GetValue<string>(), x.Code);
            }
            else
            {
                var fin = ReglesCalendrier.AjouterMinutesTravail(Cal(c), fermes, Instant.Lire(c["debut"]!.GetValue<string>()), c["minutes"]!.GetValue<int>());
                Assert.True(c["attendu"]!.GetValue<string>() == fin.ToString(), nom);
            }
        }
        foreach (var c in j["durees"]!.AsArray())
        {
            var m = ReglesCalendrier.MinutesTravail(Cal(c!), fermes, Instant.Lire(c["debut"]!.GetValue<string>()), Instant.Lire(c["fin"]!.GetValue<string>()));
            Assert.True(c["attendu"]!.GetValue<int>() == m, c["nom"]!.GetValue<string>());
        }
        foreach (var c in j["prochains"]!.AsArray())
        {
            if (c!["erreur"] is { } erreur)
            {
                var x = Assert.Throws<ErreurCalendrier>(() => ReglesCalendrier.ProchainTravail(Cal(c), fermes, Instant.Lire(c["instant"]!.GetValue<string>())));
                Assert.Equal(erreur.GetValue<string>(), x.Code);
            }
            else
            {
                Assert.True(c["attendu"]!.GetValue<string>() == ReglesCalendrier.ProchainTravail(Cal(c), fermes, Instant.Lire(c["instant"]!.GetValue<string>())).ToString(), c["nom"]!.GetValue<string>());
            }
        }
        foreach (var c in j["controles"]!.AsArray())
        {
            Assert.True(Codes(c!["attendu"]).SequenceEqual(ReglesCalendrier.ControlerCalendrier(Cal(c))), c["nom"]!.GetValue<string>());
        }
    }
}
