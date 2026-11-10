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
    public void Avoirs_restent_a_traiter()
    {
        Assert.True(ReceptionFactureBtp.EstAvoir(TypeFacture.Avoir));
        Assert.False(ReceptionFactureBtp.EstAvoir(TypeFacture.Facture));
        Assert.False(ReceptionFactureBtp.EstAvoir(TypeFacture.Acompte));
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
        // Chronologie complète de la pièce : reçue, lue, pièce créée, rattachée.
        Assert.Equal([EvenementFe.Reception, EvenementFe.Lecture, EvenementFe.PieceCreee, EvenementFe.Rattachement], await Chronologie(ent));
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
}
