using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Crm.Tests;

/// <summary>Jeu partagé avec notes.js : contrôle des notes.</summary>
public class ReglesNoteTests
{
    private static JsonObject Jeu() => CasPartages.Lire(CasPartages.Chemin("modules", "crm", "tests", "cas", "01_note.json"));

    private static string? Texte(JsonNode? n) => n?.GetValue<string>();

    [Fact]
    public void Notes_identiques_au_js()
    {
        foreach (var c in Jeu()["notes"]!.AsArray())
        {
            var n = c!["note"]!;
            var note = new NoteAControler(Texte(n["nature"]), Texte(n["etat"]), Texte(n["objet"]),
                n["responsable_id"]?.GetValue<long>(), n["srv_id"]?.GetValue<int>(),
                n["echeance"] is JsonNode e ? DateTimeOffset.Parse(e.GetValue<string>(), CultureInfo.InvariantCulture) : null,
                n["destinataires"]?.AsArray().Select(x => x!.GetValue<long>()).ToList(), n["parent_id"]?.GetValue<long>(),
                n["prive"]?.GetValue<bool>() ?? false, n["rgpd"]?.GetValue<bool>() ?? false, n["dans_fil"]?.GetValue<bool>() ?? false);
            var attendu = c["attendu"]!.AsArray().Select(x => x!.GetValue<string>()).ToList();
            Assert.True(attendu.SequenceEqual(ReglesNote.Controler(note)), c["nom"]!.GetValue<string>());
        }
    }

    [Fact]
    public void Chaque_code_a_un_libelle()
    {
        foreach (var code in Jeu()["notes"]!.AsArray().SelectMany(c => c!["attendu"]!.AsArray()).Select(x => x!.GetValue<string>()))
        {
            Assert.True(ReglesNote.Messages.ContainsKey(code), code);
        }
    }
}
