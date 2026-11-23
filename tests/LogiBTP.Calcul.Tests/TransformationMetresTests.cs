using System.Text.Json;
using LogiBTP.Api.Btp;
using LogiBTP.Domaine;
using LogiBTP.Socle;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Métrés de tranche et métré du document (plan metres-tranches-document, lot 5) : une copie ou une transformation
/// (renumérotation puis filtrage des compléments) emporte le métré du document et les métrés de tranche ;
/// le document obtenu se recalcule aux mêmes totaux.
/// </summary>
public class TransformationMetresTests
{
    private static EntreeCalcul Entree(string fichier) =>
        CasPartages.Lire(Path.Combine(CasPartages.Chemin(["tests", "cas"]), fichier))["entree"]
            .Deserialize<EntreeCalcul>(JsonCalcul.Options)!;

    /// <summary>Copie l'entrée comme le fait la transformation : nouveaux ID négatifs, compléments renumérotés et filtrés.</summary>
    private static (EntreeCalcul entree, DocumentCompletBtp complet) Transformer(EntreeCalcul source, Func<DocumentLigneBtp, bool>? garder = null)
    {
        var json = JsonSerializer.Serialize(source, JsonCalcul.Options);
        var copie = JsonSerializer.Deserialize<EntreeCalcul>(json, JsonCalcul.Options)!;
        var d = new DocumentCompletBtp
        {
            Document = copie.Document,
            Lignes = copie.Lignes,
            Metres = copie.Metres,
            Variables = copie.Variables.Where(v => v.VarMtrId is null).ToList(),
        };
        long n = 0;
        var lig = d.Lignes.ToDictionary(l => l.LigId, _ => --n);
        long? Map(long? id) => id is long v && lig.TryGetValue(v, out var r) ? r : null;
        foreach (var l in d.Lignes)
        {
            l.LigId = lig[l.LigId];
            l.LigParentId = Map(l.LigParentId);
        }
        var specialisation = new SpecialisationBtp();
        specialisation.RenumeroterComplements(d, lig, ref n);
        var gardees = d.Lignes.Where(garder ?? (_ => true)).Select(l => l.LigId).ToHashSet();
        d.Lignes = d.Lignes.Where(l => gardees.Contains(l.LigId)).ToList();
        specialisation.FiltrerComplements(d, gardees);
        return (new EntreeCalcul
        {
            Document = d.Document,
            Lignes = d.Lignes,
            Metres = d.Metres,
            Variables = d.Variables,
            TauxTva = copie.TauxTva,
            Options = copie.Options,
        }, d);
    }

    [Theory]
    [InlineData("25_metre_tranche.json")]
    [InlineData("26_metre_document.json")]
    public void Copie_garde_les_totaux(string fichier)
    {
        var source = Entree(fichier);
        var avant = MoteurDevisBtp.Calculer(source);
        var (entree, _) = Transformer(source);
        var apres = MoteurDevisBtp.Calculer(entree);
        Assert.Equal(avant.Document.EntTotalHt, apres.Document.EntTotalHt);
        Assert.Equal(avant.Document.EntTotalTtc, apres.Document.EntTotalTtc);
        Assert.Equal(
            avant.Lignes.Select(l => (l.LigQteVendue, l.LigMontantHt)),
            apres.Lignes.Select(l => (l.LigQteVendue, l.LigMontantHt)));
    }

    [Fact]
    public void Metre_du_document_suit_la_transformation_partielle()
    {
        var source = Entree("26_metre_document.json");
        // Seule la tranche et sa ligne sont transformées : le métré du document (sans ligne) suit quand même.
        var (entree, complet) = Transformer(source, l => l.LigLibelleHtml != "Murs");
        var doc = Assert.Single(complet.Metres, m => m.MtrLigId is null);
        Assert.Equal(complet.Document.EntId, doc.MtrEntId);
        Assert.All(complet.Metres.Where(m => m.MtrLigId is not null), m => Assert.Null(m.MtrEntId));
        var r = MoteurDevisBtp.Calculer(entree);
        // Plinthes : 2,5 × 10 = 25 par logement, tranche × 2 → 100 (les $$ du métré du document sont toujours lus).
        Assert.Equal(100m, r.Document.EntTotalHt);
    }
}
