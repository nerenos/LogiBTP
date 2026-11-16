using LogiBTP.Api.Reprise;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Règles de la reprise des ressources (plan reprise-mde-optim, lot 7) : contrat, type de MO, habilitations, codes.</summary>
public class RessourcesRepriseTests
{
    [Theory]
    [InlineData("CDI", false, "CDI")]
    [InlineData("Contrat à durée déterminée", false, "CDD")]
    [InlineData("Contrat à durée indéterminée", false, "CDI")]
    [InlineData("cdd 6 mois", false, "CDD")]
    [InlineData("Intérim", false, "INTERIM")]
    [InlineData(null, true, "INTERIM")]
    [InlineData(null, false, "CDI")]
    public void Statut_du_contrat(string? contrat, bool interim, string attendu) =>
        Assert.Equal(attendu, RessourcesReprise.StatutDe(contrat, interim));

    [Theory]
    [InlineData("Cadre", "CADRE")]
    [InlineData("ETAM", "ETAM")]
    [InlineData("Employé", "ETAM")]
    [InlineData("Ouvrier", "OUVRIER")]
    [InlineData("Apprenti", null)]
    [InlineData(null, null)]
    public void Type_de_main_d_oeuvre(string? categorie, string? attendu) => Assert.Equal(attendu, RessourcesReprise.TypeMoDe(categorie));

    [Theory]
    [InlineData("CACES R489", null, "CACES")]
    [InlineData("HABELEC", "Habilitation électrique B0", "ELECTRIQUE")]
    [InlineData(null, "Travail en hauteur", "HAUTEUR")]
    [InlineData(null, "Contrôle technique", "CONTROLE")]
    [InlineData("SST", null, "SECURITE")]
    [InlineData("ECHAF", "Montage d'échafaudage", "AUTRE")]
    public void Categorie_d_un_type_d_habilitation_cree(string? code, string? libelle, string attendu) =>
        Assert.Equal(attendu, RessourcesReprise.CategorieHabilitation(code, libelle));

    [Theory]
    [InlineData("Utilitaire de chantier", 30, "UTILITAIRE_DE_CHANTIER")]
    [InlineData("Horaire chantier 39 h", 20, "HORAIRE_CHANTIER_39")]
    [InlineData("Électroportatif", 30, "ELECTROPORTATIF")]
    [InlineData("--", 30, "X")]
    public void Code_tire_d_un_libelle(string libelle, int longueur, string attendu) => Assert.Equal(attendu, RessourcesReprise.CodeDe(libelle, longueur));
}
