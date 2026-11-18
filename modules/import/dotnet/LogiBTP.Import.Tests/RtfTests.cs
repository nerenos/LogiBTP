using System.Text.Json;
using LogiBTP.Import.Reprise;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Import.Tests;

/// <summary>RTF en HTML : Rtf.cs ↔ rtf.js (jeu js/test/rtf-cas.json, plan reprise-mde-optim, lot 8).</summary>
public class RtfTests
{
    private static readonly JsonElement Jeu = JsonDocument.Parse(File.ReadAllText(
        CasPartages.Chemin("modules", "import", "js", "test", "rtf-cas.json"))).RootElement;

    [Fact]
    public void Libelles_rtf_comme_le_js()
    {
        var entete = Jeu.GetProperty("entete").GetString()!;
        foreach (var c in Jeu.GetProperty("cas").EnumerateArray())
        {
            var brut = c.TryGetProperty("brut", out var b) && b.GetBoolean();
            var rtf = (brut ? "" : entete) + c.GetProperty("rtf").GetString();
            Assert.True(c.GetProperty("html").GetString() == Rtf.EnHtml(rtf), $"{c.GetProperty("nom").GetString()} : {Rtf.EnHtml(rtf)}");
        }
    }

    [Theory]
    [InlineData(null, "")]
    [InlineData("Béton <C25>\nligne 2", "Béton &lt;C25&gt;<br>ligne 2")]
    [InlineData("{\\rtf1 \\b Gras\\b0}", "<b>Gras</b>")]
    public void Html_d_un_libelle_source(string? texte, string attendu) => Assert.Equal(attendu, Rtf.HtmlDe(texte));
}
