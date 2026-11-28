using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Import.Tests;

/// <summary>Codes du module : Codes.cs ↔ modules/import/js/src/codes.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("modules", "import", "js", "src", "codes.js");

    [Theory]
    [InlineData("SOURCE_REPRISE", typeof(SourceReprise))]
    [InlineData("VOLUME_MDE", typeof(VolumeMde))]
    [InlineData("ERREUR_CORRESPONDANCE", typeof(ErreurCorrespondance))]
    [InlineData("ETAT_SUITE", typeof(EtatSuite))]
    [InlineData("PART_SOUS_TRAITANCE", typeof(PartSousTraitance))]
    [InlineData("MODE_AVANCEMENT", typeof(ModeAvancement))]
    [InlineData("ETAT_REPRISE", typeof(EtatReprise))]
    [InlineData("ERREUR_REPRISE", typeof(ErreurReprise))]
    [InlineData("ETAPE_REPRISE", typeof(EtapeReprise))]
    [InlineData("NIVEAU_ANOMALIE", typeof(NiveauAnomalie))]
    [InlineData("ERREUR_FUSION", typeof(ErreurFusion))]
    [InlineData("CODE_ANOMALIE", typeof(CodeAnomalie))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));
}
