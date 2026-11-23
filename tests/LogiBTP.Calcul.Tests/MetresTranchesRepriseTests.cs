using LogiBTP.Api.Reprise;
using LogiBTP.Domaine;
using LogiBTP.Documents;
using Xunit;


namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Reprise MDE des métrés de tranche et du récapitulatif (plan metres-tranches-document, lot 7) : récapitulatif R et
/// variables globales → métré du document ; tranche T à quantité ≠ 1 → quantité de tranche ; métré d'une tranche →
/// métré de tranche ; le total HT calculé retrouve celui de la source.
/// </summary>
public class MetresTranchesRepriseTests
{
    [Fact]
    public void Script_du_document_declare_puis_reaffecte()
    {
        var script = MetresMde.ScriptDocument([("P", "1,1"), ("h", "p*2"), ("P", "1.2"), ("H", "2.5")]);
        Assert.Equal("// Récapitulatif repris de MDE : variables du document\nP est un numérique = 1.1\nh est un numérique = P*2\nP = 1.2\nh = 2.5", script);
    }

    private static PieceSource Piece(decimal? qteTranche, MetrePiece? metreTranche) => new()
    {
        Origine = ("PMEDOCDEVCLI", "1"), TypeDocument = "V_DEVIS", Date = new DateOnly(2024, 1, 1), Statut = PiecesReprise.Statut.Brouillon,
        MetreDocument = new MetrePiece(MetresMde.LibelleMetreDocument, MetresMde.ScriptDocument([("P", "1.5")])),
        Lignes =
        [
            new LignePiece { Cle = "1", Reference = "11", Type = TL.Titre, LibelleHtml = "Étage", Qte = qteTranche, Metre = metreTranche },
            new LignePiece
            {
                Cle = "2", Reference = "12", ParentCle = "1", Type = TL.Element, LibelleHtml = "Mur", Qte = 3, Pa = 10, TvaId = 1,
                Metre = new MetrePiece("Mur", "Renvoyer $$P * 2"),
            },
        ],
    };

    private static ResultatCalcul Calculer(PieceSource p, out List<DocumentLigneBtp> lignes)
    {
        lignes = PiecesReprise.Lignes(p, null);
        return MoteurDevisBtp.Calculer(new EntreeCalcul
        {
            Document = new DocumentBtp { EntId = 1, EntModeCalculOuvrage = "B", EntPrecisionMontant = 2 },
            Lignes = lignes, Metres = PiecesReprise.Metres(p, lignes), Variables = PiecesReprise.Variables(p),
            TauxTva = [new TauxTva { TtvId = 1, TtvCode = "T20", TtvTaux = 20, TtvCategorie = "N" }],
        });
    }

    [Fact]
    public void Recapitulatif_en_metre_du_document_et_tranche_a_quantite()
    {
        var p = Piece(2, null);
        var r = Calculer(p, out var lignes);
        var tranche = lignes.Single(l => l.LigTylId == TL.Titre);
        Assert.Equal(2m, tranche.LigQte);
        var doc = Assert.Single(PiecesReprise.Metres(p, lignes), m => m.MtrLigId is null);
        Assert.Contains("P est un numérique = 1.5", doc.MtrScript);
        // Mur : $$P × 2 = 3 (le métré lit le métré du document) × 10 = 30, tranche × 2 → 60.
        Assert.Equal(3m, r.Lignes.Single(l => l.LigLibelleHtml == "Mur").LigQteVendue);
        Assert.Equal(60m, r.Document.EntTotalHt);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0)]
    [InlineData(1)]
    public void Tranche_sans_quantite_reste_a_un(int? qte)
    {
        var r = Calculer(Piece(qte, null), out var lignes);
        Assert.Null(lignes.Single(l => l.LigTylId == TL.Titre).LigQte);
        Assert.Equal(30m, r.Document.EntTotalHt);
    }

    [Fact]
    public void Metre_de_tranche_donne_sa_quantite()
    {
        // Métré de la tranche : 4 étages (sa quantité source) ; ses variables non locales sont publiées en $.
        var r = Calculer(Piece(4, new MetrePiece("Étages", "Niveaux est un numérique = 4\nRenvoyer Niveaux")), out var lignes);
        var tranche = lignes.Single(l => l.LigTylId == TL.Titre);
        Assert.Equal("M", tranche.LigQteSource);
        Assert.NotNull(tranche.LigMtrId);
        Assert.Equal(4m, r.Lignes.Single(l => l.LigTylId == TL.Titre).LigQteVendue);
        Assert.Equal(120m, r.Document.EntTotalHt);
        Assert.Contains(r.Variables, v => v.VarPortee == "$" && v.VarNom == "Niveaux" && v.VarLigId == tranche.LigId);
    }
}
