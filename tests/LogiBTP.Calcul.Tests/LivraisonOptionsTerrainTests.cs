using LogiBTP.Api.Btp;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Réception sur le terrain d'une commande à options ou variantes (plan terrain-suites, lot 20 ; TS19).</summary>
public class LivraisonOptionsTerrainTests
{
    private static DocumentLigneBtp Ligne(long id, string prix = "V", long? parent = null, short type = TL.Element, long? varianteDe = null) =>
        new() { LigId = id, LigParentId = parent, LigTylId = type, LigTypePrix = prix, LigVarianteDeId = varianteDe, LigQteVendue = 10 };

    // 1 vendue ; 2 option retenue ; 3 option écartée ; 4 base d'une variante 5 retenue (base écartée) ; 6 ouvrage en option retenue, 7 son composant.
    private static readonly List<DocumentLigneBtp> Commande =
    [
        Ligne(1), Ligne(2, "O"), Ligne(3, "O"), Ligne(4), Ligne(5, "A", varianteDe: 4),
        Ligne(6, "O", type: TL.Ouvrage), Ligne(7, "O", parent: 6),
    ];

    [Fact]
    public void Option_retenue_proposee_option_ecartee_non()
    {
        var unites = Options.Unites(Commande);
        var choix = new List<ChoixOption> { new() { LigId = 2, Retenue = true }, new() { LigId = 3, Retenue = false }, new() { LigId = 4, Retenue = false },
            new() { LigId = 5, Retenue = true }, new() { LigId = 6, Retenue = true } };
        var (ecartees, options) = TerrainBtp.LignesSelonChoix(Commande, unites, choix);
        Assert.Equal([2L, 5L, 6L], options);
        Assert.Contains(3L, ecartees);
        Assert.Contains(4L, ecartees);
        Assert.DoesNotContain(1L, ecartees);
        Assert.DoesNotContain(2L, ecartees);
    }

    [Fact]
    public void Choix_connus_par_une_transformation_precedente_qui_les_couvre_tous()
    {
        var unites = Options.Unites(Commande);
        var partiel = new Dictionary<long, bool> { [2] = true };
        var complet = new Dictionary<long, bool> { [2] = true, [3] = false, [4] = false, [5] = true, [6] = false };
        var c = TerrainBtp.ChoixConnus(unites, [partiel, complet]);
        Assert.NotNull(c);
        Assert.Equal([2L, 3L, 4L, 5L, 6L], c!.Select(x => x.LigId));
        Assert.False(c.Single(x => x.LigId == 3).Retenue);
    }

    [Fact]
    public void Choix_inconnus_refus_garde_et_commande_sans_option_inchangee()
    {
        Assert.Null(TerrainBtp.ChoixConnus(Options.Unites(Commande), []));
        Assert.Empty(TerrainBtp.ChoixConnus(Options.Unites([Ligne(1), Ligne(2)]), [])!);
    }
}
