using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Mail.Tests;

/// <summary>Jeu partagé avec reconnaissance.js : normalisation, mots entiers, reconnaissance.</summary>
public class ReconnaissanceMailTests
{
    private static readonly JsonObject Jeu = CasPartages.Lire(CasPartages.Chemin("modules", "mail", "tests", "cas", "01_reconnaissance.json"));

    private static List<string> Textes(JsonNode? n) => n?.AsArray().Select(x => x!.GetValue<string>()).ToList() ?? [];

    private static List<ElementCible> Elements(JsonNode? n) =>
        n?.AsArray().Select(x => new ElementCible(x!["type"]!.GetValue<string>(), x["id"]!.GetValue<string>())).ToList() ?? [];

    private static List<RegleReconnaissance> Regles() => Jeu["regles"]!.AsArray().Select(r => new RegleReconnaissance(r!["code"]!.GetValue<string>(),
        r["nature"]!.GetValue<string>(), Textes(r["mots"]), Textes(r["dans"]), r["expediteur"]?.GetValue<string>(), r["service"]?.GetValue<string>(),
        r["action"]!.GetValue<string>(), r["ordre"]!.GetValue<int>())).ToList();

    private static EntreeReconnaissance Entree(JsonNode e) => new(e["objet"]!.GetValue<string>(), e["texte"]!.GetValue<string>(), Textes(e["pieces"]),
        e["texte_pieces"]!.GetValue<string>(), e["de"]!.GetValue<string>(), Elements(e["fil"]),
        e["candidats"]!.AsArray().Select(c => new Candidat(c!["type"]!.GetValue<string>(), c["id"]!.GetValue<string>(), c["numero"]?.GetValue<string>(),
            Textes(c["references"]), c["tiers_id"]?.GetValue<long>())).ToList(),
        e["expediteur_tiers"]!.AsArray().Select(x => x!.GetValue<long>()).ToList(), Elements(e["tiers"]), e["automatique"]!.GetValue<bool>());

    public static IEnumerable<object[]> Cas() => Jeu["cas"]!.AsArray().Select(c => new object[] { c!["nom"]!.GetValue<string>() });

    [Fact]
    public void Normalisation_et_mots()
    {
        foreach (var c in Jeu["normalisation"]!.AsArray()) Assert.Equal(c!["attendu"]!.GetValue<string>(), ReconnaissanceMail.Normaliser(c["texte"]!.GetValue<string>()));
        foreach (var c in Jeu["mots"]!.AsArray())
            Assert.Equal(c!["attendu"]!.GetValue<bool>(), ReconnaissanceMail.ContientMot(c["texte"]!.GetValue<string>(), c["mot"]!.GetValue<string>()));
    }

    [Theory]
    [MemberData(nameof(Cas))]
    public void Reconnaissance(string nom)
    {
        var c = Jeu["cas"]!.AsArray().First(x => x!["nom"]!.GetValue<string>() == nom)!;
        var a = c["attendu"]!;
        var r = ReconnaissanceMail.Reconnaitre(Entree(c["entree"]!), Regles(), Jeu["seuils"]!["haut"]!.GetValue<int>(), Jeu["seuils"]!["bas"]!.GetValue<int>());
        Assert.Equal(a["nature"]?.GetValue<string>(), r.Nature);
        Assert.Equal(a["regle"]?.GetValue<string>(), r.Regle);
        Assert.Equal(a["service"]?.GetValue<string>(), r.Service);
        Assert.Equal(a["decision"]!.GetValue<string>(), r.Decision);
        Assert.Equal(a["alerte"]!.GetValue<bool>(), r.Alerte);
        Assert.Equal(a["retenus"]!.AsArray().Select(x => (x!["type"]!.GetValue<string>(), x["id"]!.GetValue<string>(), x["score"]!.GetValue<int>())),
            r.Retenus.Select(x => (x.Type, x.Id, x.Score)));
        Assert.Equal(a["propositions"]!.AsArray().Select(x => (x!["type"]!.GetValue<string>(), x["id"]!.GetValue<string>(), x["score"]!.GetValue<int>(),
            string.Join(',', Textes(x["indices"])))), r.Propositions.Select(x => (x.Type, x.Id, x.Score, string.Join(',', x.Indices))));
    }
}
