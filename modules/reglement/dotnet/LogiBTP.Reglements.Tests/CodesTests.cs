using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Reglements.Tests;

/// <summary>Codes du module : Codes.cs ↔ modules/reglement/js/src/codes.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("modules", "reglement", "js", "src", "codes.js");

    [Theory]
    [InlineData("MODE_REGLEMENT_SYSTEME", typeof(ModeReglementSysteme))]
    [InlineData("SOURCE_POINTAGE", typeof(SourcePointage))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));
}
