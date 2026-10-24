using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Droits.Tests;

/// <summary>Jeu partagé avec regles.js : droits effectifs, portées, sous-arbres, cascade, réapplication, contrôles.</summary>
public class ReglesDroitsTests
{
    private static readonly JsonObject Jeu = CasPartages.Lire(CasPartages.Chemin("modules", "droits", "tests", "cas", "01_droits.json"));

    private static string Nom(JsonNode c) => c["nom"]!.GetValue<string>();

    private static Dictionary<string, string> Actions(JsonNode? n) =>
        n?.AsObject().ToDictionary(x => x.Key, x => x.Value!.GetValue<string>()) ?? [];

    private static Dictionary<string, IReadOnlyDictionary<string, string>> Lignes(JsonNode? n) =>
        n!.AsObject().ToDictionary(x => x.Key, x => (IReadOnlyDictionary<string, string>)Actions(x.Value));

    private static readonly DroitsProfil Droits = new(false, Lignes(Jeu["droits"]!["lignes"]));

    private static IEnumerable<JsonNode> Cas(string nom) => Jeu[nom]!.AsArray().Select(c => c!);

    [Fact]
    public void Effectifs_identiques_au_js()
    {
        foreach (var c in Cas("effectifs"))
        {
            var e = ReglesDroits.Effectives(Droits, c["noeud"]!.GetValue<string>());
            Assert.True(c["source"]?.GetValue<string>() == e.Source, Nom(c));
            Assert.True(Actions(c["actions"]).OrderBy(x => x.Key).SequenceEqual(e.Actions.OrderBy(x => x.Key)), Nom(c));
        }
    }

    [Fact]
    public void Portees_et_autorisations_identiques_au_js()
    {
        foreach (var c in Cas("portees"))
        {
            Assert.True(c["attendu"]?.GetValue<string>() == ReglesDroits.PorteeAccordee(Droits, c["noeud"]!.GetValue<string>(), c["action"]!.GetValue<string>()), Nom(c));
        }
        foreach (var c in Cas("autorisations"))
        {
            Assert.True(c["attendu"]!.GetValue<bool>() == ReglesDroits.Autorise(Droits, c["noeud"]!.GetValue<string>(), c["action"]!.GetValue<string>(), c["minimum"]!.GetValue<string>()), Nom(c));
        }
        foreach (var c in Cas("sous_arbres"))
        {
            Assert.True(c["attendu"]!.GetValue<bool>() == ReglesDroits.AccesSousArbre(Droits, c["noeud"]!.GetValue<string>(), c["ecriture"]!.GetValue<bool>()), Nom(c));
        }
        foreach (var c in Cas("total"))
        {
            Assert.Equal(c["attendu"]!.GetValue<string>(), ReglesDroits.PorteeAccordee(DroitsProfil.Tous, c["noeud"]!.GetValue<string>(), c["action"]!.GetValue<string>()));
        }
    }

    [Fact]
    public void Saisie_identique_au_js()
    {
        foreach (var c in Cas("cascade"))
        {
            var r = ReglesDroits.Cocher(Actions(c["actions"]), c["action"]!.GetValue<string>(), c["portee"]!.GetValue<string>());
            Assert.True(Actions(c["attendu"]).OrderBy(x => x.Key).SequenceEqual(r.OrderBy(x => x.Key)), Nom(c));
        }
        foreach (var c in Cas("decocher"))
        {
            var r = ReglesDroits.Decocher(Actions(c["actions"]), c["action"]!.GetValue<string>());
            Assert.True(Actions(c["attendu"]).OrderBy(x => x.Key).SequenceEqual(r.OrderBy(x => x.Key)), Nom(c));
        }
        foreach (var c in Cas("reappliquer"))
        {
            var r = ReglesDroits.Reappliquer(Droits.Lignes, c["noeud"]!.GetValue<string>()).Keys.Order(StringComparer.Ordinal);
            Assert.True(c["attendu"]!.AsArray().Select(x => x!.GetValue<string>()).SequenceEqual(r), Nom(c));
        }
    }

    [Fact]
    public void Controles_identiques_au_js()
    {
        foreach (var c in Cas("profils"))
        {
            var r = ReglesDroits.ControlerProfil(c["profil"]!["code"]?.GetValue<string>(), c["profil"]!["libelle"]?.GetValue<string>());
            Assert.True(c["attendu"]!.AsArray().Select(x => x!.GetValue<string>()).SequenceEqual(r), Nom(c));
        }
        var catalogue = Jeu["controles"]!["catalogue"]!.AsObject()
            .ToDictionary(x => x.Key, x => (IReadOnlyList<string>)x.Value!.AsArray().Select(a => a!.GetValue<string>()).ToList());
        foreach (var c in Jeu["controles"]!["cas"]!.AsArray().Select(c => c!))
        {
            var r = ReglesDroits.ControlerLignes(Lignes(c["lignes"]), catalogue);
            var attendu = c["attendu"]!.AsArray().Select(e => new ErreurLigne(e!["noeud"]!.GetValue<string>(), e["code"]!.GetValue<string>(), e["action"]?.GetValue<string>()));
            Assert.True(attendu.SequenceEqual(r), Nom(c));
        }
        foreach (var code in Cas("profils").SelectMany(c => c["attendu"]!.AsArray()).Select(x => x!.GetValue<string>()))
        {
            Assert.True(ReglesDroits.Messages.ContainsKey(code), code);
        }
    }
}

/// <summary>Montants de validation : limite héritée, dépassement par pièce ou par cumul, contrôles de saisie.</summary>
public class LimitesTests
{
    private static readonly Dictionary<string, Limite> Limites = new()
    {
        ["documents/A"] = new(5000m, 20000m, 30),
        ["documents/A/A_COMMANDE"] = new(1000m, -1m, 30),
        ["documents/V"] = new(-1m, -1m, 30),
        ["documents/S"] = new(0m, -1m, 30),
    };

    [Fact]
    public void Limite_heritee()
    {
        Assert.Equal(1000m, ReglesDroits.LimiteEffective(Limites, "documents/A/A_COMMANDE")!.Piece);
        Assert.Equal(5000m, ReglesDroits.LimiteEffective(Limites, "documents/A/A_FACTURE")!.Piece);
        Assert.Null(ReglesDroits.LimiteEffective(Limites, "documents/E/E_OE"));
    }

    [Theory]
    [InlineData("documents/A/A_COMMANDE", 1000, 0, null)]
    [InlineData("documents/A/A_COMMANDE", 1000.01, 0, "PIECE")]
    [InlineData("documents/A/A_COMMANDE", 900, 1000000, null)]
    [InlineData("documents/A/A_FACTURE", 4000, 16000, null)]
    [InlineData("documents/A/A_FACTURE", 4000, 16000.01, "CUMUL")]
    [InlineData("documents/V/V_FACTURE", 1000000, 1000000, null)]
    [InlineData("documents/S/S_ENTREE", 0, 0, null)]
    [InlineData("documents/S/S_ENTREE", 0.01, 0, "PIECE")]
    public void Depassement(string noeud, decimal montant, decimal cumul, string? attendu) =>
        Assert.Equal(attendu, ReglesDroits.Depassement(ReglesDroits.LimiteEffective(Limites, noeud)!, montant, cumul));

    [Fact]
    public void Controle_de_saisie()
    {
        Assert.Empty(ReglesDroits.ControlerLimite(new(-1m, 0m, 30)));
        Assert.Equal(["LIMITE_MONTANT", "LIMITE_JOURS"], ReglesDroits.ControlerLimite(new(-2m, 10m, 0)));
    }
}
