using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Rentabilite.Tests;

/// <summary>Codes du module : Codes.cs ↔ modules/rentabilite/js/src/codes.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("modules", "rentabilite", "js", "src", "codes.js");

    [Theory]
    [InlineData("INDICATEUR", typeof(Indicateur))]
    [InlineData("COMPOSANTE", typeof(Composante))]
    [InlineData("SOURCE_FAIT", typeof(SourceFait))]
    [InlineData("ETAT_CALCUL", typeof(EtatCalcul))]
    [InlineData("DECLENCHEUR", typeof(Declencheur))]
    [InlineData("BORNE_PERIODE", typeof(BornePeriode))]
    [InlineData("RACCOURCI_PERIODE", typeof(RaccourciPeriode))]
    [InlineData("ERREUR_PERIODE", typeof(ErreurPeriode))]
    [InlineData("TYPE_PHOTO", typeof(TypePhoto))]
    [InlineData("NIVEAU_LISTE", typeof(NiveauListe))]
    [InlineData("ETAT_PREVISION", typeof(EtatPrevision))]
    [InlineData("ACTION_PREVISION", typeof(ActionPrevision))]
    [InlineData("ERREUR_PREVISION", typeof(ErreurPrevision))]
    [InlineData("MODE_FACTURATION", typeof(ModeFacturation))]
    [InlineData("ERREUR_FACTURATION", typeof(ErreurFacturation))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));
}
