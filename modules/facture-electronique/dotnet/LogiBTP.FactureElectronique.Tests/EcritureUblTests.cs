using LogiBTP.FactureElectronique.Formats;
using Xunit;

namespace LogiBTP.FactureElectronique.Tests;

/// <summary>
/// Écriture UBL 2.1 (lot 17) : mêmes modèles écrits en UBL et en CII, relus égaux ; XSD UBL vérifié à l'écriture. Fichiers de
/// référence tests/exemples/ecrits/*_UBL.xml (mêmes cas que les CII écrits), contrôlés aux schematrons par
/// js/test/schematrons.test.js. Après un changement voulu de l'écriture : LOGIBTP_REGENERER_CII=1.
/// </summary>
public class EcritureUblTests
{
    private static string Serialiser(Facture f) => System.Text.Json.JsonSerializer.Serialize(f, EcritureCiiTests.Json);

    public static TheoryData<string> Exemples() => EcritureCiiTests.Exemples();

    /// <summary>Nom du fichier UBL écrit : celui du CII écrit, _CII remplacé par _UBL (jumeau lu par LectureUblTests.Paires).</summary>
    private static string NomUbl(string nomCii) => nomCii.Replace("_CII.xml", "_UBL.xml", StringComparison.Ordinal);

    private static string NomEcrit(string relatif) =>
        Path.GetFileName(relatif).Replace("_Commentee", "", StringComparison.Ordinal).Replace("_CII.xml", "_UBL.xml", StringComparison.Ordinal);

    private static void Comparer(string nom, byte[] xml)
    {
        var reference = LectureCiiTests.Dossier("ecrits", nom);
        if (Environment.GetEnvironmentVariable("LOGIBTP_REGENERER_CII") == "1")
        {
            Directory.CreateDirectory(Path.GetDirectoryName(reference)!);
            File.WriteAllBytes(reference, xml);
        }
        Assert.True(File.Exists(reference), $"référence absente : {reference} (LOGIBTP_REGENERER_CII=1)");
        Assert.Equal(File.ReadAllText(reference), System.Text.Encoding.UTF8.GetString(xml));
    }

    /// <summary>Modèle lu d'un CII d'exemple, écrit en UBL : relu au même modèle que le CII écrit puis relu.</summary>
    [Theory]
    [MemberData(nameof(Exemples))]
    public void Ecrit_en_UBL_et_en_CII_puis_relu_egal(string relatif)
    {
        var lu = LectureCiiTests.Lire(relatif);
        var ubl = EcritureUbl.Ecrire(lu);
        var relu = LectureUbl.Lire(ubl);
        var releuCii = LectureCii.Lire(EcritureCii.Ecrire(lu));
        Assert.Equal(Serialiser(releuCii with { Specification = relu.Specification }), Serialiser(relu));
        if (!ReglesCompletude.CadresNonEmis.Contains(lu.CadreFacturation)) Comparer(NomEcrit(relatif), ubl);
    }

    [Theory]
    [MemberData(nameof(EcritureCiiTests.CasDuJeu), MemberType = typeof(EcritureCiiTests))]
    public void Cas_du_jeu_ecrits_en_UBL_et_relus(string cas, string nomCii)
    {
        var c = ReglesCompletudeTests.Jeu["cas"]!.AsArray().First(x => x!["nom"]!.GetValue<string>() == cas)!;
        var f = ReglesCompletudeTests.Facture(c["modifications"]?.AsObject());
        var xml = EcritureUbl.Ecrire(f);
        var relu = LectureUbl.Lire(xml);
        Assert.Equal(Serialiser(f with { Specification = relu.Specification }), Serialiser(relu));
        Comparer(NomUbl(nomCii), xml);
    }

    [Fact]
    public void Avoir_ecrit_en_CreditNote_et_facture_en_Invoice()
    {
        var f = ReglesCompletudeTests.Facture(null);
        Assert.Equal(LectureUbl.EspaceFacture + "Invoice", EcritureUbl.Document(f).Root!.Name);
        var avoir = EcritureUbl.Document(f with { TypeFacture = TypeFacture.Avoir });
        Assert.Equal(LectureUbl.EspaceAvoir + "CreditNote", avoir.Root!.Name);
    }

    [Fact]
    public void Donnees_EXTENDED_refusees_en_EN16931()
    {
        var f = ReglesCompletudeTests.Facture(null) with { Payeur = new Partie { RaisonSociale = "COMMUNE", Siren = "400000006" } };
        var e = Assert.Throws<ExceptionLectureFacture>(() => EcritureUbl.Ecrire(f));
        Assert.Equal(ErreurFe.DonneeHorsProfil, e.Code);
    }

    [Fact]
    public void Profil_BASIC_non_ecrit()
    {
        var f = ReglesCompletudeTests.Facture(null) with { Profil = ProfilFacture.Basic };
        Assert.Equal(ErreurFe.ProfilNonEcrit, Assert.Throws<ExceptionLectureFacture>(() => EcritureUbl.Ecrire(f)).Code);
    }

    [Fact]
    public void Conversions_UBL_notes_et_exigibilite()
    {
        var f = ReglesCompletudeTests.Facture(null) with { CodeExigibiliteTva = CodeExigibiliteTva.DatePaiement };
        var xml = System.Text.Encoding.UTF8.GetString(EcritureUbl.Ecrire(f));
        Assert.Contains("<cbc:DescriptionCode>432</cbc:DescriptionCode>", xml);
        Assert.Contains("<cbc:Note>#PMT#", xml);
    }
}
