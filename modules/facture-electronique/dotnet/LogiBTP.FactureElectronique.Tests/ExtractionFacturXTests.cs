using System.Text.Json;
using LogiBTP.FactureElectronique.Formats;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Writer;
using Xunit;

namespace LogiBTP.FactureElectronique.Tests;

/// <summary>Factur-X : extraction du factur-x.xml d'un PDF/A-3 (exemples FNFE BASIC WL, EN16931, EXTENDED) et erreurs.</summary>
public class ExtractionFacturXTests
{
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = false };

    /// <summary>PDF d'exemple et XML de référence (le même XML, publié à part par le FNFE).</summary>
    public static TheoryData<string, string> Pdf() => new()
    {
        { "factur-x/basicwl/Facture_F20260023-LE_FOURNISSEUR-POUR-LE_CLIENT_BASICWL_FX.pdf",
          "factur-x/basicwl/Facture_F20260023-LE_FOURNISSEUR-POUR-LE_CLIENT_BASICWL_FX_CII_Commentee.xml" },
        { "factur-x/en16931/UC1_F202500003_00-INV_20250701_EN16931_FX.pdf",
          "cii/en16931/UC1_F202500003_00-INV_20250701_EN16931_FX_CII_Commentee.xml" },
        { "factur-x/extended/UC13_F202600037_EXTENDED_FX.pdf",
          "factur-x/extended/UC13_F202600037_EXTENDED_FX_CII_Commentee.xml" },
    };

    [Theory]
    [MemberData(nameof(Pdf))]
    public void Le_PDF_donne_la_facture_du_XML_de_reference(string pdf, string xml)
    {
        var lue = ExtractionFacturX.Lire(File.ReadAllBytes(LectureCiiTests.Dossier(pdf)));
        var reference = LectureCii.Lire(File.ReadAllBytes(LectureCiiTests.Dossier(xml)), facturX: true);
        Assert.Equal(JsonSerializer.Serialize(reference, Json), JsonSerializer.Serialize(lue, Json));
    }

    [Fact]
    public void PDF_illisible()
    {
        var e = Assert.Throws<ExceptionLectureFacture>(() => ExtractionFacturX.Extraire("ceci n'est pas un PDF"u8.ToArray()));
        Assert.Equal(ErreurFe.PdfIllisible, e.Code);
    }

    [Fact]
    public void PDF_sans_XML_embarque()
    {
        var constructeur = new PdfDocumentBuilder();
        constructeur.AddPage(PageSize.A4);
        var e = Assert.Throws<ExceptionLectureFacture>(() => ExtractionFacturX.Extraire(constructeur.Build()));
        Assert.Equal(ErreurFe.XmlAbsent, e.Code);
    }
}
