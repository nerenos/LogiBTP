using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.FactureElectronique.Tests;

/// <summary>Jeu partagé avec js/src/completude.js (controlerCompletude) : contrôle de complétude d'une facture émise (lot 16).</summary>
public class ReglesCompletudeTests
{
    internal static readonly JsonObject Jeu = CasPartages.Lire(CasPartages.Chemin("modules", "facture-electronique", "tests", "cas", "05_completude.json"));

    /// <summary>Facture d'un cas : base du jeu et modifications (chemin à points, index numérique ; null efface la valeur).</summary>
    internal static Facture Facture(JsonObject? modifications)
    {
        var f = Jeu["base"]!.DeepClone().AsObject();
        foreach (var (chemin, valeur) in modifications ?? [])
        {
            var cles = chemin.Split('.');
            JsonNode noeud = f;
            for (var i = 0; i < cles.Length - 1; i++)
            {
                var suivant = Enfant(noeud, cles[i]);
                if (suivant is null)
                {
                    suivant = int.TryParse(cles[i + 1], out _) ? new JsonArray() : new JsonObject();
                    Poser(noeud, cles[i], suivant);
                }
                noeud = suivant;
            }
            Poser(noeud, cles[^1], valeur?.DeepClone());
        }
        return f.Deserialize<Facture>(ReglesCompletude.Json)!;
    }

    private static JsonNode? Enfant(JsonNode n, string cle) => n is JsonArray a ? a[int.Parse(cle)] : n.AsObject()[cle];

    private static void Poser(JsonNode n, string cle, JsonNode? valeur)
    {
        if (n is JsonArray a) a[int.Parse(cle)] = valeur;
        else n.AsObject()[cle] = valeur;
    }

    public static TheoryData<string> Cas() => new(Jeu["cas"]!.AsArray().Select(c => c!["nom"]!.GetValue<string>()));

    [Theory]
    [MemberData(nameof(Cas))]
    public void Complétude_comme_le_jeu_partage(string nom)
    {
        var c = Jeu["cas"]!.AsArray().First(x => x!["nom"]!.GetValue<string>() == nom)!;
        var resultat = ReglesCompletude.Controler(Facture(c["modifications"]?.AsObject()), c["bloquant"]?.GetValue<bool>() ?? true);
        var attendu = c["attendu"]!.AsArray().Select(e => new EcartCompletude(
            e!["regle"]!.GetValue<string>(), e["niveau"]!.GetValue<string>(), e["donnee"]!.GetValue<string>(), e["ligne"]?.GetValue<string>())).ToList();
        Assert.Equal(attendu, resultat);
    }

    [Fact]
    public void Bloquante_si_un_ecart_est_bloquant()
    {
        Assert.False(ReglesCompletude.Bloquante([]));
        Assert.False(ReglesCompletude.Bloquante([new(RegleCompletude.BrCo17, NiveauCompletude.Avertissement, "BT-117", null)]));
        Assert.True(ReglesCompletude.Bloquante([new(RegleCompletude.BrFr10, NiveauCompletude.Bloquant, "BT-30", null)]));
    }

    [Theory]
    [InlineData("100", 0, 3)]
    [InlineData("100.00", 0, 3)]
    [InlineData("-0.105", 3, 4)]
    [InlineData("25.500000", 1, 3)]
    public void Decimales_et_chiffres_sans_zero_de_fin(string valeur, int decimales, int chiffres)
    {
        var d = decimal.Parse(valeur, System.Globalization.CultureInfo.InvariantCulture);
        Assert.Equal(decimales, ReglesCompletude.Decimales(d));
        Assert.Equal(chiffres, ReglesCompletude.Chiffres(d));
    }

    [Fact]
    public void Modele_serialise_en_camelCase_pour_le_navigateur()
    {
        var json = JsonSerializer.Serialize(Facture(null), ReglesCompletude.Json);
        Assert.Contains("\"cadreFacturation\":\"S1\"", json);
        Assert.Contains("\"adresseElectronique\":{\"valeur\":\"200000008\"", json);
    }
}
