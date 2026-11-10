using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Comptabilite.Tests;

/// <summary>Codes du module : Codes.cs ↔ modules/comptabilite/js/src/codes.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("modules", "comptabilite", "js", "src", "codes.js");

    [Theory]
    [InlineData("CATEGORIE_EN16931", typeof(CategorieEn16931))]
    [InlineData("VATEX", typeof(Vatex))]
    [InlineData("COMPORTEMENT_TVA", typeof(ComportementTva))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));
}
