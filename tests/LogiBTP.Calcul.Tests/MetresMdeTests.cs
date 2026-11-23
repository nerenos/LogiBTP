using LogiBTP.Api.Reprise;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Traduction des métrés MDE en scripts (devis DC25001A d'une base réelle, 20/11/2026).</summary>
public class MetresMdeTests
{
    private static MetresMde.Metre Metre(params (string Type, string Libelle)[] lignes) =>
        new("1", "Fondation", lignes.Select((l, i) => new MetresMde.Ligne(i, l.Type, l.Libelle, 1, null)).ToList(), []);

    [Theory]
    [InlineData("P*0.150", "$$P*0.150")]
    [InlineData("p*0,150", "$$P*0.150")]
    [InlineData("P/1000", "$$P/1000")]
    [InlineData("6*(22.000+18.500)*0.450*0.750", "6*(22.000+18.500)*0.450*0.750")]
    [InlineData("Arrondi(p ; 2)", "Arrondi($$P ; 2)")]
    public void Formule_traduite(string mde, string attendu) =>
        Assert.Equal(attendu, MetresMde.Expression(mde, ["P"], []));

    [Fact]
    public void Formule_seule_renvoyee()
    {
        var (script, ignores) = MetresMde.Script(Metre(("F", "P*45")), ["P"]);
        Assert.Equal("// Métré repris de MDE : Fondation\nRenvoyer $$P*45", script);
        Assert.Empty(ignores);
    }

    [Fact]
    public void Plusieurs_lignes_totalisees()
    {
        var (script, ignores) = MetresMde.Script(Metre(("T", "Semelles"), ("F", "a=2*3"), ("F", "A*p")), ["P"]);
        Assert.Equal("// Métré repris de MDE : Fondation\nlocal Total est un numérique = 0\n// Semelles\nlocal a est un numérique = 2*3\nTotal += a\nTotal += a*$$P\nRenvoyer Total", script);
        Assert.Equal(["T"], ignores);
    }

    [Fact]
    public void Affectations_du_recapitulatif()
    {
        var recap = Metre(("F", "P=1.1"), ("F", "6*2"));
        Assert.Equal([("P", "1.1")], MetresMde.Affectations(recap));
    }

    [Theory]
    [InlineData("[POIDS]*2", "{{lig_poids}}*2")]
    [InlineData("[longueur] * [ Largeur ]", "{{lig_longueur}} * {{lig_largeur}}")]
    [InlineData("[HAUTEUR]*p", "{{lig_hauteur}}*$$P")]
    [InlineData("[VOLUME]", "{{lig_surface}}")]
    [InlineData("[INCONNU]*2", "[INCONNU]*2")]
    public void Donnees_de_la_ligne_entre_crochets(string mde, string attendu) =>
        Assert.Equal(attendu, MetresMde.Expression(mde, ["P"], []));

    [Fact]
    public void Volume_selon_l_option_de_la_reprise() =>
        Assert.Equal("{{lig_volume}}*2", MetresMde.Expression("[VOLUME]*2", [], [], MetresMde.DonneesLigne(LogiBTP.Import.VolumeMde.Volume)));

    [Fact]
    public void Donnees_inconnues_signalees() =>
        Assert.Equal(["PRIX"], MetresMde.ChampsInconnus("[POIDS]*[PRIX]"));
}
