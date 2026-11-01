using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Rentabilite.Tests;

/// <summary>Codes du module : Codes.cs ↔ modules/rentabilite/js/src/codes.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("modules", "rentabilite", "js", "src", "codes.js");

    [Theory]
    [InlineData("INDICATEUR", typeof(Indicateur))]
    [InlineData("COMPOSANTE", typeof(Composante))]
    [InlineData("SOURCE_FAIT", typeof(SourceFait))]
    [InlineData("ETAT_CALCUL", typeof(EtatCalcul))]
    [InlineData("DECLENCHEUR", typeof(Declencheur))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));
}
