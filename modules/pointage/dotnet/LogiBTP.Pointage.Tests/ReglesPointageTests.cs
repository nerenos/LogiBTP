using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Pointage.Tests;

/// <summary>Jeu partagé avec controles.js : contrôles d'une semaine de pointages.</summary>
public class ReglesPointageTests
{
    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "pointage", "tests", "cas", "01_controles.json"));

    private static PointageControle Pointage(JsonNode x) => new(x["cle"]?.GetValue<string>(), x["date"]!.GetValue<string>(), x["cha_id"]?.GetValue<long>(),
        x["type_mo"]?.GetValue<string>(), x["minutes"]?.GetValue<int>() ?? 0, x["debut"]?.GetValue<int>(), x["fin"]?.GetValue<int>(),
        x["non_conformite"]?.GetValue<bool>() ?? false, x["motif"]?.GetValue<string>(), x["chantier_clos"]?.GetValue<bool>() ?? false);

    [Fact]
    public void Controles_identiques_au_js()
    {
        foreach (var c in Jeu()["cas"]!.AsArray())
        {
            var nom = c!["nom"]!.GetValue<string>();
            var pa = c["parametres"];
            var p = new ParametresControle(pa?["pas_minutes"]?.GetValue<int>() ?? 15, pa?["amplitude_jour"]?.GetValue<int>() ?? 600,
                pa?["amplitude_semaine"]?.GetValue<int>() ?? 2880);
            var obtenu = ReglesPointage.ControlerSemaine(p, c["pointages"]!.AsArray().Select(x => Pointage(x!)).ToList());
            var attendu = c["attendu"]!.AsArray().Select(a => new Controle(a!["code"]!.GetValue<string>(), a["niveau"]!.GetValue<string>(),
                a["cle"]?.GetValue<string>(), a["date"]?.GetValue<string>())).ToList();
            Assert.True(attendu.SequenceEqual(obtenu), $"{nom} : {string.Join(", ", obtenu)}");
            foreach (var a in attendu) Assert.True(ReglesPointage.Messages.ContainsKey(a.Code), a.Code);
        }
    }

    [Fact]
    public void Lundi() => Assert.Equal(new DateOnly(2026, 10, 19), ReglesPointage.LundiDe(new DateOnly(2026, 10, 25)));
}
