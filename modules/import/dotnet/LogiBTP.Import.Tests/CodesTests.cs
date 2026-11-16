using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Import.Tests;

/// <summary>Codes du module : Codes.cs ↔ modules/import/js/src/codes.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("modules", "import", "js", "src", "codes.js");

    [Theory]
    [InlineData("SOURCE_REPRISE", typeof(SourceReprise))]
    [InlineData("ERREUR_CORRESPONDANCE", typeof(ErreurCorrespondance))]
    [InlineData("ETAT_SUITE", typeof(EtatSuite))]
    [InlineData("PART_SOUS_TRAITANCE", typeof(PartSousTraitance))]
    [InlineData("MODE_AVANCEMENT", typeof(ModeAvancement))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));
}
