using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Socle;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Socle.Tests;

/// <summary>Analyseur d'expressions (jeu partagé socle/tests/expressions.json) et arrondi commercial.</summary>
public class SocleTests
{
    private static JsonNode Jeu() => JsonNode.Parse(File.ReadAllText(CasPartages.Chemin("socle", "tests", "expressions.json")))!;

    public static TheoryData<string> Expressions()
    {
        var data = new TheoryData<string>();
        foreach (var c in Jeu()["cas"]!.AsArray()) data.Add(c!["formule"]!.GetValue<string>());
        return data;
    }

    [Theory]
    [MemberData(nameof(Expressions))]
    public void Analyseur_expressions(string formule)
    {
        var jeu = Jeu();
        var cas = jeu["cas"]!.AsArray().First(c => c!["formule"]!.GetValue<string>() == formule)!;
        var variables = jeu["variables"]!.AsObject();
        decimal Resoudre(string reference)
        {
            var r = References.Analyser(reference);
            var cle = r is ReferenceVariable v ? v.Portee + v.Nom : ((ReferenceDonnee)r).Colonne;
            return variables.TryGetPropertyValue(cle, out var n)
                ? n!.GetValue<decimal>()
                : throw new ErreurCalcul("VARIABLE_INCONNUE", $"Variable {{{{{reference}}}}} non définie");
        }

        if (cas["erreur"] is JsonNode erreur)
        {
            var e = Assert.Throws<ErreurCalcul>(() => Expression.Evaluer(formule, Resoudre));
            Assert.Equal(erreur.GetValue<string>(), e.Code);
        }
        else Assert.Equal(cas["resultat"]!.GetValue<decimal>(), Expression.Evaluer(formule, Resoudre));
    }

    [Theory]
    [InlineData(2.5, 0, 3)]
    [InlineData(-2.5, 0, -3)]
    [InlineData(0.125, 2, 0.13)]
    [InlineData(1.005, 2, 1.01)]
    public void Arrondi_commercial_jamais_bancaire(double valeur, int precision, double attendu) =>
        Assert.Equal((decimal)attendu, ArrondiCalcul.Arrondir((decimal)valeur, precision));

    [Fact]
    public void Format_nombre_libelle() =>
        Assert.Equal("12,5", ArrondiCalcul.FormatNombre(decimal.Parse("12.500000", CultureInfo.InvariantCulture)));
}

/// <summary>Masquage des journaux : mots de passe, jetons, cookies, valeurs PostgreSQL, courriels, téléphones, NIR.</summary>
public class MasquageTests
{
    [Theory]
    [InlineData("duplicate key value violates unique constraint \"ux\" Detail: Key (sal_nir)=(1 85 05 78 006 084 36) already exists.", "Key (sal_nir)=(***)")]
    [InlineData("POST /api/auth/connexion {\"identifiant\":\"jp\",\"mot_de_passe\":\"Secret123!\"}", "\"mot_de_passe\":\"***")]
    [InlineData("Authorization: Bearer abc.def.ghi", "Bearer ***")]
    [InlineData("Cookie: logibtp_session=AbCdEf123; logibtp_acces=x.y.z", "logibtp_session=***")]
    [InlineData("lien /connexion?jeton=Zx9-_aa&retour=/", "jeton=***")]
    [InlineData("envoi à jean.martin@exemple.fr échoué", "envoi à *** échoué")]
    [InlineData("rappeler le 06 12 34 56 78 demain", "rappeler le *** demain")]
    [InlineData("valeur chiffre:v1:QUJDREVG== lue", "valeur *** lue")]
    public void Masque(string texte, string attendu) => Assert.Contains(attendu, LogiBTP.Socle.Masquage.Texte(texte));

    [Fact]
    public void Montants_et_dates_gardes() =>
        Assert.Equal("Devis 2026-00012 : 12 450,50 € le 24/10/2026", LogiBTP.Socle.Masquage.Texte("Devis 2026-00012 : 12 450,50 € le 24/10/2026"));

    [Fact]
    public void Aucun_secret_restant()
    {
        var t = LogiBTP.Socle.Masquage.Texte("password=hunter2&token=eyJhbGciOiJIUzI1NiJ9.eyJzaWQiOjF9.abcdefghijk")!;
        Assert.DoesNotContain("hunter2", t);
        Assert.DoesNotContain("eyJ", t);
    }
}

/// <summary>.env chiffré par la clé de construction : valeurs sensibles seulement, relecture, autre clé refusée.</summary>
public class EnvChiffreTests
{
    [Fact]
    public void Chiffre_les_seules_valeurs_sensibles_et_les_relit()
    {
        string[] lignes = ["# commentaire", "LOGIBTP_DEPLOIEMENT=INTERNET", "LOGIBTP_CLE_CHIFFREMENT=\"abc def\"", "ConnectionStrings__LogiBTP=Host=x;Password=y", ""];
        var chiffrees = LogiBTP.Socle.Web.ExtensionsConfiguration.ChiffrerLignes(lignes, "cle-A");
        Assert.Equal("# commentaire", chiffrees[0]);
        Assert.Equal("LOGIBTP_DEPLOIEMENT=INTERNET", chiffrees[1]);
        Assert.StartsWith("LOGIBTP_CLE_CHIFFREMENT=env:v1:", chiffrees[2]);
        Assert.StartsWith("ConnectionStrings__LogiBTP=env:v1:", chiffrees[3]);
        Assert.Equal(chiffrees, LogiBTP.Socle.Web.ExtensionsConfiguration.ChiffrerLignes(chiffrees, "cle-A"));
        var lues = LogiBTP.Socle.Web.ExtensionsConfiguration.Dechiffrer(LogiBTP.Socle.Web.ExtensionsConfiguration.LireEnv(chiffrees), "cle-A");
        Assert.Equal("abc def", lues["LOGIBTP_CLE_CHIFFREMENT"]);
        Assert.Equal("Host=x;Password=y", lues["ConnectionStrings__LogiBTP"]);
        Assert.Throws<InvalidOperationException>(() => LogiBTP.Socle.Web.ExtensionsConfiguration.Dechiffrer(LogiBTP.Socle.Web.ExtensionsConfiguration.LireEnv(chiffrees), "cle-B"));
        Assert.Throws<InvalidOperationException>(() => LogiBTP.Socle.Web.ExtensionsConfiguration.Dechiffrer(LogiBTP.Socle.Web.ExtensionsConfiguration.LireEnv(chiffrees), null));
    }
}
