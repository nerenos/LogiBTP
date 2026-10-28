using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Authentification.Tests;

/// <summary>Codes du module : Codes.cs ↔ modules/authentification/js/src/codes.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("modules", "authentification", "js", "src", "codes.js");

    [Theory]
    [InlineData("ERREUR_AUTHENTIFICATION", typeof(ErreursAuthentification))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));
}
