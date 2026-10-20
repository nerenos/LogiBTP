using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Crm.Tests;

/// <summary>Jeu partagé avec rappels.js : contrôle et état des rappels.</summary>
public class ReglesRappelTests
{
    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "crm", "tests", "cas", "02_rappels.json"));

    private static DateTimeOffset? Date(JsonNode? n) => n is null ? null : DateTimeOffset.Parse(n.GetValue<string>(), CultureInfo.InvariantCulture);

    private static RappelAEvaluer Rappel(JsonNode r) =>
        new(r["type"]?.GetValue<string>(), Date(r["quand"]), r["delai_jours"]?.GetValue<int>(), Date(r["traite_le"]));

    [Fact]
    public void Controles_identiques_au_js()
    {
        foreach (var c in Jeu()["controles"]!.AsArray())
        {
            var attendu = c!["attendu"]!.AsArray().Select(x => x!.GetValue<string>()).ToList();
            var obtenu = ReglesRappel.Controler(Rappel(c["rappel"]!), c["note"]!["etat"]?.GetValue<string>(), Date(c["note"]!["echeance"]));
            Assert.True(attendu.SequenceEqual(obtenu), c["nom"]!.GetValue<string>());
        }
    }

    [Fact]
    public void Etats_identiques_au_js()
    {
        foreach (var c in Jeu()["etats"]!.AsArray())
        {
            var s = c!["seuils"];
            var seuils = s is null ? new SeuilsRappel() : new SeuilsRappel(s["orange"]!.GetValue<decimal>(), s["rouge"]!.GetValue<decimal>());
            var e = ReglesRappel.Etat(Rappel(c["rappel"]!), c["note"]!["etat"]?.GetValue<string>(), Date(c["note"]!["echeance"]), seuils, Date(c["maintenant"])!.Value);
            var a = c["attendu"]!;
            var nom = c["nom"]!.GetValue<string>();
            Assert.True(a["actif"]!.GetValue<bool>() == e.Actif, nom);
            Assert.True(a["visible"]!.GetValue<bool>() == e.Visible, nom);
            Assert.True(a["couleur"]?.GetValue<string>() == e.Couleur, nom);
            Assert.True(Date(a["reference"]) == e.Reference, nom);
        }
    }
}
