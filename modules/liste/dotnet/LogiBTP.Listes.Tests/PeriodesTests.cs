using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Listes.Tests;

/// <summary>Bornes des périodes : jeu partagé modules/liste/tests/cas/04_periodes.json (même jeu que le test JS).</summary>
public class PeriodesTests
{
    private static readonly System.Text.Json.Nodes.JsonArray Cas =
        CasPartages.Lire(CasPartages.Chemin("modules", "liste", "tests", "cas", "04_periodes.json"))["cas"]!.AsArray();

    public static IEnumerable<object[]> Noms => Cas.Select(c => new object[] { c!["nom"]!.GetValue<string>() });

    [Theory]
    [MemberData(nameof(Noms))]
    public void Bornes_du_jeu(string nom)
    {
        var c = Cas.First(n => n!["nom"]!.GetValue<string>() == nom)!;
        var x = c["x"]?.GetValue<int>();
        var reference = DateOnly.Parse(c["reference"]!.GetValue<string>());
        var exercice = c["debut_exercice"] is { } e ? DateOnly.Parse(e.GetValue<string>()) : (DateOnly?)null;
        var code = c["code"]!.GetValue<string>();
        if (c["erreur"] is { } erreur)
        {
            Assert.Equal(erreur.GetValue<string>(), Assert.Throws<ErreurPeriode>(() => Periodes.Bornes(code, x, reference, exercice)).Code);
            return;
        }
        var (debut, fin) = Periodes.Bornes(code, x, reference, exercice);
        Assert.Equal(c["debut"]!.GetValue<string>(), debut.ToString("yyyy-MM-dd"));
        Assert.Equal(c["fin"]!.GetValue<string>(), fin.ToString("yyyy-MM-dd"));
    }
}
