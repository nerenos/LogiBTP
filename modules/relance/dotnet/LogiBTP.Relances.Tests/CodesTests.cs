using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Relances.Tests;

/// <summary>Codes du module : Codes.cs ↔ modules/relance/js/src/codes.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("modules", "relance", "js", "src", "codes.js");

    [Theory]
    [InlineData("NATURE_RELANCE", typeof(NatureRelance))]
    [InlineData("MODE_RELANCE", typeof(ModeRelance))]
    [InlineData("ETAT_RELANCE", typeof(EtatRelance))]
    [InlineData("ERREUR_RELANCE", typeof(ErreurRelance))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));

    [Fact]
    public void Nombre_maximal_de_niveaux_identique_au_js() =>
        Assert.Contains($"export const NIVEAUX_MAX = {ReglesRelance.NiveauxMax};",
            File.ReadAllText(CasPartages.Chemin("modules", "relance", "js", "src", "regles.js")));
}
