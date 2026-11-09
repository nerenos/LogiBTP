using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using LogiBTP.FactureElectronique.Formats;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.FactureElectronique.Tests;

/// <summary>Lecture CII D22B et XML Factur-X : exemples FNFE 1.4.0.04 (tests/exemples) et cas LogiBTP, XSD, erreurs.</summary>
public partial class LectureCiiTests
{
    internal static string Dossier(params string[] parties) => CasPartages.Chemin(["modules", "facture-electronique", "tests", "exemples", .. parties]);

    /// <summary>Tous les XML d'exemple : chemin relatif à tests/exemples et Factur-X ou non (dossier factur-x/).</summary>
    public static TheoryData<string> Exemples()
    {
        var racine = Dossier();
        var donnees = new TheoryData<string>();
        foreach (var f in Directory.GetFiles(racine, "*.xml", SearchOption.AllDirectories).Order(StringComparer.Ordinal))
            donnees.Add(Path.GetRelativePath(racine, f).Replace('\\', '/'));
        return donnees;
    }

    internal static Facture Lire(string relatif) =>
        LectureCii.Lire(File.ReadAllBytes(Dossier(relatif)), facturX: relatif.StartsWith("factur-x/", StringComparison.Ordinal));

    [GeneratedRegex(@"(AUTO)?F\d{8,9}")]
    private static partial Regex RegexNumero();

    [Theory]
    [MemberData(nameof(Exemples))]
    public void Chaque_exemple_est_lu_et_coherent(string relatif)
    {
        var f = Lire(relatif);

        var numero = RegexNumero().Match(Path.GetFileName(relatif));
        Assert.Equal(numero.Success ? numero.Value : "F202600037", f.Numero);
        Assert.Contains(f.TypeFacture, (IEnumerable<string>)typeof(TypeFacture).GetFields().Select(c => (string)c.GetValue(null)!));
        Assert.Contains(f.CadreFacturation, (IEnumerable<string>)typeof(CadreFacturation).GetFields().Select(c => (string)c.GetValue(null)!));
        Assert.True(f.DateEmission.Year >= 2025);
        Assert.NotNull(f.Specification);
        foreach (var p in new[] { f.Vendeur, f.Acheteur })
        {
            Assert.False(string.IsNullOrEmpty(p.RaisonSociale));
            Assert.Matches(@"^\d{9}$", p.Siren);
            // BT-34, BT-49 : schéma 0225 (BR-FR-12/13) ; EM (courriel) dans les exemples BASIC WL.
            Assert.NotNull(p.AdresseElectronique?.Schema);
        }
        Assert.NotEmpty(f.Notes);
        Assert.NotEmpty(f.DetailsTva);

        // Totaux (BR-CO-10 à BR-CO-16) : la lecture rend les montants exacts du fichier.
        var t = f.Totaux;
        Assert.Equal(t.TotalTtc, t.TotalHt + (t.TotalTva ?? 0));
        Assert.Equal(t.NetAPayer, t.TotalTtc - (t.DejaPaye ?? 0) + (t.Arrondi ?? 0));
        Assert.Equal(t.TotalTva ?? 0, f.DetailsTva.Sum(d => d.Montant));
        Assert.Equal(t.TotalHt, f.DetailsTva.Sum(d => d.Base));
        if (f.Lignes.Count > 0)
            Assert.Equal(t.TotalLignes, f.Lignes.Where(l => l.SousType is not SousTypeLigne.Detail).Sum(l => l.MontantNet));
    }

    [Fact]
    public void Facture_EN16931_UC1_terme_a_terme()
    {
        var f = Lire("cii/en16931/UC1_F202500003_00-INV_20250701_EN16931_FX_CII_Commentee.xml");

        Assert.Equal("F202500003", f.Numero);
        Assert.Equal(new DateOnly(2025, 7, 1), f.DateEmission);
        Assert.Equal(TypeFacture.Facture, f.TypeFacture);
        Assert.Equal(CadreFacturation.S1, f.CadreFacturation);
        Assert.Equal(ProfilFacture.En16931, f.Profil);
        Assert.Equal(SpecificationFacture.En16931, f.Specification);
        Assert.Equal("EUR", f.Devise);
        Assert.Equal("BU_2516", f.References.Acheteur);
        Assert.Equal("REF COMPTABLE ACHETEUR", f.References.Comptable);
        Assert.Equal(new DateOnly(2025, 7, 31), f.DateEcheance);
        Assert.Equal(new Periode(new DateOnly(2025, 6, 1), new DateOnly(2025, 6, 30)), f.Periode);
        Assert.Contains(f.Notes, n => n.CodeSujet == CodeNote.IndemniteRecouvrement);

        Assert.Equal("LE VENDEUR", f.Vendeur.RaisonSociale);
        Assert.Equal("100000009", f.Vendeur.Siren);
        Assert.Equal("FR88100000009", f.Vendeur.NumeroTva);
        Assert.Equal(new Identifiant("100000009_STATUTS", SchemaIdentifiant.AdresseElectronique), f.Vendeur.AdresseElectronique);
        Assert.Equal("contact@vendeur.fr", f.Vendeur.Contact?.Courriel);
        Assert.Equal("PARIS", f.Vendeur.Adresse?.Localite);
        Assert.Equal("200000008", f.Acheteur.Siren);
        Assert.Equal(new Identifiant("200000008", SchemaIdentifiant.AdresseElectronique), f.Acheteur.AdresseElectronique);
        Assert.Equal("NOUS AUSSI", f.Livraison?.Nom);

        var paiement = Assert.Single(f.MoyensPaiement);
        Assert.Equal("30", paiement.Code);
        Assert.Equal("FR20 1254 2547 2569 8542 5874 698", paiement.Iban);

        Assert.Equal(2, f.Lignes.Count);
        Assert.Equal("1", f.Lignes[0].Identifiant);
        Assert.Equal("SERVICE_FOURNI1", f.Lignes[0].Nom);
        Assert.Equal(8000.00m, f.Lignes[0].MontantNet);
        Assert.Equal(CategorieTva.Normale, f.Lignes[0].CategorieTva);
        Assert.Equal(20.00m, f.Lignes[0].TauxTva);

        var tva = Assert.Single(f.DetailsTva);
        Assert.Equal((10000.00m, 2000.00m, CategorieTva.Normale, 20.00m), (tva.Base, tva.Montant, tva.Categorie, tva.Taux!.Value));
        Assert.Equal((10000.00m, 2000.00m, 12000.00m, 12000.00m), (f.Totaux.TotalHt, f.Totaux.TotalTva!.Value, f.Totaux.TotalTtc, f.Totaux.NetAPayer));
    }

    [Fact]
    public void Rectificative_UC4b_porte_la_facture_anterieure()
    {
        var f = Lire("cii/en16931/UC4b_F202500010_00-INVCORR_20250702_EN16931_FX_CII_Commentee.xml");
        Assert.Equal(TypeFacture.Rectificative, f.TypeFacture);
        Assert.Equal(new FactureAnterieure("F20250006", new DateOnly(2025, 7, 1)), Assert.Single(f.FacturesAnterieures));
        Assert.Equal("PO202525478", f.References.Commande);
        Assert.Equal("SO20255874", f.References.CommandeVendeur);
        Assert.Equal("BIC_MONCOMPTE", Assert.Single(f.MoyensPaiement).Bic);
    }

    [Fact]
    public void Sous_lignes_UC12_EXTENDED_CTC_FR()
    {
        var f = Lire("cii/extended-ctc-fr/UC12_F202600025_SOUS-LIGNE_EXTENDED-CTC-FR_CII_Commentee.xml");
        Assert.Equal(ProfilFacture.ExtendedCtcFr, f.Profil);
        Assert.Equal(SpecificationFacture.ExtendedCtcFr, f.Specification);
        Assert.Equal(SousTypeLigne.Groupe, f.Lignes[0].SousType);
        Assert.Equal(25.0000m, f.Lignes[0].PrixNet);
        Assert.Null(f.Lignes[0].CategorieTva);
        Assert.All(f.Lignes.Where(l => l.SousType == SousTypeLigne.Detail), l => Assert.Equal("1", l.LigneParente));
        var information = Assert.Single(f.Lignes, l => l.SousType == SousTypeLigne.Information);
        Assert.Equal(0m, information.PrixNet);
        Assert.Equal(0.00m, information.MontantNet);
    }

    [Fact]
    public void Autofacture_bidirectionnelle_UC13_montants_negatifs_et_exoneration()
    {
        var f = Lire("cii/extended-ctc-fr/UC13_AUTOF202600035_BIDIRECTIONNELLE_EXTENDED-CTC-FR_CII_Commentee.xml");
        Assert.Equal(TypeFacture.Autofacture, f.TypeFacture);
        Assert.Equal(CadreFacturation.B9, f.CadreFacturation);
        Assert.Equal("5", f.CodeExigibiliteTva);
        Assert.Contains(f.Lignes, l => l.MontantNet == -4.69m && l.CategorieTva == CategorieTva.Exoneree);
        Assert.Equal(3, f.DetailsTva.Count);
        Assert.Contains(f.DetailsTva, d => d.Base == -199.43m && d.Montant == -39.89m);
        Assert.Equal(21220.81m, f.Totaux.TotalLignes);
        Assert.Equal(1138.52m, f.Totaux.TotalTva);
    }

    [Fact]
    public void Basic_WL_sans_lignes()
    {
        var f = Lire("factur-x/basicwl/Facture_F20260023-LE_FOURNISSEUR-POUR-LE_CLIENT_BASICWL_FX_CII_Commentee.xml");
        Assert.Equal(ProfilFacture.Basic, f.Profil);
        Assert.Equal(SpecificationFacture.BasicWl, f.Specification);
        Assert.Empty(f.Lignes);
    }

    [Fact]
    public void Cas_LogiBTP_S5_payeur_agent_projet_piece_jointe_et_anterieure_en_ligne()
    {
        var f = Lire("logibtp/S5_PAYEUR_EXTENDED-CTC-FR_CII.xml");
        Assert.Equal(CadreFacturation.S5, f.CadreFacturation);

        var payeur = f.Payeur!;
        Assert.Equal("COMMUNE DE MAVILLE", payeur.RaisonSociale);
        Assert.Equal("400000006", payeur.Siren);
        Assert.Equal(new Identifiant("400000006", SchemaIdentifiant.AdresseElectronique), payeur.AdresseElectronique);
        Assert.Equal("MA VILLE", payeur.Adresse?.Localite);
        Assert.Equal("300000007", f.AgentAcheteur?.Siren);
        Assert.Equal("MAITRE D OEUVRE", f.AgentAcheteur?.RaisonSociale);
        Assert.Equal("CH-2026-001", f.References.Projet);
        Assert.Equal("MARCHE-2026-014", f.References.Contrat);

        var pj = Assert.Single(f.PiecesJointes);
        Assert.Equal(("SITUATION-03", "RELEVE", "text/plain", "releve.txt"), (pj.Reference, pj.Description, pj.TypeMime, pj.NomFichier));
        Assert.Equal("Relevé de travaux", Encoding.UTF8.GetString(pj.Contenu!));

        Assert.Equal(new FactureAnterieure("F202600010", new DateOnly(2026, 4, 15), TypeFacture.Acompte), Assert.Single(f.FacturesAnterieures));
        Assert.Equal(new FactureAnterieureLigne("F202600010", TypeFacture.Acompte, new DateOnly(2026, 4, 15), "1"), f.Lignes[0].FactureAnterieure);
    }

    // ---------------------------------------------------------------- XSD

    [Theory]
    [MemberData(nameof(Exemples))]
    public void CII_seul_conforme_au_XSD_D22B(string relatif)
    {
        var document = LectureCii.Charger(File.ReadAllBytes(Dossier(relatif)));
        Assert.Empty(ValidationXsd.Valider(document, JeuXsd.CiiD22B));
    }

    [Fact]
    public void Factur_X_valide_par_le_XSD_de_son_profil()
    {
        static IReadOnlyList<string> Valider(string relatif, JeuXsd jeu) =>
            ValidationXsd.Valider(LectureCii.Charger(File.ReadAllBytes(Dossier(relatif))), jeu);

        Assert.Empty(Valider("factur-x/basicwl/Facture_F20260024-LE_FOURNISSEUR-POUR-LE_CLIENT_BASICWL_FX_CII_Commentee.xml", JeuXsd.FacturXBasicWl));
        Assert.Empty(Valider("cii/en16931/UC5_F202500007_00-INV_20250702_EN16931_FX_CII_Commentee.xml", JeuXsd.FacturXEn16931));
        Assert.Empty(Valider("factur-x/extended/UC10_F202600004_MULTI-VENDEUR_EXTENDED_FX_CII_Commentee.xml", JeuXsd.FacturXExtended));
        // Une facture EXTENDED n'est pas conforme au XSD EN16931 restreint.
        Assert.NotEmpty(Valider("factur-x/extended/UC12_F202600025_SOUS-LIGNE_EXTENDED_FX_CII_Commentee.xml", JeuXsd.FacturXEn16931));
    }

    // ---------------------------------------------------------------- erreurs

    private static string Uc1() => File.ReadAllText(Dossier("cii/en16931/UC1_F202500003_00-INV_20250701_EN16931_FX_CII_Commentee.xml"));

    private static string CodeErreur(string xml, bool validerXsd = true) =>
        Assert.Throws<ExceptionLectureFacture>(() => LectureCii.Lire(Encoding.UTF8.GetBytes(xml), validerXsd: validerXsd)).Code;

    [Fact]
    public void XML_mal_forme() => Assert.Equal(ErreurFe.XmlIllisible, CodeErreur(Uc1()[..^40]));

    [Fact]
    public void DTD_refusee() =>
        Assert.Equal(ErreurFe.XmlIllisible, CodeErreur("<?xml version=\"1.0\"?><!DOCTYPE x [<!ENTITY e SYSTEM \"file:///etc/passwd\">]><x>&e;</x>"));

    [Fact]
    public void Syntaxe_non_CII() =>
        Assert.Equal(ErreurFe.SyntaxeInconnue, CodeErreur("<Invoice xmlns=\"urn:oasis:names:specification:ubl:schema:xsd:Invoice-2\"/>"));

    [Fact]
    public void Profil_non_reconnu() =>
        Assert.Equal(ErreurFe.ProfilInconnu, CodeErreur(Uc1().Replace("<ram:ID>urn:cen.eu:en16931:2017</ram:ID>", $"<ram:ID>{SpecificationFacture.Minimum}</ram:ID>")));

    [Fact]
    public void XSD_non_respecte()
    {
        var xml = Uc1().Replace("<ram:BuyerReference>", "<ram:Inconnu>x</ram:Inconnu><ram:BuyerReference>");
        var e = Assert.Throws<ExceptionLectureFacture>(() => LectureCii.Lire(Encoding.UTF8.GetBytes(xml)));
        Assert.Equal(ErreurFe.XsdInvalide, e.Code);
        Assert.Contains(e.Details, d => d.Contains("Inconnu", StringComparison.Ordinal));
    }

    [Fact]
    public void Terme_obligatoire_absent_ou_illisible()
    {
        var sansNumero = XDocument.Parse(Uc1());
        sansNumero.Root!.Element(LectureCii.Rsm + "ExchangedDocument")!.Element(LectureCii.Ram + "ID")!.Remove();
        Assert.Equal(ErreurFe.DonneeInvalide, CodeErreur(sansNumero.ToString(), validerXsd: false));
        Assert.Equal(ErreurFe.DonneeInvalide, CodeErreur(Uc1().Replace("<ram:GrandTotalAmount>12000.00", "<ram:GrandTotalAmount>12 000,00"), validerXsd: false));
        Assert.Equal(ErreurFe.DonneeInvalide, CodeErreur(Uc1().Replace("format=\"102\">20250701", "format=\"102\">20251341"), validerXsd: false));
    }
}
