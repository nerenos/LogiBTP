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
