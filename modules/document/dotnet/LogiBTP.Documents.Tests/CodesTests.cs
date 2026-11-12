using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Documents.Tests;

/// <summary>Codes du module : Codes.cs ↔ modules/document/js/src/codes.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("modules", "document", "js", "src", "codes.js");

    [Theory]
    [InlineData("FAMILLE_DOCUMENT", typeof(FamillesDocument))]
    [InlineData("STATUT_DOCUMENT", typeof(StatutsDocument))]
    [InlineData("TYPE_AVANCEMENT", typeof(TypesAvancement))]
    [InlineData("NATURE_AVOIR", typeof(NaturesAvoir))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));
}
