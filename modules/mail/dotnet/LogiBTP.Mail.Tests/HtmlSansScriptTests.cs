using System.Text.Json.Nodes;
using LogiBTP.Mail.Web;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Mail.Tests;

/// <summary>Jeu partagé socle/tests/html_sans_script.json (module Droits, lot 5) : aucun script ne reste après nettoyage.</summary>
public class HtmlSansScriptTests
{
    [Fact]
    public void Aucun_script_apres_nettoyage()
    {
        foreach (var c in CasPartages.Lire(CasPartages.Chemin("socle", "tests", "html_sans_script.json"))["cas"]!.AsArray().Select(c => c!))
        {
            var sortie = new NettoyageHtmlMail().Nettoyer(c["entree"]!.GetValue<string>());
            foreach (var i in c["interdits"]!.AsArray()) Assert.True(!sortie.Contains(i!.GetValue<string>(), StringComparison.OrdinalIgnoreCase), $"{c["nom"]} : {sortie}");
            foreach (var g in c["garde"]!.AsArray()) Assert.True(sortie.Contains(g!.GetValue<string>(), StringComparison.Ordinal), $"{c["nom"]} (gardé) : {sortie}");
        }
    }
}
