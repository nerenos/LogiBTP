using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Listes.Tests;

/// <summary>Codes du module : Codes.cs ↔ modules/liste/js/src/codes.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("modules", "liste", "js", "src", "codes.js");

    [Theory]
    [InlineData("ERREUR_LISTE", typeof(ErreursListe))]
    [InlineData("PERIODE", typeof(PeriodesListe))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));

    [Fact]
    public void Periodes_avec_nombre_identiques_au_js() =>
        Assert.Equal(Constantes.ListeJs(Fichier, "PERIODE_AVEC_NOMBRE"), PeriodesAvecNombre.Codes);
}
