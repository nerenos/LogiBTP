using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Socle.Tests;

/// <summary>Texte sans accents (jeu partagé socle/tests/sans_accent.json) ; table identique à accents.js.</summary>
public class SansAccentTests
{
    private static readonly string FichierJs = CasPartages.Chemin("socle", "js", "src", "calcul", "accents.js");

    [Fact]
    public void Jeu_partage()
    {
        foreach (var c in CasPartages.Lire(CasPartages.Chemin("socle", "tests", "sans_accent.json"))["cas"]!.AsArray().Select(c => c!))
        {
            Assert.True(c["attendu"]!.GetValue<string>() == SansAccent.Retirer(c["texte"]!.GetValue<string>()), c["nom"]!.GetValue<string>());
        }
    }

    /// <summary>Concaténation des littéraux d'une constante JS (`export const NOM = '…' + '…';`).</summary>
    private static string ChaineJs(string nom)
    {
        var texte = File.ReadAllText(FichierJs);
        var m = System.Text.RegularExpressions.Regex.Match(texte, $@"export const {nom} = ([\s\S]*?);");
        return string.Concat(System.Text.RegularExpressions.Regex.Matches(m.Groups[1].Value, "'([^']*)'").Select(x => x.Groups[1].Value));
    }

    [Fact]
    public void Table_identique_au_js()
    {
        Assert.Equal(SansAccent.Accentuees, ChaineJs("ACCENTUEES"));
        Assert.Equal(SansAccent.Bases, ChaineJs("BASES"));
    }
}
