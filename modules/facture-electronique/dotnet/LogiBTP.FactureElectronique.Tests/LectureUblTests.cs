using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Xml.Linq;
using LogiBTP.FactureElectronique.Formats;
using Xunit;

namespace LogiBTP.FactureElectronique.Tests;

/// <summary>
/// Lecture UBL 2.1 (Invoice, CreditNote) : exemples FNFE 1.4.0.04 (tests/exemples/ubl) et cas LogiBTP, XSD, égalité du
/// modèle lu en CII et en UBL pour les mêmes cas, détection de la syntaxe, erreurs.
/// </summary>
public class LectureUblTests
{
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    private static string Dossier(string relatif) => LectureCiiTests.Dossier(relatif);

    private static Facture Lire(string relatif) => LectureUbl.Lire(File.ReadAllBytes(Dossier(relatif)));

    /// <summary>Tous les XML UBL d'exemple (chemins relatifs à tests/exemples).</summary>
    public static TheoryData<string> Exemples() => new(LectureCiiTests.Fichiers(ubl: true));

    /// <summary>
    /// Paires UBL ↔ CII d'un même cas : exemples FNFE (ubl/&lt;profil&gt;/X_UBL_Commentee.xml ↔ cii/&lt;profil&gt;/X_[FX_]CII_Commentee.xml)
    /// et cas LogiBTP (logibtp/X_UBL.xml ↔ logibtp/X_CII.xml).
    /// </summary>
    public static TheoryData<string, string> Paires()
    {
        var donnees = new TheoryData<string, string>();
        foreach (var ubl in LectureCiiTests.Fichiers(ubl: true))
        {
            var cii = ubl.StartsWith("ubl/", StringComparison.Ordinal)
                ? "cii/" + ubl["ubl/".Length..].Replace("_EN16931_UBL_", "_EN16931_FX_CII_").Replace("_EXTENDED-CTC-FR_UBL_", "_EXTENDED-CTC-FR_CII_")
                : ubl.Replace("_UBL", "_CII");
            donnees.Add(ubl, cii);
        }
        return donnees;
    }

    /// <summary>Modèle sérialisé (listes et tableaux d'octets comparés par valeur).</summary>
    private static string Serialiser(Facture f) => JsonSerializer.Serialize(f, Json);

    [Fact]
    public void Chaque_cas_FNFE_UBL_a_son_jumeau_CII()
    {
        var paires = Paires();
        Assert.Equal(13, paires.Count(p => ((string)p[0]).StartsWith("ubl/", StringComparison.Ordinal)));
        foreach (var p in paires) Assert.True(File.Exists(Dossier((string)p[1])), $"jumeau CII absent : {p[1]}");
    }

    [Theory]
    [MemberData(nameof(Paires))]
    public void Meme_modele_en_CII_et_en_UBL(string ubl, string cii)
    {
        var ecarts = Ecarts(Serialiser(LectureCiiTests.Lire(cii)), Serialiser(Lire(ubl)));
        Assert.True(ecarts.Count == 0, $"Écarts CII → UBL :\n{string.Join("\n", ecarts)}");
    }

    /// <summary>Lignes différentes de deux sérialisations (avec le chemin JSON approché), au plus 40.</summary>
    private static List<string> Ecarts(string attendu, string obtenu)
    {
        var a = attendu.Split('\n');
        var b = obtenu.Split('\n');
        var ecarts = new List<string>();
        for (var i = 0; i < Math.Max(a.Length, b.Length) && ecarts.Count < 40; i++)
        {
            var x = i < a.Length ? a[i].Trim() : "∅";
            var y = i < b.Length ? b[i].Trim() : "∅";
            if (x != y) ecarts.Add($"ligne {i + 1} : CII {x}  |  UBL {y}");
        }
        return ecarts;
    }

    [Theory]
    [MemberData(nameof(Exemples))]
    public void UBL_conforme_au_XSD(string relatif)
    {
        var document = LectureCii.Charger(File.ReadAllBytes(Dossier(relatif)));
        var jeu = document.Root!.Name == LectureUbl.EspaceAvoir + "CreditNote" ? JeuXsd.UblCreditNote : JeuXsd.UblInvoice;
        Assert.Empty(ValidationXsd.Valider(document, jeu));
    }

    // ---------------------------------------------------------------- termes propres à l'UBL

    [Fact]
    public void Facture_UBL_UC1_terme_a_terme()
    {
        var f = Lire("ubl/en16931/UC1_F202500003_00-INV_20250701_EN16931_UBL_Commentee.xml");
        Assert.Equal(("F202500003", TypeFacture.Facture, CadreFacturation.S1, ProfilFacture.En16931), (f.Numero, f.TypeFacture, f.CadreFacturation, f.Profil));
        Assert.Equal(new DateOnly(2025, 7, 31), f.DateEcheance);
        // BT-8 : 432 (UNTDID 2005) lu comme 72 (UNTDID 2475), convention du modèle.
        Assert.Equal(CodeExigibiliteTva.DatePaiement, f.CodeExigibiliteTva);
        // BT-21 : préfixe « #CODE# » de la note.
        Assert.Contains(new NoteFacture(CodeNote.IndemniteRecouvrement, "Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 €."), f.Notes);
        Assert.Equal(("LE VENDEUR", "VENDEUR NOM COMMERCIAL", "100000009", "FR88100000009"),
            (f.Vendeur.RaisonSociale, f.Vendeur.NomCommercial, f.Vendeur.Siren, f.Vendeur.NumeroTva));
        Assert.Equal(new Identifiant("100000009_STATUTS", SchemaIdentifiant.AdresseElectronique), f.Vendeur.AdresseElectronique);
        Assert.Equal("REF_CLIENT2514", f.References.Objet);
        var paiement = Assert.Single(f.MoyensPaiement);
        Assert.Equal(("30", "F202500003_200000008", "BIC_MONCOMPTE"), (paiement.Code, paiement.Reference, paiement.Bic));
        Assert.All(f.Lignes, l => Assert.Null(l.Rabais));
        Assert.Equal(40.0000m, f.Lignes[0].PrixBrut);
        Assert.Equal((10000.00m, 2000.00m, 12000.00m), (f.Totaux.TotalHt, f.Totaux.TotalTva!.Value, f.Totaux.NetAPayer));
    }

    [Fact]
    public void Sous_lignes_UBL_UC12_lues_dans_le_BillingReference_de_ligne()
    {
        var f = Lire("ubl/extended-ctc-fr/UC12_F202600025_SOUS-LIGNE_EXTENDED-CTC-FR_UBL_Commentee.xml");
        Assert.Equal(ProfilFacture.ExtendedCtcFr, f.Profil);
        Assert.Equal((SousTypeLigne.Groupe, (string?)null), (f.Lignes[0].SousType, f.Lignes[0].LigneParente));
        Assert.All(f.Lignes.Where(l => l.SousType == SousTypeLigne.Detail), l => Assert.Equal("1", l.LigneParente));
        Assert.All(f.Lignes, l => Assert.Null(l.FactureAnterieure));
        Assert.Equal(0m, Assert.Single(f.Lignes, l => l.SousType == SousTypeLigne.Information).PrixNet);
    }

    [Fact]
    public void Avoir_CreditNote_LogiBTP()
    {
        var f = Lire("logibtp/AVOIR_F202500011_EN16931_UBL.xml");
        Assert.Equal(("F202500011", TypeFacture.Avoir), (f.Numero, f.TypeFacture));
        Assert.Equal(new FactureAnterieure("F202500003", new DateOnly(2025, 7, 1)), Assert.Single(f.FacturesAnterieures));
        // BT-11 en AdditionalDocumentReference de type 50 ; BT-9 en PaymentMeans/PaymentDueDate.
        Assert.Equal("CH-2025-007", f.References.Projet);
        Assert.Equal(new DateOnly(2025, 7, 31), f.DateEcheance);
        Assert.Empty(f.PiecesJointes);
        Assert.Equal([200.0000m, 5.0000m], f.Lignes.Select(l => l.Quantite));
    }

    [Fact]
    public void Cas_LogiBTP_S5_UBL_payeur_agent_piece_jointe_et_anterieure_en_ligne()
    {
        var f = Lire("logibtp/S5_PAYEUR_EXTENDED-CTC-FR_UBL.xml");
        Assert.Equal(CadreFacturation.S5, f.CadreFacturation);
        Assert.Equal(("COMMUNE DE MAVILLE", "400000006", "MA VILLE"), (f.Payeur!.RaisonSociale, f.Payeur.Siren, f.Payeur.Adresse?.Localite));
        Assert.Equal(("MAITRE D OEUVRE", "300000007"), (f.AgentAcheteur!.RaisonSociale, f.AgentAcheteur.Siren));
        var pj = Assert.Single(f.PiecesJointes);
        Assert.Equal(("SITUATION-03", "RELEVE", "releve.txt"), (pj.Reference, pj.Description, pj.NomFichier));
        Assert.Equal("Relevé de travaux", Encoding.UTF8.GetString(pj.Contenu!));
        Assert.Equal(new FactureAnterieureLigne("F202600010", TypeFacture.Acompte, new DateOnly(2026, 4, 15), "1"), f.Lignes[0].FactureAnterieure);
        Assert.Null(f.Lignes[0].SousType);
    }

    // ---------------------------------------------------------------- détection de la syntaxe

    [Theory]
    [InlineData("cii/en16931/UC1_F202500003_00-INV_20250701_EN16931_FX_CII_Commentee.xml", Syntaxe.Cii)]
    [InlineData("ubl/en16931/UC1_F202500003_00-INV_20250701_EN16931_UBL_Commentee.xml", Syntaxe.Ubl)]
    [InlineData("logibtp/AVOIR_F202500011_EN16931_UBL.xml", Syntaxe.Ubl)]
    [InlineData("factur-x/en16931/UC1_F202500003_00-INV_20250701_EN16931_FX.pdf", Syntaxe.FacturX)]
    public void Syntaxe_detectee_et_facture_lue(string relatif, string syntaxe)
    {
        var contenu = File.ReadAllBytes(Dossier(relatif));
        Assert.Equal(syntaxe, Lecture.Detecter(contenu));
        var lue = Lecture.Lire(contenu);
        Assert.Equal(syntaxe, lue.Syntaxe);
        Assert.Equal(relatif.Contains("AVOIR", StringComparison.Ordinal) ? "F202500011" : "F202500003", lue.Facture.Numero);
    }

    [Fact]
    public void Syntaxe_inconnue_ou_XML_illisible()
    {
        static string Code(string contenu) => Assert.Throws<ExceptionLectureFacture>(() => Lecture.Lire(Encoding.UTF8.GetBytes(contenu))).Code;
        Assert.Equal(ErreurFe.SyntaxeInconnue, Code("<Order xmlns=\"urn:oasis:names:specification:ubl:schema:xsd:Order-2\"/>"));
        Assert.Equal(ErreurFe.SyntaxeInconnue, Code("<Invoice/>"));
        Assert.Equal(ErreurFe.XmlIllisible, Code("<Invoice"));
        Assert.Equal(ErreurFe.XmlIllisible, Code("ni XML ni PDF"));
        // Une racine CII donnée au lecteur UBL (et l'inverse, LectureCiiTests) : SYNTAXE_INCONNUE.
        var cii = File.ReadAllBytes(Dossier("cii/en16931/UC1_F202500003_00-INV_20250701_EN16931_FX_CII_Commentee.xml"));
        Assert.Equal(ErreurFe.SyntaxeInconnue, Assert.Throws<ExceptionLectureFacture>(() => LectureUbl.Lire(cii)).Code);
    }

    // ---------------------------------------------------------------- erreurs

    private static string Uc1() => File.ReadAllText(Dossier("ubl/en16931/UC1_F202500003_00-INV_20250701_EN16931_UBL_Commentee.xml"));

    private static string CodeErreur(string xml, bool validerXsd = true) =>
        Assert.Throws<ExceptionLectureFacture>(() => LectureUbl.Lire(Encoding.UTF8.GetBytes(xml), validerXsd)).Code;

    [Fact]
    public void Profil_UBL_non_reconnu()
    {
        Assert.Equal(ErreurFe.ProfilInconnu, CodeErreur(Uc1().Replace(">urn:cen.eu:en16931:2017<", $">{SpecificationFacture.BasicWl}<")));
        Assert.Equal(ErreurFe.ProfilInconnu, CodeErreur(Uc1().Replace(">urn:cen.eu:en16931:2017<", $">{SpecificationFacture.Basic}<")));
        Assert.Equal(ProfilFacture.En16931, LectureUbl.Profil(SpecificationFacture.En16931 + "#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0"));
    }

    [Fact]
    public void XSD_UBL_non_respecte()
    {
        var e = Assert.Throws<ExceptionLectureFacture>(() => LectureUbl.Lire(Encoding.UTF8.GetBytes(Uc1().Replace("<cbc:BuyerReference>", "<cbc:Inconnu>x</cbc:Inconnu><cbc:BuyerReference>"))));
        Assert.Equal(ErreurFe.XsdInvalide, e.Code);
        Assert.Contains(e.Details, d => d.Contains("Inconnu", StringComparison.Ordinal));
    }

    [Fact]
    public void Terme_UBL_obligatoire_absent_ou_illisible()
    {
        var sansNumero = XDocument.Parse(Uc1());
        sansNumero.Root!.Element(LectureUbl.Cbc + "ID")!.Remove();
        Assert.Equal(ErreurFe.DonneeInvalide, CodeErreur(sansNumero.ToString(), validerXsd: false));
        Assert.Equal(ErreurFe.DonneeInvalide, CodeErreur(Uc1().Replace("<cbc:IssueDate>2025-07-01", "<cbc:IssueDate>01/07/2025"), validerXsd: false));
        Assert.Equal(ErreurFe.DonneeInvalide, CodeErreur(Uc1().Replace(">12000.00</cbc:PayableAmount>", ">12 000,00</cbc:PayableAmount>"), validerXsd: false));
        Assert.Equal(ErreurFe.DonneeInvalide, CodeErreur(AvecCharge(Uc1(), "non"), validerXsd: false));
    }

    /// <summary>UC1 avec une charge de document (BG-21) avant le TaxTotal.</summary>
    private static string AvecCharge(string xml, string indicateur) => xml.Replace("<cac:TaxTotal>", $"""
        <cac:AllowanceCharge>
          <cbc:ChargeIndicator>{indicateur}</cbc:ChargeIndicator>
          <cbc:AllowanceChargeReasonCode>FC</cbc:AllowanceChargeReasonCode>
          <cbc:AllowanceChargeReason>Transport</cbc:AllowanceChargeReason>
          <cbc:MultiplierFactorNumeric>1.5</cbc:MultiplierFactorNumeric>
          <cbc:Amount currencyID="EUR">150.00</cbc:Amount>
          <cbc:BaseAmount currencyID="EUR">10000.00</cbc:BaseAmount>
          <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>20.00</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>
        </cac:AllowanceCharge>
        <cac:TaxTotal>
        """);

    [Fact]
    public void Charge_de_document_BG_21()
    {
        var f = LectureUbl.Lire(Encoding.UTF8.GetBytes(AvecCharge(Uc1(), "true")));
        Assert.Equal(new RemiseCharge
        {
            Charge = true, Montant = 150.00m, Assiette = 10000.00m, Pourcentage = 1.5m, CategorieTva = CategorieTva.Normale, TauxTva = 20.00m,
            Motif = "Transport", CodeMotif = "FC",
        }, Assert.Single(f.RemisesCharges));
    }
}
