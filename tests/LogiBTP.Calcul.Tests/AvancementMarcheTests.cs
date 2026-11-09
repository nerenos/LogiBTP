using LogiBTP.Api.Btp;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Avancement réel par marché (plan terrain-suites, lot 21 ; TS20 a).</summary>
public class AvancementMarcheTests
{
    private static readonly DateOnly Jour = new(2026, 11, 8);

    // Chantier à deux marchés (10 et 20) : deux tâches de chaque, une tâche de niveau chantier.
    private static readonly List<TacheAvancement> Taches =
    [
        new(1, "Gros œuvre A", 100, 50, Jour, 10),
        new(2, "Finitions A", 100, null, null, 10),
        new(3, "Gros œuvre B", 30, 100, Jour.AddDays(-2), 20),
        new(4, "Finitions B", 10, 20, Jour.AddDays(-1), 20),
        new(5, "Installation de chantier", 50, 100, Jour, null),
    ];

    [Fact]
    public void Chantier_a_deux_marches_avancement_propre_a_chacun()
    {
        var (a, exclues) = AvancementMarche.Repartir(Taches, 10, 2);
        Assert.Equal([1L, 2L], a.Select(t => t.Id));
        Assert.Equal(25m, AvancementMarche.Reel(a));
        Assert.Equal([5L], exclues.Select(t => t.Id));
        var (b, _) = AvancementMarche.Repartir(Taches, 20, 2);
        Assert.Equal(80m, AvancementMarche.Reel(b));
    }

    [Fact]
    public void Chantier_a_un_marche_inchange()
    {
        var (toutes, exclues) = AvancementMarche.Repartir(Taches, 10, 1);
        Assert.Equal(5, toutes.Count);
        Assert.Empty(exclues);
        // (100×50 + 100×0 + 30×100 + 10×20 + 50×100) / 290 = 45,5172… → 45,5
        Assert.Equal(45.5m, AvancementMarche.Reel(toutes));
    }

    [Fact]
    public void Sans_heures_pas_d_avancement()
    {
        Assert.Null(AvancementMarche.Reel([new(1, "x", 0, 50, Jour, 10)]));
    }

    [Fact]
    public void Requete_resout_le_marche_par_l_origine()
    {
        Assert.Contains("tac_origine_type = 'ordre'", AvancementMarche.SqlTachesChantier);
        Assert.Contains("tac_origine_type = 'ligne'", AvancementMarche.SqlTachesChantier);
        Assert.Contains("marche_document", AvancementMarche.SqlTachesChantier);
    }
}
