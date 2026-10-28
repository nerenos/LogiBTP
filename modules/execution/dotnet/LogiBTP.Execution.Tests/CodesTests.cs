using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Execution.Tests;

/// <summary>Codes du module : Codes.cs ↔ modules/execution/js/src/codes.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("modules", "execution", "js", "src", "codes.js");

    [Theory]
    [InlineData("ETAT_ORDRE", typeof(EtatOrdre))]
    [InlineData("STATUT_ORDRE", typeof(StatutOrdre))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));
}
