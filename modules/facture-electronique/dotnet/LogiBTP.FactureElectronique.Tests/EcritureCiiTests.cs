using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using LogiBTP.FactureElectronique.Formats;
using Xunit;

namespace LogiBTP.FactureElectronique.Tests;

/// <summary>
/// Écriture CII D22B (lot 16) : chaque exemple CII lu (FNFE EN16931 et EXTENDED-CTC-FR, cas LogiBTP) est écrit puis relu à
/// l'identique du modèle ; XSD D22B vérifié à l'écriture. Fichiers de référence tests/exemples/ecrits/ (exemples hors
/// multi-vendeurs et bidirectionnels, facture de base et cas S5 du jeu 05_completude.json), contrôlés aux schematrons
/// EN16931 / EXTENDED-CTC-FR et BR-FR-Flux2 par js/test/schematrons.test.js. Après un changement voulu de l'écriture :
/// LOGIBTP_REGENERER_CII=1.
/// </summary>
public class EcritureCiiTests
{
    /// <summary>Décimaux comparés sans zéro de fin (le CII écrit « 100.00 », un prix « 0.107 »).</summary>
    internal sealed class DecimalNormalise : JsonConverter<decimal>
    {
        public override decimal Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) => reader.GetDecimal();
        public override void Write(Utf8JsonWriter writer, decimal value, JsonSerializerOptions options) =>
            writer.WriteRawValue(EcritureCii.Nombre(value));
    }

    internal static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping, Converters = { new DecimalNormalise() },
    };

    private static string Serialiser(Facture f) => JsonSerializer.Serialize(f, Json);

    /// <summary>Exemples CII seuls (hors Factur-X, dont le BT-24 n'est pas écrit) : chemins relatifs à tests/exemples.</summary>
    public static TheoryData<string> Exemples() => new(LectureCiiTests.Fichiers(ubl: false)
        .Where(r => r.StartsWith("cii/", StringComparison.Ordinal) || r.StartsWith("logibtp/", StringComparison.Ordinal)));

    private static string NomEcrit(string relatif) => Path.GetFileName(relatif).Replace("_Commentee", "", StringComparison.Ordinal);

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

    [Theory]
    [MemberData(nameof(Exemples))]
    public void Ecrit_puis_relu_au_meme_modele(string relatif)
    {
        var lu = LectureCiiTests.Lire(relatif);
        var xml = EcritureCii.Ecrire(lu);
        var relu = LectureCii.Lire(xml);
        Assert.Equal(Serialiser(lu), Serialiser(relu));
        if (!ReglesCompletude.CadresNonEmis.Contains(lu.CadreFacturation)) Comparer(NomEcrit(relatif), xml);
    }

    [Theory]
    [MemberData(nameof(Exemples))]
    public void Exemples_complets_sauf_multi_vendeurs(string relatif)
    {
        var f = LectureCiiTests.Lire(relatif);
        var bloquants = ReglesCompletude.Controler(f).Where(e => e.Niveau == NiveauCompletude.Bloquant).ToList();
        if (ReglesCompletude.CadresNonEmis.Contains(f.CadreFacturation)) Assert.Contains(bloquants, e => e.Regle == RegleCompletude.Cadre);
        else Assert.True(bloquants.Count == 0, string.Join("\n", bloquants));
    }

    public static TheoryData<string, string> CasDuJeu() => new()
    {
        { "facture de base conforme", "LOGIBTP_F202611001_EN16931_CII.xml" },
        { "sous-traitance S5 en EXTENDED-CTC-FR, payeur et autoliquidation", "LOGIBTP_F202611001_S5_EXTENDED-CTC-FR_CII.xml" },
        { "remise et charge de document cohérentes", "LOGIBTP_F202611001_REMISE_EN16931_CII.xml" },
        { "avoir EXTENDED : facture antérieure sur chaque ligne de détail", "LOGIBTP_F202611001_AVOIR_EXTENDED-CTC-FR_CII.xml" },
        { "EXTENDED : sommes sur les lignes de détail, ligne de groupe et d'information", "LOGIBTP_F202611001_SOUS-LIGNES_EXTENDED-CTC-FR_CII.xml" },
    };

    [Theory]
    [MemberData(nameof(CasDuJeu))]
    public void Cas_du_jeu_complets_ecrits_et_relus(string cas, string nom)
    {
        var c = ReglesCompletudeTests.Jeu["cas"]!.AsArray().First(x => x!["nom"]!.GetValue<string>() == cas)!;
        var f = ReglesCompletudeTests.Facture(c["modifications"]?.AsObject());
        Assert.Empty(ReglesCompletude.Controler(f));
        var xml = EcritureCii.Ecrire(f);
        var relu = LectureCii.Lire(xml);
        Assert.Equal(Serialiser(f with { Specification = relu.Specification }), Serialiser(relu));
        Comparer(nom, xml);
    }

    [Fact]
    public void Donnees_EXTENDED_refusees_en_EN16931()
    {
        var f = ReglesCompletudeTests.Facture(null) with { Payeur = new Partie { RaisonSociale = "COMMUNE", Siren = "400000006" } };
        var e = Assert.Throws<ExceptionLectureFacture>(() => EcritureCii.Ecrire(f));
        Assert.Equal(ErreurFe.DonneeHorsProfil, e.Code);
        Assert.Equal(["EXT-FR-FE-BG-02"], e.Details);
    }

    [Fact]
    public void Profil_BASIC_non_ecrit()
    {
        var f = ReglesCompletudeTests.Facture(null) with { Profil = ProfilFacture.Basic };
        Assert.Equal(ErreurFe.ProfilNonEcrit, Assert.Throws<ExceptionLectureFacture>(() => EcritureCii.Ecrire(f)).Code);
    }

    [Theory]
    [InlineData("100", "100.00", "100")]
    [InlineData("0.5", "0.50", "0.5")]
    [InlineData("-12.30", "-12.30", "-12.3")]
    [InlineData("0.1070", "0.107", "0.107")]
    [InlineData("20.000", "20.00", "20")]
    public void Nombres_ecrits_sans_arrondi(string valeur, string montant, string nombre)
    {
        var d = decimal.Parse(valeur, CultureInfo.InvariantCulture);
        Assert.Equal(montant, EcritureCii.Montant(d));
        Assert.Equal(nombre, EcritureCii.Nombre(d));
    }

    [Fact]
    public void Notes_obligatoires_et_SIREN_au_schema_0002()
    {
        var xml = System.Text.Encoding.UTF8.GetString(EcritureCii.Ecrire(ReglesCompletudeTests.Facture(null)));
        Assert.Contains("<ram:ID schemeID=\"0002\">200000008</ram:ID>", xml);
        Assert.Contains("<ram:SubjectCode>PMT</ram:SubjectCode>", xml);
        Assert.Contains("<ram:URIID schemeID=\"0225\">100000009_FACTURES</ram:URIID>", xml);
        Assert.StartsWith("<?xml version=\"1.0\" encoding=\"utf-8\"?>", xml);
    }
}
