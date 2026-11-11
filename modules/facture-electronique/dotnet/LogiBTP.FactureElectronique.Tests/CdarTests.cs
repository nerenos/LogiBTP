using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using LogiBTP.FactureElectronique.Formats;
using Xunit;

namespace LogiBTP.FactureElectronique.Tests;

/// <summary>
/// CDAR D22B : les exemples FNFE 1.4.0.04 (tests/exemples/cdar/fnfe) lus, contrôlés et réécrits à l'identique du modèle ;
/// les statuts écrits par LogiBTP (tests/exemples/cdar/logibtp, validés par le schematron BR-FR-CDV dans cdar.test.js)
/// identiques aux fichiers de référence, relus à l'identique ; erreurs. Pour régénérer les fichiers de référence après un
/// changement voulu de l'écriture : variable d'environnement LOGIBTP_REGENERER_CDAR=1.
/// </summary>
public partial class CdarTests
{
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    private static string Dossier(params string[] parties) => LectureCiiTests.Dossier(["cdar", .. parties]);

    private static string Serialiser(MessageCdar m) => JsonSerializer.Serialize(m, Json);

    public static TheoryData<string> ExemplesFnfe() =>
        new(Directory.GetFiles(Dossier("fnfe"), "*.xml").Select(Path.GetFileName).Order(StringComparer.Ordinal)!);

    [GeneratedRegex(@"_(F\d{9})_\d{2}-CDV-(\d{3})_")]
    private static partial Regex RegexExemple();

    [Fact]
    public void Le_jeu_FNFE_contient_les_59_exemples() => Assert.Equal(59, ExemplesFnfe().Count);

    [Theory]
    [MemberData(nameof(ExemplesFnfe))]
    public void Chaque_exemple_FNFE_est_lu_controle_et_reecrit(string nom)
    {
        var m = Cdar.Lire(File.ReadAllBytes(Dossier("fnfe", nom)));

        var attendu = RegexExemple().Match(nom);
        Assert.True(attendu.Success, nom);
        var s = Assert.Single(Assert.Single(m.Accuses).Statuts);
        Assert.Equal(attendu.Groups[1].Value, s.Numero);
        Assert.Equal(attendu.Groups[2].Value, s.Statut);
        Assert.Equal(TypeFacture.Facture, s.TypeFacture);
        Assert.Equal(2025, s.DateFacture?.Year);
        Assert.Equal(SchemaIdentifiant.Siren, s.SchemaVendeur);
        var pourPpf = nom.EndsWith("_POUR_PPF.xml", StringComparison.Ordinal);
        Assert.Equal(pourPpf ? ProfilCdv.Ppf : ProfilCdv.Facture, m.Profil);
        Assert.Equal(pourPpf ? null : ProcessusCdv.Reglemente, m.Processus);
        Assert.Contains(m.Accuses[0].TypeAccuse, new[] { TypeAccuseCdar.Information, TypeAccuseCdar.Acquittement });
        if (s.Statut == StatutCdv.Encaissee)
            Assert.All(s.Details.SelectMany(d => d.Caracteristiques), c => Assert.Equal(CaracteristiqueCdv.MontantEncaisse, c.Type));

        // Statut ramené au cycle de vie d'une facture émise déjà déposée : admis par ReglesCycleVie.
        var lu = Assert.Single(Cdar.StatutsLus(m, SensFacture.Emise, [StatutCdv.Deposee]));
        Assert.Empty(lu.Erreurs);
        Assert.NotNull(lu.Emetteur);
        if (ReglesCycleVie.MotifObligatoire(s.Statut)) Assert.NotNull(lu.Motif);
        if (s.Statut == StatutCdv.Encaissee) Assert.NotEqual(0m, Assert.Single(lu.Encaissements).Montant); // négatif : avoir (UC5b)

        // Réécriture : XSD valide, relue à l'identique du modèle.
        var relu = Cdar.Lire(Cdar.Ecrire(m));
        Assert.Equal(Serialiser(m), Serialiser(relu));
    }

    [Theory]
    [InlineData("UC1_F202500003_01-CDV-200_Deposee.xml", EmetteurStatut.PaE)]
    [InlineData("UC1_F202500003_02-CDV-202_Recue.xml", EmetteurStatut.PaR)]
    [InlineData("UC2_F202500004_02-CDV-213_Rejetee.xml", EmetteurStatut.PaR)]
    [InlineData("UC1_F202500003_04-CDV-204_Prise_en_charge.xml", EmetteurStatut.Acheteur)]
    [InlineData("UC1_F202500003_07-CDV-212_Encaissee.xml", EmetteurStatut.Vendeur)]
    [InlineData("UC4b_F202500006_05-CDV-220_Annulee.xml", EmetteurStatut.Vendeur)]
    public void Emetteur_du_statut_deduit_du_role(string nom, string emetteur)
    {
        var m = Cdar.Lire(File.ReadAllBytes(Dossier("fnfe", nom)));
        Assert.Equal(emetteur, Cdar.StatutsLus(m, SensFacture.Emise, [StatutCdv.Deposee])[0].Emetteur);
    }

    [Fact]
    public void Litige_lu_motif_action_et_donnees_en_cause()
    {
        var m = Cdar.Lire(File.ReadAllBytes(Dossier("fnfe", "UC4_F202500006_04-CDV-207_En_litige.xml")));
        var d = Assert.Single(m.Accuses[0].Statuts[0].Details);
        Assert.Equal((MotifStatut.TxTvaErr, ActionCdv.Rectificative), (d.Motif, d.Action));
        Assert.Equal([CaracteristiqueCdv.DonneeInvalide, CaracteristiqueCdv.DonneeValideAttendue], d.Caracteristiques.Select(c => c.Type));
        Assert.Equal([10.00m, 20.00m], d.Caracteristiques.Select(c => c.Pourcentage!.Value));
        Assert.All(d.Caracteristiques, c => Assert.Equal(("BT-152", true), (c.Identifiant, c.Modifiee)));
    }

    // ---------------------------------------------------------------- statuts écrits par LogiBTP

    private static readonly DateTime Creation = new(2026, 11, 9, 10, 0, 0);
    private static readonly FactureReferencee Facture = new("F202600101", TypeFacture.Facture, new DateOnly(2026, 10, 15), "100000009",
        new DateTime(2026, 10, 15, 9, 30, 0));
    private static readonly PartieCdar Vendeur = new(null, "100000009", SchemaIdentifiant.Siren, "BTP CONSTRUCTIONS",
        "100000009_STATUTS", SchemaIdentifiant.AdresseElectronique);
    private static readonly PartieCdar Acheteur = new(null, "200000008", SchemaIdentifiant.Siren, "MAITRE D'OUVRAGE",
        "200000008", SchemaIdentifiant.AdresseElectronique);
    private static readonly PartieCdar PaE = new(RoleCdar.Plateforme, "0003", SchemaIdentifiant.Plateforme, "PA-E VENDEUR");
    private static PartieCdar Vers(PartieCdar p, string role) => p with { Role = role };

    private static StatutAEcrire Statut(string sens, string statut, string emetteur, PartieCdar auteur, params PartieCdar[] destinataires) =>
        new(sens, statut, emetteur, Facture, auteur, destinataires, Creation.AddMinutes(-5), Creation);

    /// <summary>Statuts de référence : un par statut que la société ou sa plateforme écrit, avec les données propres à chacun.</summary>
    public static IReadOnlyDictionary<string, StatutAEcrire> Cas() => new Dictionary<string, StatutAEcrire>
    {
        ["200_Deposee"] = Statut(SensFacture.Emise, StatutCdv.Deposee, EmetteurStatut.PaE, new PartieCdar(null), Vers(Vendeur, RoleCdar.Vendeur)),
        ["204_Prise_en_charge"] = Statut(SensFacture.Recue, StatutCdv.PriseEnCharge, EmetteurStatut.Acheteur, Acheteur, Vers(Vendeur, RoleCdar.Vendeur))
            with { Historique = [StatutCdv.Recue, StatutCdv.MiseADisposition], LibelleStatut = "Prise en charge" },
        ["206_Approuvee_partiellement"] = Statut(SensFacture.Recue, StatutCdv.ApprouveePartiellement, EmetteurStatut.Acheteur, Acheteur, Vers(Vendeur, RoleCdar.Vendeur))
            with
            {
                Motif = MotifStatut.QteErr, Action = ActionCdv.AvoirPartiel,
                Caracteristiques = [new(CaracteristiqueCdv.MontantHtApprouve, Modifiee: false, Montant: 8500.00m, Devise: "EUR")],
            },
        ["207_En_litige"] = Statut(SensFacture.Recue, StatutCdv.EnLitige, EmetteurStatut.Acheteur, Acheteur, Vers(Vendeur, RoleCdar.Vendeur))
            with
            {
                Motif = MotifStatut.TxTvaErr, LibelleMotif = "Taux de TVA erroné", Action = ActionCdv.Rectificative,
                Caracteristiques =
                [
                    new(CaracteristiqueCdv.DonneeInvalide, "BT-152", true, "Taux TVA", Pourcentage: 10.00m),
                    new(CaracteristiqueCdv.DonneeValideAttendue, "BT-152", true, "Taux TVA", Pourcentage: 20.00m),
                ],
            },
        ["208_Suspendue"] = Statut(SensFacture.Recue, StatutCdv.Suspendue, EmetteurStatut.Acheteur, Acheteur, Vers(Vendeur, RoleCdar.Vendeur))
            with { Motif = MotifStatut.JustifAbs, Action = ActionCdv.Information, Notes = [new("Procès-verbal de réception à joindre", "AAI")] },
        ["209_Completee"] = Statut(SensFacture.Emise, StatutCdv.Completee, EmetteurStatut.Vendeur, Vendeur, Vers(Acheteur, RoleCdar.Acheteur))
            with
            {
                Historique = [StatutCdv.Deposee, StatutCdv.Suspendue],
                Caracteristiques = [new(CaracteristiqueCdv.DonneeAPrendre, "BT-13", true, "Commande", Valeur: "CMD-2026-044")],
            },
        ["210_Refusee"] = Statut(SensFacture.Recue, StatutCdv.Refusee, EmetteurStatut.Acheteur, Acheteur, Vers(Vendeur, RoleCdar.Vendeur))
            with { Motif = MotifStatut.TransacInc },
        ["211_Paiement_transmis"] = Statut(SensFacture.Recue, StatutCdv.PaiementTransmis, EmetteurStatut.Acheteur, Acheteur, Vers(Vendeur, RoleCdar.Vendeur))
            with { Caracteristiques = [new(CaracteristiqueCdv.MontantPaye, Modifiee: false, Montant: 12000m, Devise: "EUR", Date: new DateOnly(2026, 11, 30))] },
        ["212_Encaissee"] = Statut(SensFacture.Emise, StatutCdv.Encaissee, EmetteurStatut.Vendeur, Vendeur, Vers(Acheteur, RoleCdar.Acheteur))
            with { Historique = [StatutCdv.Deposee], Encaissements = [new(10000m, 20.00m, "EUR"), new(527.50m, 5.50m, "EUR")] },
        ["212_Encaissee_POUR_PPF"] = Statut(SensFacture.Emise, StatutCdv.Encaissee, EmetteurStatut.Vendeur, Vendeur)
            with { Historique = [StatutCdv.Deposee], Encaissements = [new(12000m, 20.00m, "EUR")], Expediteur = PaE },
        ["213_Rejetee"] = Statut(SensFacture.Recue, StatutCdv.Rejetee, EmetteurStatut.PaR, new PartieCdar(null),
            Vers(Vendeur, RoleCdar.Vendeur), Vers(Acheteur, RoleCdar.Acheteur)) with { Motif = MotifStatut.Doublon },
        ["214_Visee"] = Statut(SensFacture.Recue, StatutCdv.Visee, EmetteurStatut.Agent,
            new PartieCdar(null, "300000007", SchemaIdentifiant.Siren, "MAITRE D'OEUVRE"), Vers(Vendeur, RoleCdar.Vendeur)),
        ["220_Annulee"] = Statut(SensFacture.Emise, StatutCdv.Annulee, EmetteurStatut.Vendeur, Vendeur, Vers(Acheteur, RoleCdar.Acheteur))
            with { Historique = [StatutCdv.Deposee, StatutCdv.EnLitige] },
        ["221_Erreur_routage"] = Statut(SensFacture.Emise, StatutCdv.ErreurRoutage, EmetteurStatut.PaR, new PartieCdar(null), PaE)
            with { Historique = [StatutCdv.Deposee], Motif = MotifStatut.RoutageErr },
        ["224_Demande_paiement_direct"] = Statut(SensFacture.Emise, StatutCdv.DemandePaiementDirect, EmetteurStatut.Vendeur, Vendeur,
            Vers(Acheteur, RoleCdar.Acheteur)) with
            {
                Historique = [StatutCdv.Deposee],
                PieceJointe = new("F202600101.pdf", "application/pdf", Encoding.ASCII.GetBytes("%PDF-1.7\n%%EOF\n")),
            },
        ["225_Affacturee"] = Statut(SensFacture.Emise, StatutCdv.Affacturee, EmetteurStatut.Vendeur, Vendeur, Vers(Acheteur, RoleCdar.Acheteur),
            new PartieCdar(RoleCdar.Affactureur, "400000006", SchemaIdentifiant.Siren, "AFFACTUREUR", "400000006", SchemaIdentifiant.AdresseElectronique))
            with { Historique = [StatutCdv.Deposee] },
        ["501_Irrecevable"] = Statut(SensFacture.Emise, StatutCdv.Irrecevable, EmetteurStatut.PaR, new PartieCdar(null), PaE)
            with { Historique = [StatutCdv.Deposee], Facture = new FactureReferencee("F202600101", null, null, null), Motif = MotifStatut.IrrSyntax },
    };

    public static TheoryData<string> NomsCas() => new(Cas().Keys.Order(StringComparer.Ordinal));

    [Theory]
    [MemberData(nameof(NomsCas))]
    public void Statut_ecrit_identique_a_la_reference_et_relu(string nom)
    {
        var cas = Cas()[nom];
        var message = Cdar.Construire(cas);
        var xml = Cdar.Ecrire(message);
        var reference = Dossier("logibtp", $"CDV-{nom}.xml");
        if (Environment.GetEnvironmentVariable("LOGIBTP_REGENERER_CDAR") == "1") File.WriteAllBytes(reference, xml);
        Assert.Equal(File.ReadAllText(reference).ReplaceLineEndings("\n"), Encoding.UTF8.GetString(xml));

        var relu = Cdar.Lire(xml);
        Assert.Equal(Serialiser(message), Serialiser(relu));
        var lu = Assert.Single(Cdar.StatutsLus(relu, cas.Sens, cas.Historique, cas.B2g));
        Assert.Empty(lu.Erreurs);
        Assert.Equal((cas.Statut, cas.Emetteur, cas.Motif, cas.Action), (lu.Statut, lu.Emetteur, lu.Motif, lu.Action));
        Assert.Equal(cas.Encaissements, lu.Encaissements);

        var accuse = relu.Accuses[0];
        Assert.Equal(cas.DateStatut, accuse.DateStatut);
        var transmission = cas.Emetteur is EmetteurStatut.PaE or EmetteurStatut.PaR;
        Assert.Equal(transmission ? TypeAccuseCdar.Acquittement : TypeAccuseCdar.Information, accuse.TypeAccuse);
        Assert.Equal(transmission ? RoleCdar.Plateforme : Cdar.RoleDe(cas.Emetteur), relu.Emetteur!.Role);
        Assert.Equal(ReglesCycleVie.ObligatoirePpf(cas.Statut), relu.Destinataires.Contains(Cdar.Ppf));
    }

    [Fact]
    public void Les_fichiers_de_reference_sont_ceux_des_cas()
    {
        var fichiers = Directory.GetFiles(Dossier("logibtp"), "*.xml").Select(Path.GetFileName).Order(StringComparer.Ordinal);
        Assert.Equal(Cas().Keys.Select(k => $"CDV-{k}.xml").Order(StringComparer.Ordinal), fichiers);
    }

    [Fact]
    public void Message_pour_le_PPF_seul_profil_einvoicingF2_sans_processus()
    {
        var m = Cdar.Construire(Cas()["212_Encaissee_POUR_PPF"]);
        Assert.Equal((ProfilCdv.Ppf, (string?)null), (m.Profil, m.Processus));
        Assert.Equal([Cdar.Ppf], m.Destinataires);
        Assert.Equal(ProfilCdv.Ppf, m.Accuses[0].Statuts[0].TypeReference);
    }

    [Fact]
    public void Codes_UNTDID_et_phase_des_statuts()
    {
        string?[] Code(string nom) { var m = Cdar.Construire(Cas()[nom]); return [m.Accuses[0].TypeAccuse, m.Accuses[0].Statuts[0].CodeUntdid]; }
        Assert.Equal([TypeAccuseCdar.Acquittement, "10"], Code("200_Deposee"));
        Assert.Equal([TypeAccuseCdar.Acquittement, "8"], Code("213_Rejetee"));
        Assert.Equal([TypeAccuseCdar.Acquittement, null], Code("221_Erreur_routage"));
        Assert.Equal([TypeAccuseCdar.Information, "50"], Code("210_Refusee"));
        Assert.Equal([TypeAccuseCdar.Information, "47"], Code("212_Encaissee"));
        Assert.Equal([TypeAccuseCdar.Information, "5"], Code("224_Demande_paiement_direct"));
    }

    [Fact]
    public void Identifiant_par_defaut_tenu_dans_50_caracteres()
    {
        var cas = Cas()["204_Prise_en_charge"];
        Assert.Equal("F202600101_204_20261109095500", Cdar.Construire(cas).Identifiant);
        var long_ = cas with { Facture = Facture with { Numero = new string('9', 35) } };
        var id = Cdar.Construire(long_).Identifiant;
        Assert.Equal(50, id.Length);
        Assert.EndsWith("_204_20261109095500", id);
    }

    // ---------------------------------------------------------------- erreurs

    private static ExceptionCdar Refus(StatutAEcrire s) => Assert.Throws<ExceptionCdar>(() => Cdar.Ecrire(s));

    [Fact]
    public void Statut_refuse_par_le_cycle_de_vie()
    {
        var refus = Refus(Cas()["210_Refusee"] with { Motif = null });
        Assert.Equal(ErreurFe.MotifObligatoire, refus.Code);

        refus = Refus(Cas()["204_Prise_en_charge"] with { Historique = [StatutCdv.Refusee] });
        Assert.Equal([ErreurFe.StatutTerminal], refus.Details);

        refus = Refus(Cas()["209_Completee"] with { Historique = [StatutCdv.Deposee] });
        Assert.Equal([ErreurFe.TransitionInterdite], refus.Details);

        refus = Refus(Cas()["212_Encaissee"] with { Emetteur = EmetteurStatut.Acheteur });
        Assert.Equal(ErreurFe.EmetteurNonAutorise, refus.Code);

        refus = Refus(Cas()["213_Rejetee"] with { Motif = MotifStatut.TxTvaErr });
        Assert.Equal([ErreurFe.MotifNonAutorise], refus.Details);
    }

    [Theory]
    [InlineData("212_Encaissee", "MDT-215")]
    [InlineData("204_Prise_en_charge", "MDT-73")]
    [InlineData("204_Prise_en_charge", "MDT-38")]
    [InlineData("204_Prise_en_charge", "MDT-129")]
    [InlineData("204_Prise_en_charge", "MDT-100")]
    [InlineData("204_Prise_en_charge", "MDT-57")]
    public void Donnee_obligatoire_absente(string nom, string terme)
    {
        var cas = Cas()[nom];
        cas = terme switch
        {
            "MDT-215" => cas with { Encaissements = [] },
            "MDT-73" => cas with { Destinataires = [Vers(Vendeur, RoleCdar.Vendeur) with { AdresseElectronique = null }] },
            "MDT-38" => cas with { Auteur = Acheteur with { Identifiant = null } },
            "MDT-129" => cas with { Facture = Facture with { SirenVendeur = null } },
            "MDT-100" => cas with { Facture = Facture with { Date = null } },
            _ => cas with { Destinataires = [Vers(Vendeur, RoleCdar.Vendeur) with { Identifiant = null }, Cdar.Ppf] },
        };
        var refus = Refus(cas);
        Assert.Equal((ErreurFe.DonneeInvalide, terme), (refus.Code, refus.Details.Single()));
    }

    [Fact]
    public void Lecture_refusee()
    {
        Assert.Equal(ErreurFe.XmlIllisible, Assert.Throws<ExceptionCdar>(() => Cdar.Lire("<a>"u8.ToArray())).Code);
        var cii = File.ReadAllBytes(LectureCiiTests.Dossier("cii", "en16931", "UC1_F202500003_00-INV_20250701_EN16931_FX_CII_Commentee.xml"));
        Assert.Equal(ErreurFe.SyntaxeInconnue, Assert.Throws<ExceptionCdar>(() => Cdar.Lire(cii)).Code);

        var exemple = File.ReadAllText(Dossier("fnfe", "UC1_F202500003_04-CDV-204_Prise_en_charge.xml"));
        var altere = Encoding.UTF8.GetBytes(exemple.Replace("<ram:TypeCode>23</ram:TypeCode>", "<ram:Inconnu>23</ram:Inconnu>"));
        var xsd = Assert.Throws<ExceptionCdar>(() => Cdar.Lire(altere));
        Assert.Equal(ErreurFe.XsdInvalide, xsd.Code);
        Assert.NotEmpty(xsd.Details);

        var sansStatut = Encoding.UTF8.GetBytes(Regex.Replace(exemple, @"<ram:ProcessConditionCode>204</ram:ProcessConditionCode>", ""));
        Assert.Equal(["MDT-105"], Assert.Throws<ExceptionCdar>(() => Cdar.Lire(sansStatut)).Details);
    }

    [Fact]
    public void Lecture_generale_reconnait_un_CDAR_sans_le_lire_comme_facture()
    {
        var cdar = File.ReadAllBytes(Dossier("fnfe", "UC1_F202500003_01-CDV-200_Deposee.xml"));
        Assert.Equal(Syntaxe.Cdar, Lecture.Detecter(cdar));
        Assert.Equal(ErreurFe.SyntaxeInconnue, Assert.Throws<ExceptionLectureFacture>(() => Lecture.Lire(cdar)).Code);
    }

    [Fact]
    public void Statut_recu_controle_par_le_cycle_de_vie()
    {
        // Refusée reçue sans motif : lue, mais signalée par le contrôle.
        var m = Cdar.Lire(File.ReadAllBytes(Dossier("fnfe", "UC3_F202500005_04-CDV-210_Refusee.xml")), validerXsd: false);
        var sansMotif = m with
        {
            Accuses = [m.Accuses[0] with { Statuts = [m.Accuses[0].Statuts[0] with { Details = [] }] }],
        };
        Assert.Equal([ErreurFe.MotifObligatoire], Cdar.StatutsLus(sansMotif, SensFacture.Emise, [StatutCdv.Deposee])[0].Erreurs);
        // Sens inconnu.
        Assert.Equal([ErreurFe.SensInconnu], Cdar.StatutsLus(m, "X")[0].Erreurs);
    }
}
