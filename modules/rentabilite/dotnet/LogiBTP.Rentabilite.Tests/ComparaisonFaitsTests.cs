using Xunit;

namespace LogiBTP.Rentabilite.Tests;

/// <summary>Faits versionnés (§ 10.4) : seules les différences s'écrivent ; un fait identique n'est jamais réécrit.</summary>
public class ComparaisonFaitsTests
{
    private static Fait F(decimal pv, long lig = 1, string indicateur = Indicateur.Budget, string date = "2026-10-01") =>
        new(1, null, null, indicateur, Composante.Vente, DateOnly.Parse(date), 5, 2m, "m2", 10m, 12m, pv, null, SourceFait.Document, "V_COMMANDE", 100, lig, null,
            "LIGNE_VENDUE", "Enduit");

    [Fact]
    public void Faits_identiques_aucune_ecriture()
    {
        var d = ComparaisonFaits.Comparer([new(10, F(20m)), new(11, F(30m, 2))], [F(30m, 2), F(20m)]);
        Assert.True(d.Vide);
        Assert.Equal(2, d.Inchanges);
    }

    [Fact]
    public void Echelle_des_decimaux_ignoree()
    {
        // Relu de la base : numeric(18,6) ; calculé : autant de décimales que le calcul en donne.
        var d = ComparaisonFaits.Comparer([new(10, F(20.000000m) with { Qte = 2.000000m })], [F(20m) with { MontantPa = 10.0000001m }]);
        Assert.True(d.Vide);
    }

    [Fact]
    public void Fait_modifie_clos_et_rouvert()
    {
        var d = ComparaisonFaits.Comparer([new(10, F(20m)), new(11, F(30m, 2))], [F(25m), F(30m, 2)]);
        Assert.Equal([10L], d.Retraits);
        Assert.Single(d.Ajouts);
        Assert.Equal(25m, d.Ajouts[0].MontantPv);
        Assert.Equal(1, d.Modifies);
        Assert.Equal(1, d.Inchanges);
    }

    [Fact]
    public void Fait_ajoute_et_fait_retire()
    {
        var d = ComparaisonFaits.Comparer([new(10, F(20m)), new(11, F(30m, 2))], [F(20m), F(5m, 3, Indicateur.Facture)]);
        Assert.Equal([11L], d.Retraits);
        Assert.Single(d.Ajouts);
        Assert.Equal(0, d.Modifies);
    }

    [Fact]
    public void Doublons_comptes_un_par_un()
    {
        var d = ComparaisonFaits.Comparer([new(10, F(20m)), new(11, F(20m))], [F(20m)]);
        Assert.Single(d.Retraits);
        Assert.Empty(d.Ajouts);
        var e = ComparaisonFaits.Comparer([new(10, F(20m))], [F(20m), F(20m)]);
        Assert.Empty(e.Retraits);
        Assert.Single(e.Ajouts);
    }

    [Fact]
    public void Date_changee_fait_modifie()
    {
        // Facture fournisseur saisie à sa vraie date : le fait change de date, l'ancien reste consultable (clos).
        var d = ComparaisonFaits.Comparer([new(10, F(20m, date: "2026-10-31"))], [F(20m, date: "2026-10-15")]);
        Assert.Equal([10L], d.Retraits);
        Assert.Equal(1, d.Modifies);
    }
}
