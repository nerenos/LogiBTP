using System.Security.Cryptography;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;
using Xunit.Abstractions;

namespace LogiBTP.Editions.Tests;

/// <summary>Moteur partagé par les tests (création ≈ 3 s : script et polices).</summary>
public sealed class MoteurPartage
{
    public MoteurEditionJs Moteur { get; } = new(MoteurEditionJs.ScriptEmbarque(), MoteurEditionJs.FacesLivrees());
}

/// <summary>
/// Parité navigateur ↔ serveur : le moteur JS exécuté dans Jint donne exactement l'arbre de pages et les octets du PDF
/// produits par Node (modules/edition/tests/resultats-js, régénérés par npm run exporter-resultats).
/// </summary>
public class MoteurEditionTests(MoteurPartage partage, ITestOutputHelper sortie) : IClassFixture<MoteurPartage>
{
    public static IEnumerable<object[]> Cas() =>
        Directory.GetFiles(CasPartages.Chemin("modules", "edition", "tests", "cas"), "*.json").Order().Select(f => new object[] { Path.GetFileName(f) });

    [Theory]
    [MemberData(nameof(Cas))]
    public void Meme_resultat_que_le_moteur_js(string fichier)
    {
        var cas = CasPartages.Lire(CasPartages.Chemin("modules", "edition", "tests", "cas", fichier));
        var nom = cas["nom"]!.GetValue<string>();
        var cheminJs = CasPartages.Chemin("modules", "edition", "tests", "resultats-js", $"{nom}.json");
        Assert.True(File.Exists(cheminJs), $"Résultat JS absent : lancer npm run exporter-resultats --workspace modules/edition/js ({cheminJs})");
        var js = CasPartages.Lire(cheminJs);
        var donnees = js["donnees"] ?? JsonNode.Parse(File.ReadAllText(CasPartages.Chemin("modules", "edition", "tests", cas["donnees"]!.GetValue<string>())));
        var modele = cas["modele"]!.ToJsonString();
        var env = cas["env"]!.ToJsonString();

        var chrono = System.Diagnostics.Stopwatch.StartNew();
        var pages = JsonNode.Parse(partage.Moteur.Pages(modele, donnees!.ToJsonString(), env));
        sortie.WriteLine($"{nom} : mise en page {chrono.ElapsedMilliseconds} ms (Jint)");
        var fautes = new List<string>();
        Comparer(js["resultat"], pages, "resultat", fautes);
        Assert.True(fautes.Count == 0, $"{nom} : {fautes.Count} écart(s), dont :\n" + string.Join("\n", fautes.Take(15)));

        // Octets identiques sans compression (pako côté navigateur, zlib .NET côté serveur).
        var envBrut = JsonNode.Parse(env)!.AsObject();
        envBrut["pdf"] = new JsonObject { ["titre"] = envBrut["pdf"]?["titre"]?.GetValue<string>(), ["date"] = envBrut["pdf"]?["date"]?.GetValue<string>(), ["compresser"] = false };
        var brut = partage.Moteur.Pdf(modele, donnees.ToJsonString(), envBrut.ToJsonString());
        var shaBrut = Convert.ToHexStringLower(SHA256.HashData(brut.Octets));
        if (shaBrut != js["pdf_brut_sha256"]!.GetValue<string>())
            File.WriteAllBytes(CasPartages.Chemin("modules", "edition", "tests", "resultats-js", $"{nom}.jint.pdf"), brut.Octets);
        Assert.Equal(js["pdf_brut_sha256"]!.GetValue<string>(), shaBrut);

        var pdf = partage.Moteur.Pdf(modele, donnees.ToJsonString(), env);
        sortie.WriteLine($"{nom} : {pdf.Pages} pages, PDF {pdf.Octets.Length} octets (brut {brut.Octets.Length}) en {pdf.Duree.TotalMilliseconds:0} ms (Jint) {pdf.ChronosJson}");
        Assert.StartsWith("%PDF-", System.Text.Encoding.ASCII.GetString(pdf.Octets, 0, 5));
        Assert.True(pdf.Octets.Length < brut.Octets.Length, "PDF compressé plus petit que le PDF brut");
    }

    [Fact]
    public void Controle_des_images_et_des_modeles()
    {
        var png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");
        Assert.Contains("\"type\":\"png\"", partage.Moteur.LireImage(png));
        Assert.Contains("SVG refusé", partage.Moteur.LireImage("<svg/>"u8.ToArray()));
        Assert.Contains("SYNTAXE", partage.Moteur.VerifierModele("""{"bandes":[{"contenu":{"type":"champ","valeur":"=Si(1;"}}]}"""));
        Assert.Equal("[]", partage.Moteur.VerifierModele("""{"bandes":[{"contenu":{"type":"champ","valeur":"={{a}} + 1"}}]}"""));
    }

    [Fact]
    public void Lot_d_impression()
    {
        const string modele = """{"bandes":[{"contenu":{"type":"champ","valeur":"Pièce {{n}}"}}]}""";
        var lot = $"[{{\"modele\":{modele},\"donnees\":{{\"n\":1}}}},{{\"modele\":{modele},\"donnees\":{{\"n\":2}}}}]";
        var pdf = partage.Moteur.PdfLot(lot, "{}");
        Assert.Equal(2, pdf.Pages);
        Assert.StartsWith("%PDF-", System.Text.Encoding.ASCII.GetString(pdf.Octets, 0, 5));
    }

    // Comparaison stricte : mêmes clés, mêmes valeurs (nombres comparés en décimal).
    private static void Comparer(JsonNode? a, JsonNode? b, string chemin, List<string> fautes)
    {
        if (fautes.Count > 50) return;
        switch (a)
        {
            case null when b is null: return;
            case JsonObject oa when b is JsonObject ob:
                foreach (var k in oa.Select(x => x.Key).Union(ob.Select(x => x.Key)))
                    Comparer(oa[k], ob[k], $"{chemin}.{k}", fautes);
                return;
            case JsonArray la when b is JsonArray lb:
                if (la.Count != lb.Count) { fautes.Add($"{chemin} : {la.Count} ≠ {lb.Count} éléments"); return; }
                for (var i = 0; i < la.Count; i++) Comparer(la[i], lb[i], $"{chemin}[{i}]", fautes);
                return;
            case JsonValue va when b is JsonValue vb:
                if (va.TryGetValue<decimal>(out var da) && vb.TryGetValue<decimal>(out var db)) { if (da != db) fautes.Add($"{chemin} : {da} ≠ {db}"); return; }
                if (va.ToJsonString() != vb.ToJsonString()) fautes.Add($"{chemin} : {va.ToJsonString()} ≠ {vb.ToJsonString()}");
                return;
            default:
                fautes.Add($"{chemin} : {a?.ToJsonString() ?? "null"} ≠ {b?.ToJsonString() ?? "null"}");
                return;
        }
    }
}
