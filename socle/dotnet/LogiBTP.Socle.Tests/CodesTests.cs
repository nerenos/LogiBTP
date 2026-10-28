using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Socle.Tests;

/// <summary>Codes communs : Codes.cs ↔ socle/js/src/codes.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("socle", "js", "src", "codes.js");

    [Theory]
    [InlineData("NIVEAU_NOTIFICATION", typeof(NiveauNotification))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));
}
