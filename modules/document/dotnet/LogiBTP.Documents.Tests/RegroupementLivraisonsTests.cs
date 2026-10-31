using Xunit;

namespace LogiBTP.Documents.Tests;

/// <summary>Facture de plusieurs livraisons d'une commande : une section, une tranche par livraison, pied de la première.</summary>
public class RegroupementLivraisonsTests
{
    private static long _id = -1000;
    private static long Id() => --_id;

    private static List<DocumentLigne> Livraison(long debut, bool enSection)
    {
        var lignes = new List<DocumentLigne>();
        long? parent = null;
        if (enSection)
        {
            lignes.Add(new DocumentLigne { LigId = debut, LigTylId = TL.Section, LigOrdre = 1, LigLibelleHtml = "BL" });
            parent = debut;
        }
        lignes.Add(new DocumentLigne { LigId = debut + 1, LigParentId = parent, LigTylId = TL.Element, LigOrdre = 1, LigLibelleHtml = "Acier" });
        lignes.Add(new DocumentLigne { LigId = debut + 2, LigParentId = parent, LigTylId = TL.Element, LigOrdre = 2, LigLibelleHtml = "Béton" });
        lignes.Add(new DocumentLigne { LigId = debut + 3, LigParentId = parent, LigTylId = TL.PiedHt, LigOrdre = 3, LigLibelleHtml = "Remise" });
        lignes.Add(new DocumentLigne { LigId = debut + 4, LigParentId = parent, LigTylId = TL.Tva, LigOrdre = 4, LigLibelleHtml = "TVA" });
        return lignes;
    }

    [Fact]
    public void Une_section_une_tranche_par_livraison_et_le_pied_de_la_premiere()
    {
        var res = RegroupementLivraisons.Regrouper(new List<(List<DocumentLigne>, string)> { (Livraison(10, false), "BL RF-1"), (Livraison(20, true), "BL RF-2") }, 5, "Commande CF-1", "CF-1", Id);
        var section = Assert.Single(res, l => l.LigParentId is null);
        Assert.Equal(TL.Section, section.LigTylId);
        Assert.Equal("CF-1", section.LigCode);
        Assert.Equal((long?)5, RegroupementLivraisons.Origine(section));
        var enfants = res.Where(l => l.LigParentId == section.LigId).OrderBy(l => l.LigOrdre).ToList();
        Assert.Equal(new[] { TL.Titre, TL.Titre, TL.PiedHt, TL.Tva }, enfants.Select(l => l.LigTylId));
        Assert.Equal(new long[] { 11, 12 }, res.Where(l => l.LigParentId == enfants[0].LigId).Select(l => l.LigId).OrderBy(x => x).ToList());
        Assert.Equal(new long[] { 21, 22 }, res.Where(l => l.LigParentId == enfants[1].LigId).Select(l => l.LigId).OrderBy(x => x).ToList());
        Assert.Equal(new long[] { 13, 14 }, enfants.Skip(2).Select(l => l.LigId));
        // Pied et section propre de la seconde livraison retirés.
        Assert.DoesNotContain(res, l => l.LigId is 20 or 23 or 24);
    }

    [Fact]
    public void Ajout_a_une_section_regroupee_avant_son_pied()
    {
        var lignes = RegroupementLivraisons.Regrouper(new List<(List<DocumentLigne>, string)> { (Livraison(10, false), "BL RF-1"), (Livraison(20, false), "BL RF-2") }, 5, "Commande CF-1", "CF-1", Id);
        var section = lignes.Single(l => l.LigParentId is null);
        var ajout = RegroupementLivraisons.Ajouter(section, lignes.Where(l => l.LigParentId == section.LigId).ToList(), new List<(List<DocumentLigne>, string)> { (Livraison(30, false), "BL RF-3") }, Id);
        lignes.AddRange(ajout);
        var enfants = lignes.Where(l => l.LigParentId == section.LigId).OrderBy(l => l.LigOrdre).ToList();
        Assert.Equal(new[] { TL.Titre, TL.Titre, TL.Titre, TL.PiedHt, TL.Tva }, enfants.Select(l => l.LigTylId));
        Assert.DoesNotContain(lignes, l => l.LigId is 33 or 34);
    }
}
