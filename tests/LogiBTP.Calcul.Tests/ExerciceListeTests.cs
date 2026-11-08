using LogiBTP.Api.Btp;
using LogiBTP.Listes;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Exercice comptable fourni aux listes : « exercice en cours » suit l'exercice du module Comptabilité, sinon l'année civile.</summary>
public class ExerciceListeTests
{
    private static readonly SourceResolue Source = new("SELECT * FROM \"v\"", [new("id", "integer"), new("embauche", "date")], "id", null, null);

    private static string[] Bornes(DateOnly? debutExercice)
    {
        var def = new DefinitionVue
        {
            Colonnes = [new() { Code = "embauche" }],
            Filtres = [new() { Colonne = "embauche", Op = "periode", Valeur = PeriodesListe.ExerciceEnCours }],
        };
        var r = new ConstructeurRequete(Source, def, new DemandeListe()) { Reference = new DateOnly(2026, 11, 8), DebutExercice = debutExercice }.Lot(2);
        return [r.Parametres[0].Valeur!.ToString()!, r.Parametres[1].Valeur!.ToString()!];
    }

    [Fact]
    public void Exercice_decale_du_parametre_comptabilite() =>
        Assert.Equal(["2026-07-01", "2027-06-30"], Bornes(ExerciceListeBtp.Debut("\"2000-07-01\"")));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("null")]
    [InlineData("\"pas une date\"")]
    [InlineData("{")]
    public void Sans_parametre_valide_annee_civile(string? json)
    {
        Assert.Null(ExerciceListeBtp.Debut(json));
        Assert.Equal(["2026-01-01", "2026-12-31"], Bornes(ExerciceListeBtp.Debut(json)));
    }
}
