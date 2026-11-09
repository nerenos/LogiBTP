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

    // Heures de matériel à la borne (db/292, plan terrain-suites, lot 19, TS18 a).
    [Fact]
    public void Duree_enregistree_pour_un_materiel_affecte_sur_un_chantier_de_la_journee()
    {
        Assert.Null(CompteursBorneBtp.RefusHeure([4, 7], [12, 15], new HeureMaterielBorne(7, 15, 240)));
    }

    [Fact]
    public void Materiel_d_un_autre_refuse()
    {
        Assert.Equal("BORNE_MATERIEL", CompteursBorneBtp.RefusHeure([4, 7], [12], new HeureMaterielBorne(9, 12, 60))?.Code);
    }

    [Fact]
    public void Chantier_hors_journee_et_duree_invalide_refuses()
    {
        Assert.Equal("BORNE_CHANTIER", CompteursBorneBtp.RefusHeure([4], [12], new HeureMaterielBorne(4, 99, 60))?.Code);
        Assert.Equal("BORNE_DUREE", CompteursBorneBtp.RefusHeure([4], [12], new HeureMaterielBorne(4, 12, 0))?.Code);
        Assert.Equal("BORNE_DUREE", CompteursBorneBtp.RefusHeure([4], [12], new HeureMaterielBorne(4, 12, 1500))?.Code);
    }
}
