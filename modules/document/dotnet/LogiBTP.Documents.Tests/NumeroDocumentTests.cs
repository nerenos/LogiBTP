using Xunit;

namespace LogiBTP.Documents.Tests;

/// <summary>Format du numéro légal d'un type (tyd_format_numero) : formatage, lecture, contrôles, début commun.</summary>
public class NumeroDocumentTests
{
    [Theory]
    [InlineData(null, "DV", 2026, 12, "DV2026-00012")]
    [InlineData("{P}{AA}/{N:4}", "FA", 2026, 7, "FA26/0007")]
    [InlineData("{P}-{N}", "CC", 2026, 123, "CC-123")]
    [InlineData("{AAAA}{P}{N:6}", "X", 2025, 42, "2025X000042")]
    public void Formate_selon_le_format(string? format, string prefixe, int annee, int rang, string attendu) =>
        Assert.Equal(attendu, NumeroDocument.Formater(format, prefixe, annee, rang));

    [Fact]
    public void Lit_annee_et_rang()
    {
        Assert.Equal(new NumeroLu(2026, 12), NumeroDocument.Lire(null, "DV", "DV2026-00012"));
        Assert.Equal(new NumeroLu(2026, 7), NumeroDocument.Lire("{P}{AA}/{N:4}", "FA", "FA26/0007"));
        Assert.Equal(new NumeroLu(null, 123), NumeroDocument.Lire("{P}-{N}", "CC", "CC-123"));
        Assert.Null(NumeroDocument.Lire(null, "DV", "DV2026-00000"));
        Assert.Null(NumeroDocument.Lire(null, "DV", "FA2026-00001"));
        Assert.Null(NumeroDocument.Lire("{P}-{N}", "C.", "CX-1")); // préfixe littéral, jamais une expression
    }

    [Fact]
    public void Controle_le_format()
    {
        Assert.Null(NumeroDocument.Controler(null, "A"));
        Assert.Null(NumeroDocument.Controler("{P}-{N:6}", "J"));
        Assert.NotNull(NumeroDocument.Controler("{P}-{N:6}", "A"));      // remise annuelle sans année
        Assert.NotNull(NumeroDocument.Controler("{P}{AAAA}", "A"));       // sans rang
        Assert.NotNull(NumeroDocument.Controler("{P}{N}{N}", "J"));       // deux rangs
        Assert.NotNull(NumeroDocument.Controler("{P}{MM}{N}", "J"));      // jeton inconnu
    }

    [Fact]
    public void Debut_commun_des_numeros()
    {
        Assert.Equal("DV2026-", NumeroDocument.Debut(null, "DV", 2026));
        Assert.Equal("DV", NumeroDocument.Debut(null, "DV", null));
        Assert.Equal("CC-", NumeroDocument.Debut("{P}-{N}", "CC", null));
        Assert.Equal(0, NumeroDocument.Exercice("J", 2026));
        Assert.Equal(2026, NumeroDocument.Exercice("A", 2026));
    }
}
