using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Fiches.Tests;

/// <summary>Codes du module : Codes.cs ↔ modules/fiche/js/src/codes.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("modules", "fiche", "js", "src", "codes.js");

    [Theory]
    [InlineData("ERREUR_FICHE", typeof(ErreursFiche))]
    [InlineData("LARGEUR_GROUPE", typeof(LargeursGroupe))]
    [InlineData("DISPOSITION_GROUPE", typeof(DispositionsGroupe))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));
}
