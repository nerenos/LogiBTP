using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Crm.Tests;

/// <summary>Codes du module : Codes.cs ↔ modules/crm/js/src/codes.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("modules", "crm", "js", "src", "codes.js");

    [Theory]
    [InlineData("NATURE_NOTE", typeof(NatureNote))]
    [InlineData("ETAT_NOTE", typeof(EtatNote))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));
}
