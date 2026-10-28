using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Annuaire.Tests;

/// <summary>Codes du module : Codes.cs ↔ modules/annuaire/js/src/codes.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("modules", "annuaire", "js", "src", "codes.js");

    [Theory]
    [InlineData("ERREUR_ANNUAIRE", typeof(ErreursAnnuaire))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));
}
