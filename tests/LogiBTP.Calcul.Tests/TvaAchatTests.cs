using LogiBTP.Api.Btp;
using LogiBTP.Documents;
using LogiBTP.Domaine;
using LogiBTP.Socle;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Avertissement de TVA non autoliquidée à la validation d'une pièce d'achat d'un fournisseur intracommunautaire.</summary>
public class TvaAchatTests
{
    private static readonly Dictionary<int, string> Categories = new() { [1] = "N", [2] = "A" };

    private static DocumentLigneBtp Ligne(long id, string numero, int tva) =>
        new() { LigId = id, LigTylId = TL.Element, LigNumerotation = numero, LigTypePrix = "V", LigTvaId = tva };

    private static List<MessageCalcul> Avertir(bool intracom, bool compta, params DocumentLigneBtp[] lignes)
    {
        var r = new List<MessageCalcul>();
        TvaAchatBtp.Avertir(FamillesDocument.Achat, intracom, compta, lignes, Categories, r);
        return r;
    }

    [Fact]
    public void Ligne_non_autoliquidee_signalee_avec_son_numero()
    {
        var r = Avertir(true, true, Ligne(10, "1", 2), Ligne(11, "2", 1));
        var m = Assert.Single(r);
        Assert.Equal(AvertissementsGestion.TvaNonAutoliquee, m.Code);
        Assert.Contains("2", m.Message);
        Assert.Equal(11, m.LigId);
    }

    [Fact]
    public void Toutes_autoliquidees_rien() => Assert.Empty(Avertir(true, true, Ligne(10, "1", 2), Ligne(11, "2", 2)));

    [Fact]
    public void Comptabilite_inactive_rien() => Assert.Empty(Avertir(true, false, Ligne(10, "1", 1)));

    [Fact]
    public void Fournisseur_ordinaire_rien() => Assert.Empty(Avertir(false, true, Ligne(10, "1", 1)));
}
