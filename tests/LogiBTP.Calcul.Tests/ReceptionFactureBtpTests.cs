using System.Text;
using LogiBTP.Annuaire.Web;
using LogiBTP.Api.Btp;
using LogiBTP.Comptabilite;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.FactureElectronique;
using LogiBTP.FactureElectronique.Formats;
using LogiBTP.FactureElectronique.Web;
using LogiBTP.FactureElectronique.Web.Connecteurs;
using LogiBTP.Ged.Web;
using LogiBTP.Reglements.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Testing;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Réception d'une facture électronique (plans/facturation-electronique.md, lot 12) : règles sans base sur les exemples
/// FNFE (lignes, TVA par la catégorie EN 16931 dont AE → autoliquidation, unités, fournisseur par SIREN puis SIRET,
/// rapprochement des lignes d'une commande) ; de bout en bout sur une base jetable complète (variable
/// LOGIBTP_TEST_PG_JETABLE : manifeste db/installation/scripts.txt chargé, écritures conservées, coffre de la GED
/// compris) : facture reçue de la plateforme simulée → pièce en brouillon rattachée, PDF en GED (étape RECEPTION, coffre),
/// chronologie complète, liste à traiter, doublon refusé et tracé, commande de BT-13 transformée.
/// </summary>
[Collection(EnvoiFactureBtpTests.CollectionBase)]
public class ReceptionFactureBtpTests
{
    private static string Dossier(params string[] parties) => CasPartages.Chemin(["modules", "facture-electronique", "tests", "exemples", .. parties]);

    /// <summary>Référentiel de TVA de la base de démonstration (db/100, db/223 ; catégories EN 16931 non remplies : proposées par le comportement).</summary>
    private static readonly TauxTvaRecu[] Tva =
    [
        new(1, "T20", 20m, ComportementTva.Normale, null, false), new(2, "T10", 10m, ComportementTva.Normale, null, false),
        new(3, "T55", 5.5m, ComportementTva.Normale, null, false), new(4, "AL20", 20m, ComportementTva.Autoliquidation, null, false),
        new(5, "IC20", 20m, ComportementTva.Intracommunautaire, CategorieEn16931.Intracommunautaire, false), new(6, "EXO", 0m, ComportementTva.Exoneree, null, false),
    ];

    private static readonly Dictionary<string, string[]> Unites = new()
    {
        ["u"] = [], ["ens"] = [], ["ft"] = [], ["pce"] = [], ["m"] = [], ["ml"] = [], ["m2"] = [], ["m3"] = [], ["kg"] = [], ["t"] = [], ["l"] = [], ["h"] = [], ["j"] = [],
        ["sac"] = ["BG"],
    };

    /// <summary>Factures d'exemple (FNFE et cas LogiBTP), PDF Factur-X compris, CDAR exclus.</summary>
    public static TheoryData<string> Exemples() => new(Fichiers());

    private static List<string> Fichiers()
    {
        var racine = Dossier();
        var d = new List<string>();
        foreach (var f in Directory.EnumerateFiles(racine, "*", SearchOption.AllDirectories)
                     .Select(f => Path.GetRelativePath(racine, f).Replace('\\', '/'))
                     .Where(f => (f.EndsWith(".xml", StringComparison.Ordinal) || f.EndsWith(".pdf", StringComparison.Ordinal)) && !f.StartsWith("cdar/", StringComparison.Ordinal))
                     .Order(StringComparer.Ordinal))
        {
            d.Add(f);
        }
        return d;
    }

    [Theory]
    [MemberData(nameof(Exemples))]
    public void Exemple_FNFE_donne_des_lignes_au_total_de_la_facture(string relatif)
    {
        var f = Lecture.Lire(File.ReadAllBytes(Dossier(relatif))).Facture;
        var p = ReceptionFactureBtp.PreparerLignes(f, Tva, Unites);
        // Total des éléments = total HT (BT-109) : lignes de premier niveau, remises et charges du document.
        Assert.Equal(f.Totaux.TotalHt, p.TotalLignes);
        Assert.Equal(f.Lignes.Count == 0 ? f.DetailsTva.Count : f.Lignes.Count + f.RemisesCharges.Count, p.Lignes.Count);
        foreach (var l in p.Lignes.Where(l => l.Type == TL.Element))
        {
            Assert.Equal(l.Montant, decimal.Round(l.Qte!.Value * l.Pv!.Value, 2, MidpointRounding.AwayFromZero));
        }
        // Aucune TVA ni unité inconnue sur les exemples (catégories S, AE, E, K, Z ; C62, H87…).
        Assert.True(p.TvaNonReconnues.Count == 0, string.Join(" ; ", p.TvaNonReconnues));
        Assert.True(p.UnitesNonReconnues.Count == 0, string.Join(" ; ", p.UnitesNonReconnues));
        Assert.All(p.Lignes.Where(l => l.Type == TL.Texte), l => Assert.Null(l.Qte));
    }

    [Fact]
    public void Sous_lignes_en_texte_sous_la_ligne_de_groupe()
    {
        var f = Lecture.Lire(File.ReadAllBytes(Dossier("cii/extended-ctc-fr/UC12_F202600025_SOUS-LIGNE_EXTENDED-CTC-FR_CII_Commentee.xml"))).Facture;
        var p = ReceptionFactureBtp.PreparerLignes(f, Tva, Unites);
        // Ligne de groupe en texte, ses sous-lignes chiffrées (montant du groupe = leur somme), information en texte.
        Assert.Equal([TL.Texte, TL.Element, TL.Element, TL.Texte], p.Lignes.Select(l => l.Type));
        Assert.Equal([200m, 300m], p.Lignes.Where(l => l.Type == TL.Element).Select(l => l.Montant));
        Assert.Contains("LIVRE-JOUET", p.Lignes[0].LibelleHtml);
    }

    [Theory]
    [InlineData(CategorieTva.Normale, "20", "T20")]
    [InlineData(CategorieTva.Normale, "5.5", "T55")]
    [InlineData(CategorieTva.Normale, "7", null)]
    [InlineData(CategorieTva.Autoliquidation, "0", "AL20")]
    [InlineData(CategorieTva.Autoliquidation, null, "AL20")]
    [InlineData(CategorieTva.Intracommunautaire, "0", "IC20")]
    [InlineData(CategorieTva.Exoneree, "0", "EXO")]
    [InlineData(CategorieTva.TauxZero, "0", "EXO")]
    [InlineData(CategorieTva.HorsChamp, null, "EXO")]
    [InlineData(null, "20", null)]
    public void Tva_par_la_categorie_EN16931(string? categorie, string? taux, string? attendu)
    {
        var t = ReceptionFactureBtp.ChoisirTva(categorie, taux is null ? null : decimal.Parse(taux, System.Globalization.CultureInfo.InvariantCulture), Tva);
        Assert.Equal(attendu, t?.Code);
    }

    [Fact]
    public void Autoliquidation_sans_categorie_comptable_AE_prend_le_taux_autoliquide()
    {
        // Catégorie comptable AE posée sur l'intracommunautaire aussi (ReglesTva) : le comportement A passe devant.
        TauxTvaRecu[] l = [new(9, "IC", 20m, ComportementTva.Intracommunautaire, CategorieEn16931.Autoliquidation, true), new(8, "AL", 20m, ComportementTva.Autoliquidation, null, false)];
        Assert.Equal("AL", ReceptionFactureBtp.ChoisirTva(CategorieTva.Autoliquidation, 0m, l)?.Code);
        Assert.Equal("IC", ReceptionFactureBtp.ChoisirTva(CategorieTva.Intracommunautaire, 0m, l)?.Code);
    }

    [Fact]
    public void Exemple_autoliquide_UC13_sur_le_taux_autoliquide()
    {
        foreach (var relatif in Fichiers())
        {
            var f = Lecture.Lire(File.ReadAllBytes(Dossier(relatif))).Facture;
            var p = ReceptionFactureBtp.PreparerLignes(f, Tva, Unites);
            foreach (var (ligne, preparee) in f.Lignes.Zip(p.Lignes).Where(x => x.First.CategorieTva == CategorieTva.Autoliquidation && x.Second.Type == TL.Element))
            {
                Assert.Equal(4, preparee.TvaId);
            }
        }
    }

    [Theory]
    [InlineData("C62", "u")]
    [InlineData("H87", "u")]
    [InlineData("MTK", "m2")]
    [InlineData("BG", "sac")]
    [InlineData("KMT", null)]
    [InlineData("", null)]
    public void Unite_par_synonyme_puis_correspondance_UNECE(string code, string? attendue) =>
        Assert.Equal(attendue, ReceptionFactureBtp.ChoisirUnite(code, Unites));

    [Fact]
    public void Fournisseur_par_SIREN_puis_SIRET()
    {
        FournisseurCandidat societe = new(1, "100000009", null, false, null), agence = new(2, "100000009", "10000000900017", false, 1),
            autre = new(3, "200000008", "10000000900025", false, null), provisoire = new(4, "100000009", null, true, null);
        Assert.Equal(1, ReceptionFactureBtp.ChoisirFournisseur("100000009", null, [agence, societe])?.Id);
        Assert.Equal(2, ReceptionFactureBtp.ChoisirFournisseur("100000009", "10000000900017", [societe, agence])?.Id);
        Assert.Equal(1, ReceptionFactureBtp.ChoisirFournisseur("100000009", null, [provisoire, societe])?.Id);
        Assert.Equal(3, ReceptionFactureBtp.ChoisirFournisseur("999999999", "10000000900025", [autre])?.Id);
        Assert.Null(ReceptionFactureBtp.ChoisirFournisseur("999999999", null, [societe]));
        var (siren, siret) = ReceptionFactureBtp.Identifiants(new Partie { RaisonSociale = "X", Identifiants = [new Identifiant("100 000 009 00017", SchemaIdentifiant.Siret)] });
        Assert.Equal(("100000009", "10000000900017"), (siren, siret));
    }

    [Fact]
    public void Lignes_rapprochees_par_reference_de_ligne_puis_article_puis_libelle()
    {
        LigneFacture L(string id, string nom, string? commande = null, string? article = null) =>
            new() { Identifiant = id, Nom = nom, Quantite = 1, Unite = "C62", MontantNet = 1, PrixNet = 1, LigneCommande = commande, ReferenceVendeur = article };
        LigneCommandeRecue[] commande = [new(10, "1", "ART-A", "Ciment", 5), new(11, "2", "ART-B", "Sable", 3), new(12, "3", null, "Gravier 10/20", 2)];
        var r = ReceptionFactureBtp.Rapprocher([L("a", "Autre chose", commande: "2"), L("b", "Ciment gris", article: "art-a"), L("c", "gravier 10/20"), L("d", "Inconnu")], commande);
        Assert.Equal(new Dictionary<string, long> { ["a"] = 11, ["b"] = 10, ["c"] = 12 }, r.ToDictionary(x => x.Key, x => x.Value.Id));
    }

    [Fact]
    public void Avoirs_reconnus_par_le_type_BT3()
    {
        Assert.True(ReceptionFactureBtp.EstAvoir(TypeFacture.Avoir));
        Assert.True(ReceptionFactureBtp.EstAvoir(TypeFacture.AvoirAcompte));
        Assert.False(ReceptionFactureBtp.EstAvoir(TypeFacture.Facture));
        Assert.False(ReceptionFactureBtp.EstAvoir(TypeFacture.Acompte));
    }

    /// <summary>Exemple d'avoir (381, UBL CreditNote et CII jumeaux) : facture d'origine BT-25, montants positifs gardés.</summary>
    [Theory]
    [InlineData("logibtp/AVOIR_F202500011_EN16931_UBL.xml")]
    [InlineData("logibtp/AVOIR_F202500011_EN16931_CII.xml")]
    public void Avoir_recu_lignes_positives_et_facture_d_origine(string relatif)
    {
        var f = Lecture.Lire(File.ReadAllBytes(Dossier(relatif))).Facture;
        Assert.True(ReceptionFactureBtp.EstAvoir(f.TypeFacture));
        Assert.Equal("F202500003", Assert.Single(f.FacturesAnterieures).Numero);
        var p = ReceptionFactureBtp.EnPositif(ReceptionFactureBtp.PreparerLignes(f, Tva, Unites));
        Assert.Equal(10000m, p.TotalLignes);
        Assert.All(p.Lignes.Where(l => l.Type == TL.Element), l => Assert.True(l.Montant > 0));
    }

    [Fact]
    public void Avoir_emis_en_negatif_remis_dans_le_sens_de_l_avoir_d_achat()
    {
        var f = Lecture.Lire(File.ReadAllBytes(Dossier("logibtp/AVOIR_F202500011_EN16931_CII.xml"))).Facture;
        // Même avoir, quantités et montants négatifs (certains émetteurs) : quantités inversées, prix gardés.
        var negatif = f with
        {
            Lignes = [.. f.Lignes.Select(l => l with { Quantite = -l.Quantite, MontantNet = -l.MontantNet })],
            Totaux = f.Totaux with { TotalHt = -f.Totaux.TotalHt },
        };
        var brut = ReceptionFactureBtp.PreparerLignes(negatif, Tva, Unites);
        Assert.Equal(-10000m, brut.TotalLignes);
        var p = ReceptionFactureBtp.EnPositif(brut);
        Assert.Equal((10000m, 10000m), (p.TotalLignes, p.TotalFacture));
        var positif = ReceptionFactureBtp.PreparerLignes(f, Tva, Unites).Lignes.Where(l => l.Type == TL.Element).Select(l => (l.Qte, l.Pv, l.Montant));
        Assert.Equal(positif, p.Lignes.Where(l => l.Type == TL.Element).Select(l => (l.Qte, l.Pv, l.Montant)));
        // Avoir déjà positif : inchangé.
        var deja = ReceptionFactureBtp.PreparerLignes(f, Tva, Unites);
        Assert.Same(deja, ReceptionFactureBtp.EnPositif(deja));
    }

    // ---------------------------------------------------------------- de bout en bout (base jetable)

    private sealed class Environnement(string racine) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Test";
        public string ApplicationName { get; set; } = "LogiBTP.Tests";
        public string ContentRootPath { get; set; } = racine;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private static ServiceProvider Services(string connexion)
    {
        var s = new ServiceCollection();
        var racine = Path.Combine(Path.GetTempPath(), "logibtp-reception-" + Guid.NewGuid().ToString("N"));
        s.AddLogging();
        s.AddSingleton<IConfiguration>(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Ged:Repertoire"] = racine }).Build());
        s.AddSingleton<IHostEnvironment>(new Environnement(racine));
        s.AddSingleton(new SocieteCourante(null, "Essai", connexion));
        s.AddSingleton(Microsoft.Extensions.Options.Options.Create(new OptionsSocietes { Principale = connexion }));
        void Base(IServiceProvider sp, DbContextOptionsBuilder o) => o.UseNpgsql(connexion).UseSnakeCaseNamingConvention();
        s.AddDbContext<LogiBtpContext>(Base);
        s.AddModuleDocument<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp, LogiBtpContext, SpecialisationBtp>();
        s.AddModuleGed<SpecialisationGedBtp>(Base);
        s.AddModuleAnnuaire<SpecialisationAnnuaireBtp>(Base);
        s.AddScoped<ServiceAnnuaire, ServiceAnnuaireBtp>();
        s.AddModuleFactureElectronique<SpecialisationFactureElectroniqueBtp>(Base);
        s.AddModuleReglement<SpecialisationReglementBtp>(Base);
        s.AddScoped<ModulesSociete>();
        return s.BuildServiceProvider();
    }

    private sealed record Ligne(string Type, string Avant, string Apres);

    [Fact]
    public async Task Facture_recue_de_la_plateforme_simulee_cree_la_piece_en_brouillon()
    {
        var connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG_JETABLE");
        if (string.IsNullOrEmpty(connexion)) return;
        await using var c = new NpgsqlConnection(connexion);
        await c.OpenAsync();
        async Task<object?> Scalaire(string sql, params (string, object)[] p)
        {
            await using var k = new NpgsqlCommand(sql, c);
            foreach (var (n, v) in p) k.Parameters.AddWithValue(n, v);
            var r = await k.ExecuteScalarAsync();
            return r is DBNull ? null : r;
        }
        if (await Scalaire("SELECT to_regclass('v_liste_fe_recues')::text") is null) return;
        await Scalaire("UPDATE module_societe SET mod_actif = TRUE WHERE mod_code = 'facture_electronique'");

        await using var services = Services(connexion);
        var admin = new Utilisateur("admin.test", Profils.Admin);
        using (var scope = services.CreateScope())
        {
            var fe = scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>();
            var p = await fe.Parametres(default);
            await fe.EnregistrerParametres(p with { Connecteur = ConnecteurFe.Simule, Actif = true, AdresseFlux = null, ConnexionOauth = null }, admin, default);
        }
        var plateforme = services.GetRequiredService<PlateformesSimulees>().Pour(services.GetRequiredService<SocieteCourante>().Base!);
        // Base jetable : flux restés sur la plateforme simulée (magasin en base) relevés d'abord, puis fournisseur de l'exemple
        // UC1 (SIREN 100000009) retiré des passages précédents.
        using (var scope = services.CreateScope()) await new ReleveFlux(scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>()).ReleverAsync(true, null, default);
        await Scalaire("UPDATE personne SET per_actif = FALSE WHERE per_siren = '100000009'");

        async Task<FluxDto> Recevoir(byte[] contenu, string nom)
        {
            var meta = plateforme.RecevoirFacture(contenu, nom);
            using var scope = services.CreateScope();
            var fe = scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>();
            await new ReleveFlux(fe).ReleverAsync(true, null, default);
            return (await fe.Liste(new FiltreFlux(Sens: SensFlux.Entrant), default)).First(x => x.IdFlux == meta.IdFlux);
        }
        async Task<List<string>> Chronologie(long ent)
        {
            using var scope = services.CreateScope();
            var fe = scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>();
            return [.. (await fe.Chronologie(null, TypesElementFe.Document, ent.ToString(), default)).Select(e => e.Type)];
        }

        // 1. Factur-X (PDF) de l'exemple UC1 : fournisseur inconnu → fiche provisoire, facture d'achat en brouillon.
        var pdf = await Recevoir(File.ReadAllBytes(Dossier("factur-x/en16931/UC1_F202500003_00-INV_20250701_EN16931_FX.pdf")), "UC1.pdf");
        Assert.Equal((EtatFlux.Traite, TypesElementFe.Document), (pdf.Etat, pdf.TypeElement));
        var ent = long.Parse(pdf.IdElement!);
        Assert.Equal(TypesDocument.AFacture, await Scalaire("SELECT t.tyd_code FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE d.ent_id = @e", ("e", ent)));
        Assert.Equal("BROUILLON", await Scalaire("SELECT s.std_code FROM document d JOIN statut_document s ON s.std_id = d.ent_std_id WHERE d.ent_id = @e", ("e", ent)));
        Assert.Equal(false, await Scalaire("SELECT ent_verrouille FROM document WHERE ent_id = @e", ("e", ent)));
        Assert.Equal("F202500003", await Scalaire("SELECT ent_reference_externe FROM document WHERE ent_id = @e", ("e", ent)));
        Assert.Equal(new DateOnly(2025, 7, 1), await Scalaire("SELECT ent_date_externe FROM document WHERE ent_id = @e", ("e", ent)));
        Assert.Equal(true, await Scalaire("SELECT p.per_provisoire FROM document d JOIN personne p ON p.per_id = d.ent_tiers_id WHERE d.ent_id = @e", ("e", ent)));
        Assert.Equal("100000009", await Scalaire("SELECT p.per_siren FROM document d JOIN personne p ON p.per_id = d.ent_tiers_id WHERE d.ent_id = @e", ("e", ent)));
        var facture = Lecture.Lire(File.ReadAllBytes(Dossier("factur-x/en16931/UC1_F202500003_00-INV_20250701_EN16931_FX.pdf"))).Facture;
        Assert.Equal(facture.Totaux.TotalHt, (decimal)(await Scalaire("SELECT ent_total_ht FROM document WHERE ent_id = @e", ("e", ent)))!);
        Assert.Equal((long)facture.Lignes.Count, await Scalaire("SELECT count(*) FROM document_ligne WHERE lig_ent_id = @e AND lig_tyl_id = @t", ("e", ent), ("t", (int)TL.Element)));
        // Origine IMPORT : format, fichier (original en GED), référence.
        Assert.Equal(Syntaxe.FacturX, await Scalaire("SELECT dor_format FROM document_origine WHERE dor_ent_id = @e AND dor_type = 'IMPORT'", ("e", ent)));
        Assert.Equal(pdf.GedOriginalId, await Scalaire("SELECT dor_fichier_id FROM document_origine WHERE dor_ent_id = @e", ("e", ent)));
        // PDF en GED de la pièce : étape RECEPTION, au coffre.
        Assert.NotNull(pdf.GedOriginalId);
        Assert.Equal("application/pdf", await Scalaire("SELECT v.vge_type_mime FROM version_ged v WHERE v.vge_document = @g ORDER BY v.vge_numero DESC LIMIT 1", ("g", pdf.GedOriginalId!.Value)));
        Assert.Equal(EtapesGed.Reception, await Scalaire("SELECT v.vge_etape FROM version_ged v WHERE v.vge_document = @g ORDER BY v.vge_numero DESC LIMIT 1", ("g", pdf.GedOriginalId.Value)));
        Assert.Equal(true, await Scalaire("SELECT dge_coffre FROM document_ged WHERE dge_id = @g", ("g", pdf.GedOriginalId.Value)));
        Assert.Equal(TypesDocument.AFacture, await Scalaire("SELECT dge_type_element FROM document_ged WHERE dge_id = @g", ("g", pdf.GedOriginalId.Value)));
        Assert.NotNull(pdf.GedLisibleId);
        // Chronologie complète de la pièce : reçue, lue, pièce créée, rattachée, Prise en charge posée (lot 13) et son CDAR produit.
        Assert.Equal([EvenementFe.Reception, EvenementFe.Lecture, EvenementFe.PieceCreee, EvenementFe.Rattachement, EvenementFe.Production, EvenementFe.StatutPose],
            await Chronologie(ent));
        // Liste « Factures reçues à traiter » : la pièce en brouillon.
        Assert.Equal(true, await Scalaire("SELECT a_traiter FROM v_liste_fe_recues WHERE flux_id = @f AND type_element = @t AND id = @e", ("f", pdf.Id), ("t", TypesDocument.AFacture), ("e", ent)));

        // 2. Même facture reçue une seconde fois : doublon refusé et tracé, la facture reste à traiter.
        var double_ = await Recevoir(File.ReadAllBytes(Dossier("factur-x/en16931/UC1_F202500003_00-INV_20250701_EN16931_FX.pdf")), "UC1-bis.pdf");
        Assert.Equal((EtatFlux.Recu, null), (double_.Etat, double_.IdElement));
        using (var scope = services.CreateScope())
        {
            var d = await scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>().Detail(double_.Id, default);
            Assert.Equal([EvenementFe.Reception, EvenementFe.Lecture, EvenementFe.Doublon], d.Chronologie.Select(e => e.Type));
            Assert.Equal(ErreurFe.FactureEnDouble, Assert.Single(d.Erreurs).Code);
        }
        Assert.Equal(TypesElementFe.Flux, await Scalaire("SELECT type_element FROM v_liste_fe_recues WHERE flux_id = @f AND a_traiter", ("f", double_.Id)));

        // 3. Commande du fournisseur désignée par BT-13 : facture par transformation, ligne rapprochée par son libellé.
        var tiers = (long)(await Scalaire("SELECT ent_tiers_id FROM document WHERE ent_id = @e", ("e", ent)))!;
        string numeroCommande;
        long ligneCommande;
        using (var scope = services.CreateScope())
        {
            var documents = scope.ServiceProvider.GetRequiredService<DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>();
            var db = scope.ServiceProvider.GetRequiredService<LogiBtpContext>();
            var cree = await documents.Creer(new CreationDocument { EntTydId = await TypesDocumentBtp.IdAsync(db, TypesDocument.ACommande, default), EntTiersId = tiers }, admin, default);
            var cmd = await documents.Charger(cree.Document.EntId, default);
            var tva = await db.TauxTva.Where(t => t.TtvCode == "T20").Select(t => t.TtvId).FirstAsync();
            var nature = await Scalaire("SELECT nat_id FROM nature_element ORDER BY nat_id LIMIT 1");
            foreach (var x in cmd.Lignes.Where(x => x.LigParentId is null)) x.LigOrdre += 1;
            cmd.Lignes.Add(new DocumentLigneBtp
            {
                LigId = -1, LigEntId = cmd.Document.EntId, LigOrdre = 1, LigTylId = TL.Element, LigLibelleHtml = facture.Lignes[0].Nom, LigQte = 100,
                LigUntCode = "u", LigPv = 1m, LigPvFixe = true, LigTvaId = tva, LigTypePrix = "V", LigNatId = nature is int n ? n : null,
            });
            if (!cmd.Lignes.Any(x => x.LigParentId is null && x.LigTylId == TL.Tva))
                cmd.Lignes.Add(new DocumentLigneBtp { LigId = -2, LigEntId = cmd.Document.EntId, LigOrdre = 99, LigTylId = TL.Tva, LigLibelleHtml = "TVA", LigTypePrix = "V" });
            var r = await documents.Enregistrer(cmd.Document.EntId, cmd, admin, default);
            await documents.Valider(cmd.Document.EntId, new DemandeVersion { EntVersion = r.Document.Document.EntVersion }, admin, default);
            numeroCommande = (string)(await Scalaire("SELECT ent_numero FROM document WHERE ent_id = @e", ("e", cmd.Document.EntId)))!;
            ligneCommande = (long)(await Scalaire("SELECT lig_id FROM document_ligne WHERE lig_ent_id = @e AND lig_tyl_id = @t", ("e", cmd.Document.EntId), ("t", (int)TL.Element)))!;
        }
        var numero = "F" + Random.Shared.NextInt64(100_000_000, 999_999_999);
        var xml = Encoding.UTF8.GetString(File.ReadAllBytes(Dossier("cii/en16931/UC1_F202500003_00-INV_20250701_EN16931_FX_CII_Commentee.xml")))
            .Replace("F202500003", numero).Replace("PO202525478", numeroCommande);
        var transformee = await Recevoir(Encoding.UTF8.GetBytes(xml), $"{numero}.xml");
        Assert.Equal(EtatFlux.Traite, transformee.Etat);
        var entCommande = long.Parse(transformee.IdElement!);
        Assert.Equal(ligneCommande, await Scalaire("SELECT lig_origine_id FROM document_ligne WHERE lig_ent_id = @e AND lig_origine_id IS NOT NULL", ("e", entCommande)));
        Assert.Equal(facture.Lignes[0].Quantite, (decimal)(await Scalaire("SELECT lig_qte FROM document_ligne WHERE lig_ent_id = @e AND lig_origine_id IS NOT NULL", ("e", entCommande)))!);
        Assert.Equal(numero, await Scalaire("SELECT ent_reference_externe FROM document WHERE ent_id = @e", ("e", entCommande)));
        Assert.Equal("BROUILLON", await Scalaire("SELECT s.std_code FROM document d JOIN statut_document s ON s.std_id = d.ent_std_id WHERE d.ent_id = @e", ("e", entCommande)));
        Assert.Equal((long)facture.Lignes.Count, await Scalaire("SELECT count(*) FROM document_ligne WHERE lig_ent_id = @e AND lig_tyl_id = @t", ("e", entCommande), ("t", (int)TL.Element)));
    }

    [Fact]
    public async Task Facture_glissee_hors_plateforme_puis_avoir_recu_rattache_a_sa_facture()
    {
        if (await PreparerAsync() is not { } prepare) return;
        var (c, services, _) = prepare;
        await using var _c = c;
        await using var _s = services;
        async Task<object?> Scalaire(string sql, params (string, object)[] p)
        {
            await using var k = new NpgsqlCommand(sql, c);
            foreach (var (n, v) in p) k.Parameters.AddWithValue(n, v);
            var r = await k.ExecuteScalarAsync();
            return r is DBNull ? null : r;
        }
        await using (var k = new NpgsqlCommand("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE column_name = 'ffl_hors_plateforme')", c))
        {
            if (await k.ExecuteScalarAsync() is not true) return;
        }
        var admin = new Utilisateur("admin.test", Profils.Admin);
        var numero = "F" + Random.Shared.NextInt64(100_000_000, 999_999_999);
        var siren = Siren();
        var contenu = FactureUnique(numero, siren);

        // 1. Facture glissée (lot 14) : même pièce qu'un flux reçu (facture d'achat en brouillon, origine, GED), connecteur
        //    MANUEL hors plateforme, Prise en charge gardée au journal sans CDAR.
        FluxDto f;
        FluxDetailDto d;
        using (var scope = services.CreateScope())
        {
            var fe = scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>();
            f = await fe.Importer(new ImportManuel($"{numero}.xml", Convert.ToBase64String(contenu), HorsPlateforme: true), admin, default);
            d = await fe.Detail(f.Id, default);
        }
        Assert.Equal((EtatFlux.Traite, ConnecteurFe.Manuel, SensFlux.Entrant, true, TypesElementFe.Document), (f.Etat, f.Connecteur, f.Sens, f.HorsPlateforme, f.TypeElement));
        var ent = long.Parse(f.IdElement!);
        var facture = Lecture.Lire(contenu).Facture;
        Assert.Equal(TypesDocument.AFacture, await Scalaire("SELECT t.tyd_code FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE d.ent_id = @e", ("e", ent)));
        Assert.Equal("BROUILLON", await Scalaire("SELECT s.std_code FROM document d JOIN statut_document s ON s.std_id = d.ent_std_id WHERE d.ent_id = @e", ("e", ent)));
        Assert.Equal(facture.Totaux.TotalHt, (decimal)(await Scalaire("SELECT ent_total_ht FROM document WHERE ent_id = @e", ("e", ent)))!);
        Assert.Equal(numero, await Scalaire("SELECT ent_reference_externe FROM document WHERE ent_id = @e", ("e", ent)));
        Assert.Equal(f.GedOriginalId, await Scalaire("SELECT dor_fichier_id FROM document_origine WHERE dor_ent_id = @e", ("e", ent)));
        Assert.Equal(true, await Scalaire("SELECT (dor_rapport->>'hors_plateforme')::boolean FROM document_origine WHERE dor_ent_id = @e", ("e", ent)));
        Assert.Equal([EvenementFe.ImportManuel, EvenementFe.Lecture, EvenementFe.PieceCreee, EvenementFe.Rattachement, EvenementFe.StatutPose], d.Chronologie.Select(x => x.Type));
        Assert.Null(Assert.Single(d.Statuts).FluxCdarId);
        Assert.Equal(0L, await Scalaire("SELECT count(*) FROM fe_flux WHERE ffl_syntaxe = 'CDAR' AND ffl_type_element = 'DOCUMENT' AND ffl_id_element = @e", ("e", ent.ToString(System.Globalization.CultureInfo.InvariantCulture))));
        Assert.Equal(true, await Scalaire("SELECT a_traiter FROM v_liste_fe_recues WHERE flux_id = @f", ("f", f.Id)));

        // 2. Avoir reçu (UBL CreditNote 381) sur cette facture : avoir d'achat en brouillon, montants positifs, facture d'origine rattachée.
        var numeroAvoir = "A" + Random.Shared.NextInt64(100_000_000, 999_999_999);
        var xml = Encoding.UTF8.GetString(File.ReadAllBytes(Dossier("logibtp/AVOIR_F202500011_EN16931_UBL.xml")))
            .Replace("F202500011", numeroAvoir).Replace("F202500003", numero).Replace("100000009", siren);
        FluxDto a;
        using (var scope = services.CreateScope())
            a = await scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>()
                .ImporterHorsPlateformeAsync(Encoding.UTF8.GetBytes(xml), $"{numeroAvoir}.xml", new { essai = true }, admin, default);
        Assert.Equal((EtatFlux.Traite, Syntaxe.Ubl), (a.Etat, a.Syntaxe));
        var avoir = long.Parse(a.IdElement!);
        Assert.Equal(TypesDocument.AAvoir, await Scalaire("SELECT t.tyd_code FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE d.ent_id = @e", ("e", avoir)));
        Assert.Equal("BROUILLON", await Scalaire("SELECT s.std_code FROM document d JOIN statut_document s ON s.std_id = d.ent_std_id WHERE d.ent_id = @e", ("e", avoir)));
        Assert.Equal(10000m, (decimal)(await Scalaire("SELECT ent_total_ht FROM document WHERE ent_id = @e", ("e", avoir)))!);
        Assert.Equal(await Scalaire("SELECT ent_tiers_id FROM document WHERE ent_id = @e", ("e", ent)), await Scalaire("SELECT ent_tiers_id FROM document WHERE ent_id = @e", ("e", avoir)));
        Assert.Equal(1L, await Scalaire("SELECT count(*) FROM document_lien WHERE lie_source_ent_id = @f AND lie_cible_ent_id = @a AND lie_type = 'TRANSFORMATION'", ("f", ent), ("a", avoir)));
        Assert.Equal(ent, await Scalaire("SELECT (dor_rapport->'facture_origine'->>'id')::bigint FROM document_origine WHERE dor_ent_id = @e", ("e", avoir)));

        // 3. Même avoir glissé une seconde fois : doublon refusé (avoir déjà enregistré), resté à traiter.
        using (var scope = services.CreateScope())
        {
            var fe = scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>();
            var bis = await fe.ImporterHorsPlateformeAsync(Encoding.UTF8.GetBytes(xml), $"{numeroAvoir}-bis.xml", null, admin, default);
            Assert.Equal((EtatFlux.Recu, null), (bis.Etat, bis.IdElement));
            Assert.Equal(ErreurFe.FactureEnDouble, Assert.Single((await fe.Detail(bis.Id, default)).Erreurs).Code);
        }

        // 4. GED : un même contenu n'est rangé qu'une fois pour la pièce (brouillon repris : lisible, pièces jointes).
        using (var scope = services.CreateScope())
        {
            var reception = new ReceptionFactureBtp(scope.ServiceProvider, NullLogger.Instance, admin);
            var groupe = (long)(await Scalaire("SELECT coalesce(ent_groupe_id, ent_id) FROM document WHERE ent_id = @e", ("e", avoir)))!;
            var octets = Encoding.UTF8.GetBytes($"lisible {numeroAvoir}");
            var premier = await reception.DeposerAsync(TypesDocument.AAvoir, groupe, "lisible.txt", octets, "text/plain", "Lisible", null, default);
            Assert.NotNull(premier);
            Assert.Equal(premier, await reception.DeposerAsync(TypesDocument.AAvoir, groupe, "lisible-bis.txt", octets, "text/plain", "Lisible", null, default));
        }
    }

    /// <summary>Base jetable complète prête pour la réception (module actif, plateforme simulée), ou null sans base.</summary>
    private static async Task<(NpgsqlConnection, ServiceProvider, PlateformeSimulee)?> PreparerAsync()
    {
        var connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG_JETABLE");
        if (string.IsNullOrEmpty(connexion)) return null;
        var c = new NpgsqlConnection(connexion);
        await c.OpenAsync();
        await using (var k = new NpgsqlCommand("SELECT to_regclass('v_liste_fe_recues') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE column_name = 'fpa_statuts_non_envoyes')", c))
        {
            if (await k.ExecuteScalarAsync() is not true) { await c.DisposeAsync(); return null; }
        }
        await using (var k = new NpgsqlCommand("UPDATE module_societe SET mod_actif = TRUE WHERE mod_code = 'facture_electronique'", c)) await k.ExecuteNonQueryAsync();
        var services = Services(connexion);
        using (var scope = services.CreateScope())
        {
            var fe = scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>();
            var p = await fe.Parametres(default);
            await fe.EnregistrerParametres(p with { Connecteur = ConnecteurFe.Simule, Actif = true, AdresseFlux = null, ConnexionOauth = null, StatutsNonEnvoyes = [] },
                new Utilisateur("admin.test", Profils.Admin), default);
            await new ReleveFlux(fe).ReleverAsync(true, null, default);
        }
        return (c, services, services.GetRequiredService<PlateformesSimulees>().Pour(services.GetRequiredService<SocieteCourante>().Base!));
    }

    /// <summary>Facture CII de l'exemple UC1 sous un numéro et un SIREN de vendeur propres au test (fournisseur provisoire neuf).</summary>
    private static byte[] FactureUnique(string numero, string siren) =>
        Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(File.ReadAllBytes(Dossier("cii/en16931/UC1_F202500003_00-INV_20250701_EN16931_FX_CII_Commentee.xml")))
            .Replace("F202500003", numero).Replace("100000009", siren));

    private static string Siren()
    {
        // SIREN valide (clé de Luhn) tiré au hasard.
        while (true)
        {
            var s = Random.Shared.NextInt64(100_000_000, 999_999_999).ToString(System.Globalization.CultureInfo.InvariantCulture);
            var somme = s.Select((c, i) => { var d = (c - '0') * (i % 2 == 1 ? 2 : 1); return d > 9 ? d - 9 : d; }).Sum();
            if (somme % 10 == 0) return s;
        }
    }

    [Fact]
    public async Task Statuts_poses_a_la_reception_204_205_211_puis_204_207_210_et_refus_apres_approbation()
    {
        if (await PreparerAsync() is not { } prepare) return;
        var (c, services, plateforme) = prepare;
        await using var _c = c;
        await using var _s = services;
        var admin = new Utilisateur("admin.test", Profils.Admin);
        async Task<object?> Scalaire(string sql, params (string, object)[] p)
        {
            await using var k = new NpgsqlCommand(sql, c);
            foreach (var (n, v) in p) k.Parameters.AddWithValue(n, v);
            var r = await k.ExecuteScalarAsync();
            return r is DBNull ? null : r;
        }
        async Task<FluxDto> Recevoir(byte[] contenu, string nom)
        {
            var meta = plateforme.RecevoirFacture(contenu, nom);
            using var scope = services.CreateScope();
            var fe = scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>();
            await new ReleveFlux(fe).ReleverAsync(true, null, default);
            return (await fe.Liste(new FiltreFlux(Sens: SensFlux.Entrant), default)).First(x => x.IdFlux == meta.IdFlux);
        }
        async Task<FluxDetailDto> Detail(long id)
        {
            using var scope = services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>().Detail(id, default);
        }

        // 1. 204 → 205 → 211 : prise en charge à la création, approuvée à la validation, paiement transmis au règlement émis.
        var numero = "F" + Random.Shared.NextInt64(100_000_000, 999_999_999);
        var flux = await Recevoir(FactureUnique(numero, Siren()), $"{numero}.xml");
        var ent = long.Parse(flux.IdElement!);
        var d = await Detail(flux.Id);
        Assert.Equal([StatutCdv.PriseEnCharge], d.Statuts.Select(x => x.Code));
        Assert.Equal(StatutCdv.PriseEnCharge, d.Flux.StatutAffiche);
        Assert.NotNull(d.Statuts[0].FluxCdarId);
        using (var scope = services.CreateScope())
        {
            // Validation de la pièce (point d'accroche ApresValidationAsync : services de la requête, appelé ici directement).
            var documents = scope.ServiceProvider.GetRequiredService<DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>();
            var nature = await Scalaire("SELECT nat_id FROM nature_element ORDER BY nat_id LIMIT 1");
            await Scalaire("UPDATE document_ligne SET lig_nat_id = @n WHERE lig_ent_id = @e AND lig_tyl_id = @t AND lig_nat_id IS NULL", ("n", nature!), ("e", ent), ("t", (int)TL.Element));
            var version = (int)(await Scalaire("SELECT ent_version FROM document WHERE ent_id = @e", ("e", ent)))!;
            await documents.Valider(ent, new DemandeVersion { EntVersion = version }, admin, default);
            var statuts = new StatutsReceptionBtp(scope.ServiceProvider, NullLogger.Instance);
            Assert.True(await statuts.ApprouverAsync(ent, admin.Code, default));
            Assert.False(await statuts.ApprouverAsync(ent, admin.Code, default)); // déjà posée : ignorée
        }
        using (var scope = services.CreateScope())
        {
            // Refus impossible après Approuvée (ReglesCycleVie) : 422 TRANSITION_INTERDITE.
            var fe = scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>();
            var e = await Assert.ThrowsAsync<ExceptionMetier>(() => fe.PoserStatutAsync(flux.Id, new StatutAPoser(StatutCdv.Refusee, MotifStatut.Doublon), admin, default));
            Assert.Equal((422, ErreurFe.TransitionInterdite), (e.Statut, e.Code));
        }
        using (var scope = services.CreateScope())
        {
            // Règlement émis qui pointe l'échéance de la pièce : Paiement transmis (pièces payées lues dans la transaction du règlement).
            var reglements = scope.ServiceProvider.GetRequiredService<ServiceReglement>();
            var echeance = (long)(await Scalaire("SELECT ech_id FROM document_echeance WHERE ech_ent_id = @e ORDER BY ech_rang LIMIT 1", ("e", ent)))!;
            var montant = (decimal)(await Scalaire("SELECT ech_montant FROM document_echeance WHERE ech_id = @i", ("i", echeance)))!;
            var tiers = (long)(await Scalaire("SELECT ent_tiers_id FROM document WHERE ent_id = @e", ("e", ent)))!;
            await reglements.EnregistrerReglement(null, new ReglementSaisi(tiers, "D", DateOnly.FromDateTime(DateTime.Today), "VIREMENT", montant, numero, null,
                [new PointageSaisi(echeance, montant)]), admin, default);
            var payees = await StatutsReceptionBtp.PiecesPayeesAsync(scope.ServiceProvider.GetRequiredService<ReglementDbContext>(), [echeance], default);
            Assert.Equal([ent], payees);
            Assert.Equal(1, await new StatutsReceptionBtp(scope.ServiceProvider, NullLogger.Instance).PaiementTransmisAsync(payees, admin.Code, default));
        }
        d = await Detail(flux.Id);
        Assert.Equal([StatutCdv.PriseEnCharge, StatutCdv.Approuvee, StatutCdv.PaiementTransmis], d.Statuts.Select(x => x.Code));
        Assert.All(d.Statuts, x => Assert.Equal((SensStatut.Pose, EmetteurStatut.Acheteur), (x.Sens, x.Emetteur)));
        Assert.Equal(StatutCdv.PaiementTransmis, d.Flux.StatutAffiche);
        // Chaque statut : un CDAR déposé par la file sur la plateforme simulée, acquitté.
        using (var scope = services.CreateScope())
        {
            var fe = scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>();
            await new FileFlux(fe).TraiterAsync(50, default);
        }
        foreach (var x in d.Statuts) Assert.Equal(EtatFlux.Envoye, (await Detail(x.FluxCdarId!.Value)).Flux.Etat);
        Assert.Equal(3, d.Chronologie.Count(x => x.Type == EvenementFe.StatutPose));

        // 2. 204 → 207 → 210 : litige puis refus par les boutons (motifs de la liste autorisée) ; Refusée part aussi au PPF.
        var numero2 = "F" + Random.Shared.NextInt64(100_000_000, 999_999_999);
        var flux2 = await Recevoir(FactureUnique(numero2, Siren()), $"{numero2}.xml");
        using (var scope = services.CreateScope())
        {
            var fe = scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>();
            var litige = await fe.PoserStatutAsync(flux2.Id, new StatutAPoser(StatutCdv.EnLitige, MotifStatut.QteErr) { Commentaire = "Quantité livrée : 8" }, admin, default);
            Assert.NotNull(litige.FluxCdarId);
            var sansMotif = await Assert.ThrowsAsync<ExceptionMetier>(() => fe.PoserStatutAsync(flux2.Id, new StatutAPoser(StatutCdv.Refusee), admin, default));
            Assert.Equal(ErreurFe.MotifObligatoire, sansMotif.Code);
            var refus = await fe.PoserStatutAsync(flux2.Id, new StatutAPoser(StatutCdv.Refusee, MotifStatut.Doublon), admin, default);
            var cdar = Cdar.Lire((await fe.Fichier(refus.FluxCdarId!.Value, null, default)).Contenu);
            Assert.Contains(cdar.Destinataires, x => x.Role == RoleCdar.Ppf);
            // Rien après Refusée : ni approbation ni paiement.
            var ent2 = long.Parse(flux2.IdElement!);
            Assert.False(await new StatutsReceptionBtp(scope.ServiceProvider, NullLogger.Instance).ApprouverAsync(ent2, admin.Code, default));
            var terminal = await Assert.ThrowsAsync<ExceptionMetier>(() => fe.PoserStatutAsync(flux2.Id, new StatutAPoser(StatutCdv.EnLitige, MotifStatut.Autre), admin, default));
            Assert.Equal(ErreurFe.StatutTerminal, terminal.Code);
        }
        var d2 = await Detail(flux2.Id);
        Assert.Equal([StatutCdv.PriseEnCharge, StatutCdv.EnLitige, StatutCdv.Refusee], d2.Statuts.Select(x => x.Code));
        Assert.Equal(StatutCdv.Refusee, d2.Flux.StatutAffiche);
        Assert.Equal($"{EvenementFe.StatutPose}:{StatutCdv.EnLitige}>{StatutCdv.Refusee}",
            d2.Chronologie.Where(x => x.Type == EvenementFe.StatutPose).Select(x => $"{x.Type}:{x.EtatAvant}>{x.EtatApres}").Last());
    }

    [Fact]
    public async Task Brouillon_deja_cree_pour_le_flux_repris_sans_doublon()
    {
        if (await PreparerAsync() is not { } prepare) return;
        var (c, services, plateforme) = prepare;
        await using var _c = c;
        await using var _s = services;
        async Task<object?> Scalaire(string sql, params (string, object)[] p)
        {
            await using var k = new NpgsqlCommand(sql, c);
            foreach (var (n, v) in p) k.Parameters.AddWithValue(n, v);
            var r = await k.ExecuteScalarAsync();
            return r is DBNull ? null : r;
        }
        var numero = "F" + Random.Shared.NextInt64(100_000_000, 999_999_999);
        var contenu = FactureUnique(numero, Siren());
        var meta = plateforme.RecevoirFacture(contenu, $"{numero}.xml");
        // Premier passage interrompu après la création de la pièce : le flux (et son journal) est annulé, la pièce reste.
        long ent;
        using (var scope = services.CreateScope())
        {
            var specialisation = scope.ServiceProvider.GetRequiredService<SpecialisationFactureElectronique>();
            var perdu = new FluxFe { FflId = 0, FflSens = SensFlux.Entrant, FflConnecteur = ConnecteurFe.Simule, FflIdFlux = meta.IdFlux, FflNom = meta.Nom, FflSyntaxe = Syntaxe.Cii };
            var lue = Lecture.Lire(contenu);
            var cree = await specialisation.CreerPieceRecueAsync(new FactureRecueFe(perdu, lue.Facture, lue.Syntaxe), default);
            ent = long.Parse(cree!.Element!.Id);
            // Un second appel pour ce même flux rend le même brouillon (reprise), pas un doublon.
            var repris = await specialisation.CreerPieceRecueAsync(new FactureRecueFe(perdu, lue.Facture, lue.Syntaxe), default);
            Assert.Null(repris!.Refus);
            Assert.Equal(cree.Element, repris.Element);
            Assert.Equal(StatutCdv.PriseEnCharge, Assert.Single(repris.Statuts).Code);
        }
        // Relève suivante : le brouillon est rattaché, étapes reprises, sans erreur de doublon ni nouvelle pièce.
        FluxDetailDto d;
        using (var scope = services.CreateScope())
        {
            var fe = scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>();
            await new ReleveFlux(fe).ReleverAsync(true, null, default);
            var flux = (await fe.Liste(new FiltreFlux(Sens: SensFlux.Entrant), default)).First(x => x.IdFlux == meta.IdFlux);
            d = await fe.Detail(flux.Id, default);
        }
        Assert.Equal((EtatFlux.Traite, ent.ToString(System.Globalization.CultureInfo.InvariantCulture)), (d.Flux.Etat, d.Flux.IdElement));
        Assert.Empty(d.Erreurs);
        Assert.Equal([EvenementFe.Reception, EvenementFe.Lecture, EvenementFe.PieceCreee, EvenementFe.Rattachement, EvenementFe.StatutPose],
            d.Chronologie.Select(x => x.Type));
        Assert.True(d.Chronologie.First(x => x.Type == EvenementFe.PieceCreee).Detail?.GetProperty("reprise").GetBoolean(), d.Chronologie.First(x => x.Type == EvenementFe.PieceCreee).Detail?.GetRawText());
        Assert.Equal(1L, await Scalaire("""
            SELECT count(*) FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id
            WHERE t.tyd_code = ANY(@t) AND d.ent_reference_externe = @n
            """, ("t", ReceptionFactureBtp.TypesFactureRecue), ("n", numero)));
        // Original rangé une seule fois en GED de la pièce (fichier de document_origine réutilisé).
        Assert.Equal(d.Flux.GedOriginalId, await Scalaire("SELECT dor_fichier_id FROM document_origine WHERE dor_ent_id = @e", ("e", ent)));
    }

    // ---------------------------------------------------------------- sous-traitance (lot 15)

    private static ReceptionFactureBtp.MarcheRecu Marche(string? garantie, string? siren) =>
        new(1, "ST-1", 2, 3, 4, garantie, siren is null ? null : 9, siren, "MOA");

    [Fact]
    public void Ecarts_du_paiement_direct_contrat_garantie_et_payeur()
    {
        var payeur = new Partie { RaisonSociale = "COMMUNE DE MAVILLE", Siren = "400000006" };
        Assert.Equal([EcartReception.ContratIntrouvable], ReceptionFactureBtp.EcartsPaiementDirect(null, payeur));
        Assert.Empty(ReceptionFactureBtp.EcartsPaiementDirect(Marche(GarantiesMarche.PaiementDirect, "400000006"), payeur));
        Assert.Empty(ReceptionFactureBtp.EcartsPaiementDirect(Marche(GarantiesMarche.Delegation, "400 000 006"), payeur));
        Assert.Equal([EcartReception.PaiementDirectNonPrevu], ReceptionFactureBtp.EcartsPaiementDirect(Marche("CAUTION", "400000006"), payeur));
        Assert.Equal([EcartReception.PayeurDifferent], ReceptionFactureBtp.EcartsPaiementDirect(Marche(GarantiesMarche.PaiementDirect, "500000005"), payeur));
        // SIREN inconnu d'un côté : pas de comparaison.
        Assert.Empty(ReceptionFactureBtp.EcartsPaiementDirect(Marche(GarantiesMarche.PaiementDirect, null), payeur));
        Assert.Empty(ReceptionFactureBtp.EcartsPaiementDirect(Marche(GarantiesMarche.PaiementDirect, "500000005"), new Partie { RaisonSociale = "X" }));
        Assert.Equal(("DIRECT", "DELEGATION", (string?)null), (ReceptionFactureBtp.ModePaiement(GarantiesMarche.PaiementDirect),
            ReceptionFactureBtp.ModePaiement(GarantiesMarche.Delegation), ReceptionFactureBtp.ModePaiement(null)));
    }

    [Fact]
    public void Exemple_UC13_FNFE_hors_sous_traitance_et_sa_variante_S5_en_paiement_direct()
    {
        // Exemple FNFE UC13 (cadre B1, sans payeur) : pas de paiement direct ; variante LogiBTP en S5 avec le payeur : paiement direct.
        var fnfe = Lecture.Lire(File.ReadAllBytes(Dossier("cii/extended-ctc-fr/UC13_F202600037_EXTENDED-CTC-FR_CII_Commentee.xml"))).Facture;
        Assert.False(ReglesReception.ControlerSousTraitance(fnfe.CadreFacturation, fnfe.Payeur is not null, ReglesReception.Ventilations(fnfe), null).PaiementDirect);
        var s5 = Lecture.Lire(File.ReadAllBytes(Dossier("logibtp/S5_PAYEUR_EXTENDED-CTC-FR_CII.xml"))).Facture;
        Assert.Equal((CadreFacturation.S5, "COMMUNE DE MAVILLE", "MARCHE-2026-014"), (s5.CadreFacturation, s5.Payeur?.RaisonSociale, s5.References.Contrat));
        Assert.Equal("400000006", ReceptionFactureBtp.Identifiants(s5.Payeur!).Siren);
        Assert.Equal([], ReglesReception.ControlerSousTraitance(s5.CadreFacturation, true, ReglesReception.Ventilations(s5), null).Ecarts);
    }

    /// <summary>
    /// Cas 13 (paiement direct d'un sous-traitant, XP Z12-014 ; exemple FNFE UC13 F202600037 en cadre S5 avec le payeur) de
    /// bout en bout sur la base jetable : sous-traitant, maître d'ouvrage, chantier, marché de vente et marché de
    /// sous-traitance en paiement direct ; facture reçue → T_FACTURE_AVT en brouillon sur le marché (paiement direct,
    /// payeur, écart d'autoliquidation au rapport) ; statut 224 reçu → tracé au journal sur la pièce, demande de paiement
    /// enregistrée à la validation (reçue le jour du 224) ; seconde facture validée avant son 224 → demande enregistrée à la
    /// réception du statut ; payeur autre que le maître d'ouvrage signalé.
    /// </summary>
    [Fact]
    public async Task Facture_S5_du_sous_traitant_en_paiement_direct_puis_demande_224_rattachee()
    {
        if (await PreparerAsync() is not { } prepare) return;
        var (c, services, plateforme) = prepare;
        await using var _c = c;
        await using var _s = services;
        var admin = new Utilisateur("admin.test", Profils.Admin);
        async Task<object?> Scalaire(string sql, params (string, object)[] p)
        {
            await using var k = new NpgsqlCommand(sql, c);
            foreach (var (n, v) in p) k.Parameters.AddWithValue(n, v);
            var r = await k.ExecuteScalarAsync();
            return r is DBNull ? null : r;
        }
        if (await Scalaire("SELECT to_regclass('stt_paiement_direct')::text") is null) return;
        await Scalaire("UPDATE module_societe SET mod_actif = TRUE WHERE mod_code = 'sous_traitance'");
        async Task<FluxDto> Relever(string idFlux)
        {
            using var scope = services.CreateScope();
            var fe = scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>();
            await new ReleveFlux(fe).ReleverAsync(true, null, default);
            return (await fe.Liste(new FiltreFlux(Sens: SensFlux.Entrant), default)).First(x => x.IdFlux == idFlux);
        }
        async Task Valider(long ent)
        {
            using var scope = services.CreateScope();
            var documents = scope.ServiceProvider.GetRequiredService<DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>();
            var nature = await Scalaire("SELECT nat_id FROM nature_element ORDER BY nat_id LIMIT 1");
            await Scalaire("UPDATE document_ligne SET lig_nat_id = @n WHERE lig_ent_id = @e AND lig_tyl_id = @t AND lig_nat_id IS NULL", ("n", nature!), ("e", ent), ("t", (int)TL.Element));
            var version = (int)(await Scalaire("SELECT ent_version FROM document WHERE ent_id = @e", ("e", ent)))!;
            await documents.Valider(ent, new DemandeVersion { EntVersion = version }, admin, default);
        }

        // Structure : sous-traitant (SIREN du vendeur), maître d'ouvrage (SIREN du payeur), chantier, marché de vente, marché ST en paiement direct.
        var (sirenSt, sirenMoa) = (Siren(), Siren());
        var suffixe = Random.Shared.Next(100_000, 999_999).ToString(System.Globalization.CultureInfo.InvariantCulture);
        var st = (long)(await Scalaire("INSERT INTO personne (per_raison_sociale, per_niv_code, per_siren) VALUES ('COOP1 ' || @s, 'SOCIETE', @siren) RETURNING per_id", ("s", suffixe), ("siren", sirenSt)))!;
        var moa = (long)(await Scalaire("INSERT INTO personne (per_raison_sociale, per_niv_code, per_siren) VALUES ('COMMUNE DE MAVILLE ' || @s, 'COLLECTIVITE', @siren) RETURNING per_id", ("s", suffixe), ("siren", sirenMoa)))!;
        var chantier = (int)(await Scalaire("INSERT INTO chantier (cha_code, cha_libelle, cha_tiers_id) VALUES ('CH-' || @s, 'Chantier école', @m) RETURNING cha_id", ("s", suffixe), ("m", moa)))!;
        var vente = (int)(await Scalaire("INSERT INTO marche (mar_code, mar_libelle, mar_cha_id, mar_tiers_id, mar_sens) VALUES ('MV-' || @s, 'Marché de vente', @c, @m, 'V') RETURNING mar_id",
            ("s", suffixe), ("c", chantier), ("m", moa)))!;
        var codeMarche = "MST-" + suffixe;
        var marche = (int)(await Scalaire("""
            INSERT INTO marche (mar_code, mar_libelle, mar_cha_id, mar_tiers_id, mar_sens, mar_marche_vente_id, mar_garantie, mar_nature)
            VALUES (@code, 'Marché de sous-traitance', @c, @t, 'ST', @v, @g, 'U') RETURNING mar_id
            """, ("code", codeMarche), ("c", chantier), ("t", st), ("v", vente), ("g", GarantiesMarche.PaiementDirect)))!;
        string Facture(string numero, string sirenPayeur) => Encoding.UTF8.GetString(File.ReadAllBytes(Dossier("logibtp/S5_PAYEUR_EXTENDED-CTC-FR_CII.xml")))
            .Replace("F202600037", numero).Replace("200000008", sirenSt).Replace("MARCHE-2026-014", codeMarche).Replace("400000006", sirenPayeur);
        byte[] Demande224(string numero) => Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(File.ReadAllBytes(Dossier("cdar/logibtp/CDV-224_Demande_paiement_direct.xml")))
            .Replace("F202600101", numero));

        // 1. Facture S5 avec le payeur : T_FACTURE_AVT en brouillon sur le marché de sous-traitance, paiement direct au rapport.
        var numero = "F" + Random.Shared.NextInt64(100_000_000, 999_999_999);
        var flux = await Relever(plateforme.RecevoirFacture(Encoding.UTF8.GetBytes(Facture(numero, sirenMoa)), $"{numero}.xml").IdFlux);
        Assert.Equal((EtatFlux.Traite, TypesElementFe.Document), (flux.Etat, flux.TypeElement));
        var ent = long.Parse(flux.IdElement!);
        Assert.Equal(TypesDocument.TFactureAvt, await Scalaire("SELECT t.tyd_code FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE d.ent_id = @e", ("e", ent)));
        Assert.Equal("BROUILLON", await Scalaire("SELECT s.std_code FROM document d JOIN statut_document s ON s.std_id = d.ent_std_id WHERE d.ent_id = @e", ("e", ent)));
        Assert.Equal((object)marche, await Scalaire("SELECT ent_marche_id FROM document WHERE ent_id = @e", ("e", ent)));
        Assert.Equal((object)chantier, await Scalaire("SELECT ent_chantier_id FROM document WHERE ent_id = @e", ("e", ent)));
        Assert.Equal((object)st, await Scalaire("SELECT ent_tiers_id FROM document WHERE ent_id = @e", ("e", ent)));
        Assert.Equal(("RECUE", 204.78m), ((string)(await Scalaire("SELECT ent_st_saisie FROM document WHERE ent_id = @e", ("e", ent)))!,
            (decimal)(await Scalaire("SELECT ent_st_recu_ht FROM document WHERE ent_id = @e", ("e", ent)))!));
        string? Rapport(string chemin, long e) => (string?)Scalaire($"SELECT dor_rapport #>> '{{{chemin}}}' FROM document_origine WHERE dor_ent_id = @e AND dor_type = 'IMPORT'", ("e", e)).Result;
        Assert.Equal(marche.ToString(System.Globalization.CultureInfo.InvariantCulture), Rapport("paiement_direct,marche", ent));
        Assert.Equal("DIRECT", Rapport("paiement_direct,mode", ent));
        Assert.Equal(sirenMoa, Rapport("paiement_direct,payeur,siren", ent));
        Assert.Equal(moa.ToString(System.Globalization.CultureInfo.InvariantCulture), Rapport("paiement_direct,maitre_ouvrage,id", ent));
        // Autoliquidation attendue (per_st_autoliquidation, défaut vrai) et TVA facturée (S, E) : écart signalé, pièce créée quand même.
        Assert.Equal($"[\"{EcartReception.AutoliquidationAbsente}\"]", await Scalaire("SELECT jsonb_path_query_array(dor_rapport, '$.ecarts[*].code')::text FROM document_origine WHERE dor_ent_id = @e", ("e", ent)));

        // 2. Statut 224 du sous-traitant : lu, enregistré sur le flux de la facture, tracé au journal de la pièce ; brouillon → pas encore de demande.
        var cdar = await Relever(plateforme.RecevoirStatut(Demande224(numero), $"{numero}_224.xml", TypeFlux.CdvFactureFournisseur).IdFlux);
        Assert.Equal(EtatFlux.Traite, cdar.Etat);
        Assert.Equal(1L, await Scalaire("SELECT count(*) FROM fe_statut WHERE fst_ffl_id = @f AND fst_code = @c AND fst_sens = @s",
            ("f", flux.Id), ("c", StatutCdv.DemandePaiementDirect), ("s", SensStatut.Recu)));
        Assert.Equal(1L, await Scalaire("""
            SELECT count(*) FROM fe_evenement WHERE fev_type = @t AND fev_type_element = @te AND fev_id_element = @e AND fev_detail->>'statut' = @c
            """, ("t", EvenementFe.StatutRecu), ("te", TypesElementFe.Document), ("e", ent.ToString(System.Globalization.CultureInfo.InvariantCulture)), ("c", StatutCdv.DemandePaiementDirect)));
        Assert.Equal(0L, await Scalaire("SELECT count(*) FROM stt_paiement_direct WHERE spd_facture_id = @e", ("e", ent)));
        // Validation (jamais automatique) : la demande reçue est enregistrée, reçue le jour du 224 ; montant HT (marché autoliquidé).
        await Valider(ent);
        Assert.Equal("DIRECT|RECUE|204.78", await Scalaire("SELECT spd_mode || '|' || spd_etat || '|' || spd_montant_demande FROM stt_paiement_direct WHERE spd_facture_id = @e AND spd_marche_id = @m",
            ("e", ent), ("m", marche)));
        Assert.Equal(true, await Scalaire("""
            SELECT p.spd_recue_le = (SELECT min(fst_date)::date FROM fe_statut WHERE fst_ffl_id = @f AND fst_code = '224') FROM stt_paiement_direct p WHERE p.spd_facture_id = @e
            """, ("e", ent), ("f", flux.Id)));

        // 3. Seconde facture, payeur autre que le maître d'ouvrage : écart ; validée avant son 224 → demande enregistrée à la réception du statut.
        var numero2 = "F" + Random.Shared.NextInt64(100_000_000, 999_999_999);
        var flux2 = await Relever(plateforme.RecevoirFacture(Encoding.UTF8.GetBytes(Facture(numero2, Siren())), $"{numero2}.xml").IdFlux);
        var ent2 = long.Parse(flux2.IdElement!);
        Assert.Contains(EcartReception.PayeurDifferent, (string)(await Scalaire("SELECT jsonb_path_query_array(dor_rapport, '$.ecarts[*].code')::text FROM document_origine WHERE dor_ent_id = @e", ("e", ent2)))!);
        await Valider(ent2);
        Assert.Equal(0L, await Scalaire("SELECT count(*) FROM stt_paiement_direct WHERE spd_facture_id = @e", ("e", ent2)));
        await Relever(plateforme.RecevoirStatut(Demande224(numero2), $"{numero2}_224.xml", TypeFlux.CdvFactureFournisseur).IdFlux);
        Assert.Equal("RECUE", await Scalaire("SELECT spd_etat FROM stt_paiement_direct WHERE spd_facture_id = @e", ("e", ent2)));
        // Un second 224 de la même facture : aucune seconde demande.
        await Relever(plateforme.RecevoirStatut(Demande224(numero2), $"{numero2}_224_bis.xml", TypeFlux.CdvFactureFournisseur).IdFlux);
        Assert.Equal(1L, await Scalaire("SELECT count(*) FROM stt_paiement_direct WHERE spd_facture_id = @e", ("e", ent2)));
    }
}
