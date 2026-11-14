using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Stock.Tests;

/// <summary>Codes du module : Codes.cs ↔ modules/stock/js/src/codes.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("modules", "stock", "js", "src", "codes.js");

    [Theory]
    [InlineData("SUIVI_ARTICLE", typeof(SuiviArticle))]
    [InlineData("UNITE_DUREE", typeof(UniteDuree))]
    [InlineData("NATURE_PART_APPRO", typeof(NaturePartAppro))]
    [InlineData("MOTIF_REAPPRO", typeof(MotifReappro))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));
}
