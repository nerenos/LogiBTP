using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using Xunit;

namespace LogiBTP.Documents.Tests;

/// <summary>Contrôle de date de la numérotation continue (D3) : pièces REMPLACE et groupe d'indices écartés.</summary>
public class ChronologiePiecesTests
{
    private static readonly DateOnly Date = new(2026, 11, 1);
    private static readonly DateOnly Plus = new(2026, 11, 5);

    [Fact]
    public void Situation_B_acceptee_quand_A_remplacee_est_datee_plus_tard()
    {
        var a = new PieceChronologie(1, "S1", Plus, 10, StatutsDocument.Remplace);
        Assert.Null(ChronologiePieces.Derniere([a], 2, 10, Date));
    }

    [Fact]
    public void Piece_du_meme_groupe_ecartee()
    {
        var a = new PieceChronologie(1, "S1", Plus, 10, StatutsDocument.Valide);
        Assert.Null(ChronologiePieces.Derniere([a], 2, 10, Date));
    }

    [Fact]
    public void Piece_annulee_plus_tard_maintient_le_refus()
    {
        var a = new PieceChronologie(1, "S1", Plus, 11, StatutsDocument.Annule);
        Assert.Equal("S1", ChronologiePieces.Derniere([a], 2, 10, Date)?.Numero);
    }

    [Fact]
    public void Piece_valable_dun_autre_document_maintient_le_refus()
    {
        var a = new PieceChronologie(1, "S1", Plus, 11, StatutsDocument.Valide);
        Assert.Equal("S1", ChronologiePieces.Derniere([a], 2, 10, Date)?.Numero);
    }
}
