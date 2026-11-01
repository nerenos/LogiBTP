using LogiBTP.Domaine;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Marchés à facturer (13.9, lot E) : date de la pièce créée pour un mois.</summary>
public class MoisFacturationTests
{
    private static readonly DateOnly Aujourdhui = new(2026, 10, 31);

    [Fact]
    public void Mois_en_cours_date_du_jour()
    {
        Assert.Equal(Aujourdhui, MoisFacturation.DatePiece(new DateOnly(2026, 10, 1), Aujourdhui));
        Assert.Equal(Aujourdhui, MoisFacturation.DatePiece(new DateOnly(2026, 10, 17), Aujourdhui));
    }

    [Fact]
    public void Mois_passe_dernier_jour_du_mois()
    {
        Assert.Equal(new DateOnly(2026, 9, 30), MoisFacturation.DatePiece(new DateOnly(2026, 9, 1), Aujourdhui));
        Assert.Equal(new DateOnly(2024, 2, 29), MoisFacturation.DatePiece(new DateOnly(2024, 2, 1), Aujourdhui));
    }

    [Fact]
    public void Mois_a_venir_refuse()
    {
        Assert.Null(MoisFacturation.DatePiece(new DateOnly(2026, 11, 1), Aujourdhui));
    }
}
