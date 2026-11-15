using LogiBTP.Fiches;
using Xunit;

namespace LogiBTP.Fiches.Tests;

/// <summary>Contrôles des demandes de champ supplémentaire en colonne x_ (sans base ; le DDL est testé par ChampsSupplementairesBaseTests).</summary>
public class ChampsSupplementairesTests
{
    [Theory]
    [InlineData("x_badge", true)]
    [InlineData("x_a", true)]
    [InlineData("x_a1_b2", true)]
    [InlineData("x_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", true)]   // x_ + 41 caractères
    [InlineData("x_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", false)] // 42 : trop long
    [InlineData("x_", false)]
    [InlineData("x_1abc", false)]
    [InlineData("x_Badge", false)]
    [InlineData("badge", false)]
    [InlineData("sal_badge", false)]
    [InlineData("x_a-b", false)]
    [InlineData("x_a\"; DROP TABLE salarie; --", false)]
    [InlineData("x_a\n", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void Nom_de_colonne(string? nom, bool attendu) => Assert.Equal(attendu, ChampsSupplementaires.NomValide(nom));

    [Theory]
    [InlineData(TypesChampSupplementaire.Texte, "text")]
    [InlineData(TypesChampSupplementaire.Nombre, "numeric")]
    [InlineData(TypesChampSupplementaire.Montant, "numeric(18,2)")]
    [InlineData(TypesChampSupplementaire.Date, "date")]
    [InlineData(TypesChampSupplementaire.CaseACocher, "boolean")]
    [InlineData(TypesChampSupplementaire.Liste, "text")]
    [InlineData("json", null)]
    [InlineData("motdepasse", null)]
    [InlineData("", null)]
    public void Type_sql(string type, string? attendu) => Assert.Equal(attendu, ChampsSupplementaires.TypeSql(type));

    [Fact]
    public void Creation_valide_et_refus_par_code()
    {
        Assert.Empty(ChampsSupplementaires.ValiderCreation("x_badge", "texte", "Badge", null));
        Assert.Empty(ChampsSupplementaires.ValiderCreation("x_niveau", "liste", "Niveau", [new() { Valeur = "a" }, new() { Valeur = "b", Libelle = "B" }]));
        Assert.Equal([ErreursChampSupplementaire.NomInvalide], ChampsSupplementaires.ValiderCreation("badge", "texte", "Badge", null).Select(e => e.Code));
        Assert.Equal([ErreursChampSupplementaire.TypeInvalide], ChampsSupplementaires.ValiderCreation("x_b", "json", "B", null).Select(e => e.Code));
        Assert.Equal([ErreursChampSupplementaire.LibelleObligatoire], ChampsSupplementaires.ValiderCreation("x_b", "texte", "  ", null).Select(e => e.Code));
        Assert.Equal([ErreursChampSupplementaire.LibelleObligatoire], ChampsSupplementaires.ValiderCreation("x_b", "texte", new string('a', 101), null).Select(e => e.Code));
        Assert.Equal([ErreursChampSupplementaire.Valeurs], ChampsSupplementaires.ValiderCreation("x_b", "liste", "B", []).Select(e => e.Code));
        Assert.Equal([ErreursChampSupplementaire.Valeurs], ChampsSupplementaires.ValiderCreation("x_b", "liste", "B", [new() { Valeur = "a" }, new() { Valeur = "a" }]).Select(e => e.Code));
        Assert.Equal([ErreursChampSupplementaire.Valeurs], ChampsSupplementaires.ValiderCreation("x_b", "liste", "B", [new() { Valeur = " " }]).Select(e => e.Code));
    }

    [Fact]
    public void Champ_de_fiche_selon_le_type()
    {
        var montant = ChampsSupplementaires.VersChamp("x_m", TypesChampSupplementaire.Montant, "Montant", 2, null);
        Assert.Equal((TypesChampSupplementaire.Nombre, ChampsSupplementaires.FormatMontant, "x_m", true), (montant.Type, montant.Format, montant.Colonne, montant.ColonneSupplementaire));
        var liste = ChampsSupplementaires.VersChamp("x_l", TypesChampSupplementaire.Liste, "Liste", 0, [new() { Valeur = "a" }]);
        Assert.Equal("liste", liste.Type);
        Assert.Single(liste.Options!);
        Assert.Equal("booleen", ChampsSupplementaires.VersChamp("x_c", TypesChampSupplementaire.CaseACocher, "Case", 0, null).Type);
        // Le montant se valide comme un nombre à deux décimales.
        Assert.Null(ValidationFiche.Valider(montant, "12,50"));
        Assert.Equal("FORMAT", ValidationFiche.Valider(montant, "12,505"));
        Assert.Equal("NOMBRE", ValidationFiche.Valider(montant, "abc"));
        Assert.Equal("LISTE", ValidationFiche.Valider(liste, "z"));
    }
}
