using Xunit;

namespace LogiBTP.Pointage.Tests;

/// <summary>Repas d'équipe à la borne : contrôle de chaque membre seul.</summary>
public class ReglesRepasTests
{
    private static readonly HashSet<int> Equipe = [1, 2, 3];

    [Fact]
    public void Trois_membres_trois_repas()
    {
        var r = ReglesRepas.Repartir([1, 2, 3], Equipe, new HashSet<int>());
        Assert.Equal([1, 2, 3], r.Acceptes);
        Assert.Empty(r.Refus);
    }

    [Fact]
    public void Membre_deja_declare_refuse_seul()
    {
        var r = ReglesRepas.Repartir([1, 2, 3], Equipe, new HashSet<int> { 2 });
        Assert.Equal([1, 3], r.Acceptes);
        Assert.Equal([new RefusRepas(2, ErreursPointage.RepasDeja)], r.Refus);
    }

    [Fact]
    public void Salarie_hors_equipe_refuse()
    {
        var r = ReglesRepas.Repartir([1, 9, 1], Equipe, new HashSet<int>());
        Assert.Equal([1], r.Acceptes);
        Assert.Equal([new RefusRepas(9, ErreursPointage.RepasHorsEquipe)], r.Refus);
    }
}
