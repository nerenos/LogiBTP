using System.Text;
using System.Xml.Linq;
using LogiBTP.FactureElectronique.Formats;
using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.FactureElectronique.Tests;

/// <summary>
/// Écriture du flux 10 (lot 19) : transmissions B2C (10.3, 10.4, rectificative) et internationales (10.1, 10.2) écrites,
/// valides au XSD ereporting et sans écart au contrôle avant envoi ; fichiers de référence tests/ereporting/ (contrôlés
/// par le schematron Flux10 dans js/test/flux10.test.js), régénérés par LOGIBTP_REGENERER_FLUX10=1.
/// </summary>
public class EcritureFlux10Tests
{
    private static readonly PartieTransmission Declarant = new("200000008", SchemaIdentifiant.Siren, "BTP EXEMPLE", RoleCdar.Vendeur);
    private static readonly ContexteEnvoi Contexte = new(ReglesEreportingTests.Plateforme, Declarant, new DateTime(2026, 12, 1, 9, 30, 0), "LB");
    private static readonly PeriodeEreporting Decade = ReglesEreporting.Periode(new(2026, 11, 2), RegimeEreporting.ReelNormalMensuel, SousFluxEreporting.TransactionsAgregees);
    private static readonly PeriodeEreporting Mois = ReglesEreporting.Periode(new(2026, 11, 2), RegimeEreporting.ReelNormalMensuel, SousFluxEreporting.PaiementsAgreges);

    private static Facture Exemple() => Lecture.Lire(File.ReadAllBytes(CasPartages.Chemin("modules", "facture-electronique", "tests", "exemples", "ecrits", "LOGIBTP_F202611001_EN16931_CII.xml"))).Facture;

    private static readonly Partie AcheteurAllemand = new()
    {
        RaisonSociale = "KUNDE GMBH", NumeroTva = "DE123456789", Identifiants = [new Identifiant("DE123456789", SchemaIdentifiant.UeHorsFrance)],
        Adresse = new AdressePostale("Hauptstrasse 1", null, null, "BERLIN", "10115", null, "DE"),
    };

    /// <summary>Ventes B2C de la décade (rénovation chez des particuliers) et leurs encaissements.</summary>
    private static DonneesEreporting DonneesB2C() => new()
    {
        PeriodeTransactions = Decade, PeriodePaiements = Mois,
        Ventes =
        [
            new(new(2026, 11, 2), CategorieTransactions.Services, [new(10m, 4200m, 420m), new(5.5m, 1800m, 99m)]),
            new(new(2026, 11, 2), CategorieTransactions.Services, [new(10m, 650.40m, 65.04m)]),
            new(new(2026, 11, 2), CategorieTransactions.Biens, [new(20m, 320m, 64m)]),
            new(new(2026, 11, 6), CategorieTransactions.Services, [new(20m, 980m, 196m)], CodeExigibiliteTva: CodeExigibiliteTva.DateFacture),
            new(new(2026, 11, 9), CategorieTransactions.Services, [new(10m, -150m, -15m)]),
        ],
        EncaissementsB2C =
        [
            new(new(2026, 11, 3), [new(10m, 1500m), new(5.5m, 1899m)]),
            new(new(2026, 11, 20), [new(10m, 3120m)]),
            new(new(2026, 11, 20), [new(10m, 215.44m)]),
        ],
    };

    /// <summary>Factures B2B internationales de la décade (extraites du modèle EN16931) et leurs encaissements.</summary>
    private static DonneesEreporting DonneesInternationales()
    {
        var f = Exemple() with { Acheteur = AcheteurAllemand };
        var autoliquidee = ReglesEreportingTests.Internationale("F202611002", new(2026, 11, 4)) with
        {
            Vendeur = ReglesEreporting.Entreprise(f.Vendeur), Echeance = new(2026, 12, 4),
            Lignes = [new LigneEreporting { Quantite = 1m, Unite = "C62", PrixNet = 100m, Nom = "Étude de structure" }],
        };
        var export = new TransactionUnitaire
        {
            Numero = "F202611003", Date = new(2026, 11, 9), Type = TypeFacture.Facture, Cadre = CadreFacturation.B1,
            Vendeur = ReglesEreporting.Entreprise(f.Vendeur),
            Acheteur = new EntrepriseEreporting(new Identifiant("CHE123456789", SchemaIdentifiant.HorsUe), null, "CH"),
            Livraisons = [new LivraisonEreporting(new(2026, 11, 9), new AdressePostale("Rue du Lac 4", null, null, "GENEVE", "1201", null, "CH"))],
            TotalHt = 2500m, TotalTva = 0m,
            Ventilation = [new DetailTva { Base = 2500m, Montant = 0m, Categorie = CategorieTva.Exportation, Taux = 0m, MotifExoneration = "Exportation hors UE", CodeExoneration = "VATEX-EU-G" }],
        };
        var avoir = export with
        {
            Numero = "A202611001", Type = TypeFacture.Avoir, Date = new(2026, 11, 10), Livraisons = [],
            FacturesAnterieures = [new FactureAnterieure("F202611003", new(2026, 11, 9))], TotalHt = 250m,
            Ventilation = [export.Ventilation[0] with { Base = 250m }],
        };
        return new DonneesEreporting
        {
            PeriodeTransactions = Decade, PeriodePaiements = Mois,
            Factures = [ReglesEreporting.TransactionDe(f), autoliquidee, export, avoir],
            EncaissementsFactures =
            [
                new(new(2026, 11, 16), [new(20m, 1200m)], f.Numero, f.DateEmission),
                new(new(2026, 11, 30), [new(0m, 100m)], "F202611002", new(2026, 11, 4)),
            ],
        };
    }

    public static TheoryData<string> References() =>
        ["B2C_10.3_TRANSACTIONS_AGREGEES", "B2C_10.4_PAIEMENTS_AGREGES", "B2C_10.3_RECTIFICATIVE", "INT_10.1_TRANSACTIONS_UNITAIRES", "INT_10.2_PAIEMENTS_UNITAIRES"];

    private static TransmissionEreporting Transmission(string nom) => nom switch
    {
        "B2C_10.3_TRANSACTIONS_AGREGEES" => Envoi(DonneesB2C(), SousFluxEreporting.TransactionsAgregees, Contexte),
        "B2C_10.4_PAIEMENTS_AGREGES" => Envoi(DonneesB2C(), SousFluxEreporting.PaiementsAgreges, Contexte),
        "B2C_10.3_RECTIFICATIVE" => Envoi(DonneesB2C() with { Ventes = [.. DonneesB2C().Ventes.Take(4)] }, SousFluxEreporting.TransactionsAgregees,
            Contexte with { Correction = 1, Horodatage = new DateTime(2026, 12, 5, 14, 0, 0) }),
        "INT_10.1_TRANSACTIONS_UNITAIRES" => Envoi(DonneesInternationales(), SousFluxEreporting.TransactionsUnitaires, Contexte),
        "INT_10.2_PAIEMENTS_UNITAIRES" => Envoi(DonneesInternationales(), SousFluxEreporting.PaiementsUnitaires, Contexte),
        _ => throw new ArgumentOutOfRangeException(nameof(nom)),
    };

    private static TransmissionEreporting Envoi(DonneesEreporting d, string sousFlux, ContexteEnvoi c) =>
        Assert.Single(ReglesEreporting.Decouper(d, DecoupageEreporting.Unique, c), e => e.SousFlux == sousFlux).Transmission;

    [Theory]
    [MemberData(nameof(References))]
    public void Ecrit_valide_et_identique_a_la_reference(string nom)
    {
        var t = Transmission(nom);
        Assert.Empty(ReglesEreporting.Controler(t));
        var xml = EcritureFlux10.Ecrire(t);
        Assert.Empty(ValidationXsd.Valider(XDocument.Parse(Encoding.UTF8.GetString(xml)), JeuXsd.Flux10));
        var reference = CasPartages.Chemin("modules", "facture-electronique", "tests", "ereporting", nom + ".xml");
        if (Environment.GetEnvironmentVariable("LOGIBTP_REGENERER_FLUX10") == "1")
        {
            Directory.CreateDirectory(Path.GetDirectoryName(reference)!);
            File.WriteAllBytes(reference, xml);
        }
        Assert.True(File.Exists(reference), $"référence absente : {reference} (LOGIBTP_REGENERER_FLUX10=1)");
        Assert.Equal(File.ReadAllText(reference), Encoding.UTF8.GetString(xml));
    }

    [Fact]
    public void Contenu_ecrit_des_transactions_agregees()
    {
        var x = EcritureFlux10.Document(Transmission("B2C_10.3_TRANSACTIONS_AGREGEES")).Root!;
        Assert.Equal("LB-20261101-103-001", x.Element("ReportDocument")!.Element("Id")!.Value);
        Assert.Equal("20261201093000", x.Element("ReportDocument")!.Element("IssueDateTime")!.Element("DateTimeString")!.Value);
        var r = x.Element("TransactionsReport")!;
        Assert.Equal(["20261101", "20261110"], r.Element("ReportPeriod")!.Elements().Select(e => e.Value));
        var jours = r.Elements("Transactions").Select(t => $"{t.Element("Date")!.Value} {t.Element("CategoryCode")!.Value} {t.Element("TaxExclusiveAmount")!.Value} {t.Element("TaxTotal")!.Value}");
        Assert.Equal(["20261102 TLB1 320.00 64.00", "20261102 TPS1 6650.40 584.04", "20261106 TPS1 980.00 196.00", "20261109 TPS1 -150.00 -15.00"], jours);
        Assert.Null(x.Element("PaymentsReport"));
    }

    [Fact]
    public void Facture_extraite_du_modele()
    {
        var f = Exemple() with { Acheteur = AcheteurAllemand };
        var t = ReglesEreporting.TransactionDe(f);
        Assert.Equal((f.Numero, f.DateEmission, f.TypeFacture, f.CadreFacturation), (t.Numero, t.Date, t.Type, t.Cadre));
        Assert.Equal(new EntrepriseEreporting(new Identifiant("200000008", SchemaIdentifiant.Siren), "FR37200000008", "FR"), t.Vendeur);
        Assert.Equal(new EntrepriseEreporting(new Identifiant("DE123456789", SchemaIdentifiant.UeHorsFrance), "DE123456789", "DE"), t.Acheteur);
        Assert.Equal(f.Totaux.TotalHt, t.TotalHt);
        Assert.Equal(f.Totaux.TotalTva, t.TotalTva);
        Assert.Equal(f.DetailsTva, t.Ventilation);
        Assert.Equal(f.Lignes.Count, t.Lignes.Count);
        // Acheteur sans identifiant de type G2.19 (SIRET seul) : G6.28 au contrôle.
        var sansId = ReglesEreporting.TransactionDe(f with { Acheteur = AcheteurAllemand with { Identifiants = [new Identifiant("X1", SchemaIdentifiant.Siret)] } });
        Assert.Null(sansId.Acheteur!.Identifiant);
    }

    private static TransmissionEreporting Int() => Transmission("INT_10.1_TRANSACTIONS_UNITAIRES");
    private static TransactionUnitaire Premiere(TransmissionEreporting t) => t.Transactions!.Factures[0];
    private static TransmissionEreporting AvecFacture(TransmissionEreporting t, TransactionUnitaire f) =>
        t with { Transactions = t.Transactions! with { Factures = [f, .. t.Transactions.Factures.Skip(1)] } };

    public static TheoryData<string, string, string> Alterations() => new()
    {
        { "identifiant de transmission à espaces doubles", RegleEreporting.G1104, "TT-1" },
        { "type de transmission CO", RegleEreporting.G801, "TT-4" },
        { "deux rapports", RegleEreporting.G629, "TB-1" },
        { "émetteur identifié par SIREN", RegleEreporting.G622, "TT-8" },
        { "déclarant rôle WK", RegleEreporting.G752, "TT-15" },
        { "période inversée", RegleEreporting.G625, "TT-18" },
        { "type 262", RegleEreporting.G101, "TT-21" },
        { "cadre S3", RegleEreporting.G102, "TT-28" },
        { "acompte en cadre S4", RegleEreporting.G160, "TT-28" },
        { "acheteur sans identifiant", RegleEreporting.G628, "TT-36" },
        { "acheteur UE sans TVA", RegleEreporting.G233, "TT-38" },
        { "taux de 19 %", RegleEreporting.G124, "TT-57" },
        { "exonération sans motif", RegleEreporting.G140, "TT-58" },
        { "total HT faux", RegleEreporting.G153, "TT-51" },
        { "montant à 3 décimales", RegleEreporting.G114, "TT-52" },
        { "facture hors période", RegleEreporting.Periode, "TT-20" },
        { "avoir sans facture antérieure", RegleEreporting.G132, "TG-11" },
        { "catégorie de transactions inconnue", RegleEreporting.G168, "TT-81" },
        { "encaissement en dollars", RegleEreporting.G627, "TT-98" },
        { "encaissement négatif", RegleEreporting.G116, "TT-99" },
    };

    private static TransmissionEreporting Alterer(string cas)
    {
        var t = Int();
        var f = Premiere(t);
        var b2c = Transmission("B2C_10.3_TRANSACTIONS_AGREGEES");
        var pa = Transmission("B2C_10.4_PAIEMENTS_AGREGES");
        var montant = pa.Paiements!.Agregats[0];
        return cas switch
        {
            "identifiant de transmission à espaces doubles" => t with { Id = "LB  1" },
            "type de transmission CO" => t with { Type = "CO" },
            "deux rapports" => t with { Paiements = pa.Paiements },
            "émetteur identifié par SIREN" => t with { Emetteur = Declarant with { Role = RoleCdar.Plateforme } },
            "déclarant rôle WK" => t with { Declarant = Declarant with { Role = RoleCdar.Plateforme } },
            "période inversée" => t with { Transactions = t.Transactions! with { Periode = new(Decade.Fin, Decade.Debut) } },
            "type 262" => AvecFacture(t, f with { Type = TypeFacture.AvoirRemiseGlobale }),
            "cadre S3" => AvecFacture(t, f with { Cadre = CadreFacturation.S3 }),
            "acompte en cadre S4" => AvecFacture(t, f with { Type = TypeFacture.Acompte, Cadre = CadreFacturation.S4 }),
            "acheteur sans identifiant" => AvecFacture(t, f with { Acheteur = f.Acheteur! with { Identifiant = null } }),
            "acheteur UE sans TVA" => AvecFacture(t, f with { Acheteur = f.Acheteur! with { NumeroTva = null } }),
            "taux de 19 %" => AvecFacture(t, f with { Ventilation = [f.Ventilation[0] with { Taux = 19m }] }),
            "exonération sans motif" => AvecFacture(t, f with { Ventilation = [f.Ventilation[0] with { Categorie = CategorieTva.Exoneree, MotifExoneration = null, CodeExoneration = null }] }),
            "total HT faux" => AvecFacture(t, f with { TotalHt = f.TotalHt + 1m }),
            "montant à 3 décimales" => AvecFacture(t, f with { TotalTva = f.TotalTva + 0.001m }),
            "facture hors période" => AvecFacture(t, f with { Date = new(2026, 11, 11) }),
            "avoir sans facture antérieure" => AvecFacture(t, Premiere(t) with { Type = TypeFacture.Avoir, FacturesAnterieures = [] }),
            "catégorie de transactions inconnue" => b2c with { Transactions = b2c.Transactions! with { Agregats = [b2c.Transactions.Agregats[0] with { Categorie = "TXX1" }] } },
            "encaissement en dollars" => pa with { Paiements = pa.Paiements with { Agregats = [montant with { Montants = [montant.Montants[0] with { Devise = "USD" }] }] } },
            "encaissement négatif" => pa with { Paiements = pa.Paiements with { Agregats = [montant with { Montants = [montant.Montants[0] with { Montant = -1m }] }] } },
            _ => throw new ArgumentOutOfRangeException(nameof(cas)),
        };
    }

    [Theory]
    [MemberData(nameof(Alterations))]
    public void Transmission_alteree_signalee(string cas, string regle, string donnee) =>
        Assert.Contains(ReglesEreporting.Controler(Alterer(cas)), e => e.Regle == regle && e.Donnee == donnee);

    [Fact]
    public void Ecriture_refusee_si_le_xsd_echoue()
    {
        var t = Int();
        var sansVentilation = AvecFacture(t, Premiere(t) with { Ventilation = [] });
        var e = Assert.Throws<ExceptionLectureFacture>(() => EcritureFlux10.Ecrire(sansVentilation));
        Assert.Equal(ErreurFe.XsdInvalide, e.Code);
        Assert.Contains(ReglesEreporting.Controler(sansVentilation), x => x.Regle == RegleEreporting.G153 && x.Donnee == "TG-23");
    }
}
