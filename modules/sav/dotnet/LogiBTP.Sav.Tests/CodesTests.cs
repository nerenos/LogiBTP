using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Sav.Tests;

/// <summary>Codes du module : Codes.cs ↔ modules/sav/js/src/codes.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("modules", "sav", "js", "src", "codes.js");

    [Theory]
    [InlineData("ETAT_EQUIPEMENT", typeof(EtatEquipement))]
    [InlineData("ORIGINE_EQUIPEMENT", typeof(OrigineEquipement))]
    [InlineData("ETAT_GARANTIE", typeof(EtatGarantie))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));
}
