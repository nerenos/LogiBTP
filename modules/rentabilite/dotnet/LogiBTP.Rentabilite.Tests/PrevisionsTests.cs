using Xunit;

namespace LogiBTP.Rentabilite.Tests;

/// <summary>Saisies prévisionnelles (lot 6) : contrôle, montants retenus, état, fait PREVU_*.</summary>
public class PrevisionsTests
{
    private static SaisiePrevision S(string indicateur, decimal? pa = null, decimal? pr = null, decimal? pv = null, string? composante = null, string? libelle = "Facture non parvenue") =>
        new(indicateur, composante, new DateOnly(2026, 11, 2), null, 11, pa, pr, pv, libelle, null, null, null, null, null);

    [Fact]
    public void Controle_indicateur_libelle_montant_composante()
    {
        Assert.Equal(ErreurPrevision.Indicateur, Assert.Single(Previsions.Controler(S("PRODUCTION", pa: 1))).Code);
        Assert.Equal(ErreurPrevision.Libelle, Assert.Single(Previsions.Controler(S(Indicateur.Debourse, pa: 1, libelle: " "))).Code);
        Assert.Equal(ErreurPrevision.Montant, Assert.Single(Previsions.Controler(S(Indicateur.Debourse))).Code);
        // Un PV seul sur un déboursé est mis à zéro : montant nul.
        Assert.Equal(ErreurPrevision.Montant, Assert.Single(Previsions.Controler(S(Indicateur.Debourse, pv: 100))).Code);
        Assert.Equal(ErreurPrevision.Composante, Assert.Single(Previsions.Controler(S(Indicateur.Engage, pa: 1, composante: Composante.Vente))).Code);
        Assert.Empty(Previsions.Controler(S(Indicateur.Facture, pv: 100)));
    }

    [Fact]
    public void Montants_selon_l_indicateur_et_pr_par_defaut()
    {
        Assert.Equal((100m, 100m, 0m), Previsions.Montants(S(Indicateur.Debourse, pa: 100, pv: 300)));
        Assert.Equal((100m, 120m, 300m), Previsions.Montants(S(Indicateur.Budget, pa: 100, pr: 120, pv: 300)));
        Assert.Equal((0m, 0m, 300m), Previsions.Montants(S(Indicateur.Facture, pa: 100, pv: 300)));
    }

    [Fact]
    public void Etat_soldee_echue_ouverte()
    {
        var jour = new DateOnly(2026, 11, 2);
        Assert.Equal(EtatPrevision.Soldee, Previsions.Etat(jour, jour.AddDays(-5), jour));
        Assert.Equal(EtatPrevision.Echue, Previsions.Etat(null, jour.AddDays(-1), jour));
        Assert.Equal(EtatPrevision.Ouverte, Previsions.Etat(null, jour, jour));
        Assert.Equal(EtatPrevision.Ouverte, Previsions.Etat(null, null, jour));
    }

    [Fact]
    public void Fait_prevu_jamais_melange_au_reel()
    {
        var f = Previsions.Fait(7, 42, S(Indicateur.Engage, pa: 100, composante: Composante.SousTraitance));
        Assert.Equal(Indicateur.PrevuEngage, f.Indicateur);
        Assert.Equal(Composante.SousTraitance, f.Composante);
        Assert.Equal(SourceFait.Prevision, f.SourceType);
        Assert.Equal(42, f.SourceId);
        Assert.Equal(100m, f.MontantPr);
        Assert.Equal(Composante.Vente, Previsions.Fait(7, 1, S(Indicateur.Budget, pv: 10, composante: Composante.Achat)).Composante);
        Assert.All(Previsions.IndicateursPrevus.Values, i => Assert.StartsWith("PREVU_", i));
    }
}
