using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Pointage.Tests;

/// <summary>Codes du module : Codes.cs ↔ modules/pointage/js/src/codes.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("modules", "pointage", "js", "src", "codes.js");

    [Theory]
    [InlineData("ETAT_CONGE", typeof(EtatConge))]
    [InlineData("ERREUR_POINTAGE", typeof(ErreursPointage))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));
}
