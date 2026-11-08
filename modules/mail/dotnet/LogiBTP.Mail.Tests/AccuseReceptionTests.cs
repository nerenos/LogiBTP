using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Mail.Tests;

/// <summary>Jeu partagé avec reconnaitreAccuse (reconnaissance.js) : accusés de réception de commande.</summary>
public class AccuseReceptionTests
{
    private static readonly JsonObject Jeu = CasPartages.Lire(CasPartages.Chemin("modules", "mail", "tests", "cas", "02_accuses_reception.json"));

    private static List<string> Textes(JsonNode? n) => n?.AsArray().Select(x => x!.GetValue<string>()).ToList() ?? [];

    public static IEnumerable<object[]> Cas() => Jeu["cas"]!.AsArray().Select(c => new object[] { c!["nom"]!.GetValue<string>() });

    [Theory]
    [MemberData(nameof(Cas))]
    public void Accuse(string nom)
    {
        var c = Jeu["cas"]!.AsArray().First(x => x!["nom"]!.GetValue<string>() == nom)!;
        var e = c["entree"]!;
        var a = c["attendu"]!;
        var r = ReconnaissanceMail.ReconnaitreAccuse(new EntreeAccuse(e["objet"]!.GetValue<string>(), e["texte"]!.GetValue<string>(), Textes(e["prefixes"]),
            e["annee_reference"]?.GetValue<int>(), Textes(e["motifs"])));
        Assert.Equal(a["type"]?.GetValue<string>(), r.Type);
        Assert.Equal(a["motif"]?.GetValue<string>(), r.Motif);
        Assert.Equal(Textes(a["numeros"]), r.Numeros);
        Assert.Equal(a["numero"]?.GetValue<string>(), r.Numero);
        Assert.Equal(a["date"]?.GetValue<string>(), r.Date);
        Assert.Equal(a["semaine"]?.GetValue<int>(), r.Semaine);
        Assert.Equal(a["precision"]?.GetValue<string>(), r.Precision);
    }
}
