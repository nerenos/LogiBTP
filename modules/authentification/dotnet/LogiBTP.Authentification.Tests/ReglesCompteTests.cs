using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Authentification.Tests;

/// <summary>Jeux partagés avec regles.js : pseudo, mot de passe, état du compte, compte saisi ; empreintes.</summary>
public class ReglesCompteTests
{
    private static JsonObject Jeu(string f) => CasPartages.Lire(CasPartages.Chemin("modules", "authentification", "tests", "cas", f));

    private static List<string> Codes(JsonNode? n) => n!.AsArray().Select(x => x!.GetValue<string>()).ToList();

    private static DateOnly? Jour(JsonNode? n) => n is null ? null : DateOnly.ParseExact(n.GetValue<string>(), "yyyy-MM-dd", CultureInfo.InvariantCulture);

    [Fact]
    public void Pseudos_identiques_au_js()
    {
        var j = Jeu("01_pseudo.json");
        var reserves = Codes(j["reserves"]);
        foreach (var c in j["cas"]!.AsArray())
        {
            Assert.True(Codes(c!["attendu"]).SequenceEqual(ReglesCompte.ControlerPseudo(c["code"]?.GetValue<string>(), reserves)), c["nom"]!.GetValue<string>());
        }
    }

    [Fact]
    public void Mots_de_passe_identiques_au_js()
    {
        var j = Jeu("02_mot_de_passe.json");
        var politique = new PolitiqueMotDePasse(j["politique"]!["longueur_min"]!.GetValue<int>(), Codes(j["politique"]!["courants"]));
        foreach (var c in j["cas"]!.AsArray())
        {
            var obtenu = ReglesCompte.ControlerMotDePasse(c!["mdp"]?.GetValue<string>(), politique, c["pseudo"]?.GetValue<string>());
            Assert.True(Codes(c["attendu"]).SequenceEqual(obtenu), c["nom"]!.GetValue<string>());
        }
    }

    [Fact]
    public void Etats_identiques_au_js()
    {
        var j = Jeu("03_etat_compte.json");
        var maintenant = DateTimeOffset.Parse(j["maintenant"]!.GetValue<string>(), CultureInfo.InvariantCulture);
        foreach (var c in j["cas"]!.AsArray())
        {
            var k = c!["compte"]!;
            var compte = new CompteAEvaluer(k["type"]!.GetValue<string>(), k["actif"]!.GetValue<bool>(), k["a_mot_de_passe"]!.GetValue<bool>(),
                k["mdp_provisoire"]?.GetValue<bool>() ?? false, Jour(k["valide_jusqu_au"]),
                k["verrouille_jusqu_au"] is { } v ? DateTimeOffset.Parse(v.GetValue<string>(), CultureInfo.InvariantCulture) : null);
            var e = ReglesCompte.Etat(compte, maintenant);
            var nom = c["nom"]!.GetValue<string>();
            Assert.True(c["attendu"]!["etat"]!.GetValue<string>() == e.Etat, nom);
            Assert.True(c["attendu"]!["connexion"]!.GetValue<bool>() == e.Connexion, nom);
        }
    }

    [Fact]
    public void Comptes_saisis_identiques_au_js()
    {
        var j = Jeu("04_compte.json");
        var profils = Codes(j["profils"]);
        var aujourdhui = Jour(j["aujourdhui"])!.Value;
        foreach (var c in j["cas"]!.AsArray())
        {
            var p = c!["personne"];
            var personne = p is null ? null : new PersonneAutorisee(p["autorisee"]!.GetValue<bool>(), p["fin_obligatoire"]!.GetValue<bool>(), Codes(p["profils_interdits"]));
            var obtenu = ReglesCompte.ControlerCompte(c["saisie"]!["profil"]!.GetValue<string>(), Jour(c["saisie"]!["valide_jusqu_au"]), personne, profils, aujourdhui);
            Assert.True(Codes(c["attendu"]).SequenceEqual(obtenu), c["nom"]!.GetValue<string>());
        }
    }

    [Fact]
    public void Chaque_code_a_un_message()
    {
        foreach (var f in new[] { "01_pseudo.json", "02_mot_de_passe.json", "04_compte.json" })
        {
            foreach (var c in Jeu(f)["cas"]!.AsArray().SelectMany(x => Codes(x!["attendu"]))) Assert.True(ReglesCompte.Messages.ContainsKey(c), c);
        }
    }

    [Fact]
    public void Empreintes_verifiees_et_reprises()
    {
        var h = HachageMotDePasse.Hacher("cheval-batterie-agrafe", 1000);
        Assert.True(HachageMotDePasse.Verifier("cheval-batterie-agrafe", h));
        Assert.False(HachageMotDePasse.Verifier("cheval-batterie-agrafE", h));
        Assert.False(HachageMotDePasse.Verifier("x", "n'importe quoi"));
        Assert.False(HachageMotDePasse.Verifier("x", null));
        Assert.True(HachageMotDePasse.AReprendre(h));
        Assert.False(HachageMotDePasse.AReprendre(HachageMotDePasse.Hacher("x")));
        Assert.NotEqual(HachageMotDePasse.Hacher("x", 1000), HachageMotDePasse.Hacher("x", 1000));
        var (jeton, empreinte) = HachageMotDePasse.NouveauJeton();
        Assert.Equal(empreinte, HachageMotDePasse.Empreinte(jeton));
        Assert.Equal(64, empreinte.Length);
        Assert.Matches("^[a-zA-Z0-9-]{19}$", HachageMotDePasse.Provisoire());
    }
}
