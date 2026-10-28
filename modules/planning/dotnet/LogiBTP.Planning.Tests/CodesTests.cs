using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Planning.Tests;

/// <summary>Codes du module : Codes.cs ↔ modules/planning/js/src/codes.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("modules", "planning", "js", "src", "codes.js");

    [Theory]
    [InlineData("DIFFUSION_PLANNING", typeof(DiffusionPlanning))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));
}
