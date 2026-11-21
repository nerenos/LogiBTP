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
    [InlineData("CLASSE_STYLE_LIGNE", typeof(ClassesStyleLigne))]
    [InlineData("TAILLE_STYLE_LIGNE", typeof(TaillesStyleLigne))]
    [InlineData("TYPE_ZONE_ENTETE", typeof(TypesZoneEntete))]
    [InlineData("PORTEE_ZONE_ENTETE", typeof(PorteesZoneEntete))]
    [InlineData("ERREUR_ZONE_ENTETE", typeof(ErreursZoneEntete))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));
}
