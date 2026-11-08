using LogiBTP.Api.Btp;
using LogiBTP.Domaine.Ressources;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Relevés de compteurs saisis à la borne (db/280, plan materiel-suites, lot 3, MO2).</summary>
public class CompteursBorneTests
{
    [Fact]
    public void Releve_d_un_materiel_affecte_ce_jour_n_est_pas_a_valider()
    {
        Assert.False(CompteursBorneBtp.AValider([4, 7], 7));
    }

    [Fact]
    public void Releve_d_un_autre_materiel_est_accepte_mais_a_valider()
    {
        Assert.True(CompteursBorneBtp.AValider([4, 7], 9));
        Assert.True(CompteursBorneBtp.AValider([], 9));
    }

    [Fact]
    public void Controle_de_valeur_inferieure_maintenu_pour_la_borne()
    {
        var jour = new DateOnly(2026, 11, 8);
        var existants = new List<ReleveCompteur> { new("H", jour.AddDays(-1), 100m, false, false, null) };
        Assert.Empty(ReglesCompteurs.Controler(["H"], existants));
        var apres = ReglesCompteurs.Controler(["H"], [.. existants, new ReleveCompteur("H", jour, 90m, false, false, null)]);
        Assert.Contains(apres, e => e.Code == "REL_DECROISSANT");
    }

    [Fact]
    public void Source_borne_prevue_par_le_schema()
    {
        Assert.Equal("BORNE", CompteursBorneBtp.SourceBorne);
    }
}
