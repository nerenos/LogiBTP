using LogiBTP.Api.Btp;
using LogiBTP.Documents;
using LogiBTP.Socle.Web;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Facture brouillon depuis le bon de SAV (plan terrain-suites, lot 22 ; TS21 a, TS22 c).</summary>
public class FacturationSavTests
{
    private static readonly ArticleMainOeuvreSav Article = new(12, "MO-SAV", "Main-d'œuvre SAV", 1, "BTP", "h", 30m, 1.1m, 1.2m, 55m, 1m, 4, "706100", "T20");

    [Fact]
    public void Bon_de_deux_heures_et_deux_fournitures_trois_lignes()
    {
        var heures = FacturationSavBtp.Heures(120, 0);
        Assert.Equal(2m, heures);
        var lignes = FacturationSavBtp.LignesFacture(500, 1, 1, Article, heures, ["Joint 20x27", "Robinet <1/2>", " "], 9, 3);
        Assert.Equal(3, lignes.Count);
        Assert.All(lignes, l => Assert.Equal(TL.Element, l.LigTylId));
        Assert.All(lignes, l => Assert.Equal(500, l.LigEntId));
        Assert.Equal([1, 2, 3], lignes.Select(l => l.LigOrdre));

        var temps = lignes[0];
        Assert.Equal(12, temps.LigArtId);
        Assert.Equal("MO-SAV", temps.LigCode);
        Assert.Equal(2m, temps.LigQte);
        Assert.Equal("h", temps.LigUntCode);
        Assert.True(temps.LigPvFixe);
        Assert.Equal(55m, temps.LigPv);
        Assert.Equal("706100", temps.LigCptCode);
        Assert.Equal(4, temps.LigNatId);
        Assert.Equal(9, temps.LigTvaId);
        Assert.Equal(12, temps.LigProprietes!.RootElement.GetProperty("element").GetProperty("id").GetInt64());

        Assert.Null(lignes[1].LigArtId);
        Assert.Equal("Joint 20x27", lignes[1].LigLibelleHtml);
        Assert.Equal("Robinet &lt;1/2&gt;", lignes[2].LigLibelleHtml);
        Assert.Equal(1m, lignes[2].LigQte);
        Assert.Null(lignes[2].LigPv);
        Assert.Equal(9, lignes[2].LigTvaId);
    }

    [Fact]
    public void TVA_par_defaut_et_code_d_une_autre_bibliotheque()
    {
        var lignes = FacturationSavBtp.LignesFacture(1, 3, 2, Article with { TvaCode = null }, 1.5m, [], null, 3);
        Assert.Single(lignes);
        Assert.Equal(3, lignes[0].LigTvaId);
        Assert.Equal(3, lignes[0].LigOrdre);
        Assert.Equal("BTP:MO-SAV", lignes[0].LigCode);
    }

    [Fact]
    public void Heures_pointees_sinon_heures_realisees()
    {
        Assert.Equal(1.75m, FacturationSavBtp.Heures(105, 4m));
        Assert.Equal(0.33m, FacturationSavBtp.Heures(20, 0));
        Assert.Equal(4m, FacturationSavBtp.Heures(0, 4m));
    }

    [Fact]
    public void Second_clic_refuse_si_une_facture_brouillon_existe()
    {
        FacturationSavBtp.ExigerSansBrouillon(null);
        var e = Assert.Throws<ExceptionMetier>(() => FacturationSavBtp.ExigerSansBrouillon("FA-0012"));
        Assert.Equal("SAV_FACTURE_BROUILLON", e.Code);
        Assert.Equal(409, e.Statut);
    }

    [Fact]
    public void Facture_jamais_validee_par_la_route()
    {
        // La route crée et enregistre la facture, sans jamais la valider (brouillon à reprendre au bureau).
        var source = File.ReadAllText(Path.Combine(Racine(), "src", "LogiBTP.Api", "Btp", "FacturationSavBtp.cs"));
        Assert.Contains("documents.Creer(", source);
        Assert.Contains("documents.Enregistrer(", source);
        Assert.DoesNotContain(".Valider(", source);
    }

    private static string Racine()
    {
        var d = new DirectoryInfo(AppContext.BaseDirectory);
        while (d is not null && !File.Exists(Path.Combine(d.FullName, "LogiBTP.slnx"))) d = d.Parent;
        return d?.FullName ?? throw new DirectoryNotFoundException("LogiBTP.slnx");
    }
}
