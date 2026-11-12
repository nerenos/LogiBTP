using System.Text;
using System.Text.Json.Nodes;
using LogiBTP.Annuaire.Web;
using LogiBTP.Api.Btp;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Editions;
using LogiBTP.Editions.Web;
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
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Émission à la validation (plans/facturation-electronique.md, lot 24) : règles sans base (hors flux 2, syntaxe, pastille,
/// état à la validation, bouton « Émettre », option Factur-X), Factur-X produit par le moteur d'édition dans Jint (PDF/A-3,
/// factur-x.xml relu ; référence tests/emission-fe/ecrits/FACTURE_FX.pdf contrôlée par l'outil du module dans
/// client/test/emission-facture.test.js, régénérée par LOGIBTP_REGENERER_EMISSION=1) ; de bout en bout sur la base jetable
/// (LOGIBTP_TEST_PG_JETABLE, manifeste chargé, écritures conservées) : facture validée → Factur-X en file, GED (étape ENVOI,
/// coffre), dépôt sur la plateforme simulée, Déposée puis Mise à disposition, chronologie, colonne des listes ; validation
/// refusée pour un client professionnel incomplet ; client particulier hors flux.
/// </summary>
[Collection(EnvoiFactureBtpTests.CollectionBase)]
public class EnvoiFactureBtpTests
{
    /// <summary>Tests qui émettent sur la base jetable (même client, même file) : jamais en parallèle.</summary>
    public const string CollectionBase = "Emission FE sur la base jetable";

    [Theory]
    [InlineData("B2B", "FR", true, null)]
    [InlineData("B2B", "FR", null, null)]
    [InlineData(null, null, null, null)]
    [InlineData("B2G", "FR", true, null)]
    [InlineData("B2B", "FR", false, MotifsEmissionFe.HorsAnnuaire)]
    [InlineData("B2C", "FR", true, MotifsEmissionFe.B2C)]
    [InlineData("INTERNATIONAL", "FR", null, MotifsEmissionFe.International)]
    [InlineData("B2B", "DE", true, MotifsEmissionFe.International)]
    public void Hors_flux_2_particulier_international_ou_absent_de_l_annuaire(string? type, string? pays, bool? annuaire, string? attendu) =>
        Assert.Equal(attendu, EnvoiFactureBtp.MotifHorsFlux(type, pays, annuaire));

    [Theory]
    [InlineData("FACTURX", Syntaxe.Cii, Syntaxe.FacturX)]
    [InlineData("ubl", Syntaxe.FacturX, Syntaxe.Ubl)]
    [InlineData("CII", Syntaxe.FacturX, Syntaxe.Cii)]
    [InlineData(null, Syntaxe.FacturX, Syntaxe.FacturX)]
    [InlineData("", Syntaxe.Ubl, Syntaxe.Ubl)]
    [InlineData(null, Syntaxe.Cdar, Syntaxe.Cii)]
    public void Syntaxe_du_tiers_sinon_des_parametres(string? tiers, string defaut, string attendu) =>
        Assert.Equal(attendu, EnvoiFactureBtp.SyntaxeDe(tiers, defaut));

    [Fact]
    public void Pastille_comme_la_colonne_des_listes()
    {
        Assert.Null(EnvoiFactureBtp.Pastille(null, null, null));
        Assert.Equal(PastillesEmissionFe.AEmettre, EnvoiFactureBtp.Pastille(EtatsEmissionFe.AEmettre, null, null));
        Assert.Equal(PastillesEmissionFe.Differee, EnvoiFactureBtp.Pastille(EtatsEmissionFe.Differee, null, null));
        Assert.Equal(PastillesEmissionFe.HorsFlux, EnvoiFactureBtp.Pastille(EtatsEmissionFe.HorsFlux, null, null));
        Assert.Equal(PastillesEmissionFe.EnFile, EnvoiFactureBtp.Pastille(EtatsEmissionFe.Emise, EtatFlux.Acquitte, null));
        Assert.Equal(PastillesEmissionFe.Erreur, EnvoiFactureBtp.Pastille(EtatsEmissionFe.Emise, EtatFlux.Erreur, null));
        Assert.Equal(PastillesEmissionFe.Erreur, EnvoiFactureBtp.Pastille(EtatsEmissionFe.Echec, null, null));
        Assert.Equal(StatutCdv.MiseADisposition, EnvoiFactureBtp.Pastille(EtatsEmissionFe.Emise, EtatFlux.Acquitte, StatutCdv.MiseADisposition));
    }

    [Fact]
    public void Etat_a_la_validation_et_bouton_emettre()
    {
        Assert.Equal(EtatsEmissionFe.AEmettre, EnvoiFactureBtp.EtatALaValidation(false, true));
        Assert.Equal(EtatsEmissionFe.Differee, EnvoiFactureBtp.EtatALaValidation(true, true));
        Assert.Equal(EtatsEmissionFe.Differee, EnvoiFactureBtp.EtatALaValidation(false, false));
        Assert.True(EnvoiFactureBtp.Emettable(true, true, null, null)); // validée avant l'activation du module
        Assert.True(EnvoiFactureBtp.Emettable(true, true, EtatsEmissionFe.Differee, null));
        Assert.True(EnvoiFactureBtp.Emettable(true, true, EtatsEmissionFe.Echec, null));
        Assert.True(EnvoiFactureBtp.Emettable(true, true, EtatsEmissionFe.HorsFlux, null));
        Assert.True(EnvoiFactureBtp.Emettable(true, true, EtatsEmissionFe.Emise, EtatFlux.Erreur));
        Assert.False(EnvoiFactureBtp.Emettable(true, true, EtatsEmissionFe.Emise, EtatFlux.Acquitte));
        Assert.False(EnvoiFactureBtp.Emettable(true, false, null, null)); // brouillon
        Assert.False(EnvoiFactureBtp.Emettable(false, true, null, null)); // type jamais émis
        Assert.Equal("F_2026_001_FX.pdf", EnvoiFactureBtp.NomFichier("F/2026/001", Syntaxe.FacturX));
        Assert.Equal("F1_UBL.xml", EnvoiFactureBtp.NomFichier("F1", Syntaxe.Ubl));
        Assert.Equal("F1_CII.xml", EnvoiFactureBtp.NomFichier("F1", Syntaxe.Cii));
    }

    private static string Ecrits(string nom) => CasPartages.Chemin("tests", "emission-fe", "ecrits", nom);

    /// <summary>
    /// Factur-X : CII de la facture de démonstration (lot 22) associé au PDF/A-3b du moteur d'édition (Jint), relu par le module
    /// (factur-x.xml de l'arbre EmbeddedFiles) au même numéro ; XMP Factur-X (fx, EN 16931) et relation Alternative.
    /// </summary>
    [Fact]
    public void Factur_X_produit_par_le_moteur_d_edition_relu_par_le_module()
    {
        var xml = File.ReadAllBytes(Ecrits("FACTURE_CII.xml"));
        var cas = JsonNode.Parse(File.ReadAllText(CasPartages.Chemin("modules", "edition", "tests", "cas", "05_pdfa.json")))!;
        var donnees = File.ReadAllText(CasPartages.Chemin("modules", "edition", "tests", cas["donnees"]!.GetValue<string>()));
        var env = cas["env"]!.DeepClone();
        env["pdf"]!["pdfa"] = EnvoiFactureBtp.OptionFacturX(xml, ProfilFacture.En16931);
        env["pdf"]!["titre"] = "Facture F202600001";
        var moteur = new MoteurEditionJs(MoteurEditionJs.ScriptEmbarque(), MoteurEditionJs.FacesLivrees());
        var pdf = moteur.Pdf(cas["modele"]!.ToJsonString(), donnees, env.ToJsonString()).Octets;

        var lue = Lecture.Lire(pdf);
        Assert.Equal(Syntaxe.FacturX, lue.Syntaxe);
        Assert.Equal(LectureCii.Lire(xml).Numero, lue.Facture.Numero);
        var texte = Encoding.Latin1.GetString(pdf);
        Assert.Contains("urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#", texte);
        Assert.Contains("<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>", texte);
        Assert.Contains("/AFRelationship /Alternative", texte);
        Assert.Contains("<pdfaid:part>3</pdfaid:part>", texte);
        if (Environment.GetEnvironmentVariable("LOGIBTP_REGENERER_EMISSION") == "1" || !File.Exists(Ecrits("FACTURE_FX.pdf")))
            File.WriteAllBytes(Ecrits("FACTURE_FX.pdf"), pdf);
        // Référence versionnée (contrôlée par l'outil du module) : même facture relue.
        Assert.Equal(lue.Facture.Numero, Lecture.Lire(File.ReadAllBytes(Ecrits("FACTURE_FX.pdf"))).Facture.Numero);
    }

    // ---------------------------------------------------------------- base jetable

    private sealed class Environnement(string racine) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Test";
        public string ApplicationName { get; set; } = "LogiBTP.Tests";
        public string ContentRootPath { get; set; } = racine;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    /// <summary>Plateforme simulée sans délai : accusé, puis Déposée, Émise, Reçue et Mise à disposition à la consultation suivante.</summary>
    private static readonly OptionsPlateformeSimulee Simulation = new()
    {
        DelaiAccuse = TimeSpan.Zero, IntervalleStatuts = TimeSpan.Zero,
        Statuts =
        [
            new(StatutCdv.Deposee, EmetteurStatut.PaE), new(StatutCdv.Emise, EmetteurStatut.PaE),
            new(StatutCdv.Recue, EmetteurStatut.PaR), new(StatutCdv.MiseADisposition, EmetteurStatut.PaR),
        ],
    };

    /// <summary>Services de l'émission sur une base (plateforme simulée <paramref name="simulation"/>, horloge <paramref name="horloge"/>).</summary>
    internal static ServiceProvider Services(string connexion, OptionsPlateformeSimulee? simulation = null, TimeProvider? horloge = null)
    {
        var s = new ServiceCollection();
        if (horloge is not null) s.AddSingleton(horloge);
        var racine = Path.Combine(Path.GetTempPath(), "logibtp-envoi-" + Guid.NewGuid().ToString("N"));
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
        s.AddModuleFactureElectronique<SpecialisationFactureElectroniqueBtp>(Base, null, simulation ?? Simulation);
        s.AddModuleReglement<SpecialisationReglementBtp>(Base);
        s.AddModuleEdition<SpecialisationEditionBtp>(Base, 1);
        s.AddScoped<ModulesSociete>();
        return s.BuildServiceProvider();
    }

    [Fact]
    public async Task Facture_validee_emise_en_Factur_X_deposee_puis_mise_a_disposition()
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
        if (await Scalaire("SELECT to_regclass('document_fe_emission')::text") is null) return;
        await Scalaire("UPDATE module_societe SET mod_actif = TRUE WHERE mod_code = 'facture_electronique'");
        await Scalaire("UPDATE facture_electronique_emission_option SET feo_automatique = TRUE");
        await using var services = Services(connexion);
        var admin = new Utilisateur("admin.test", Profils.Admin);
        using (var scope = services.CreateScope())
        {
            var fe = scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>();
            var p = await fe.Parametres(default);
            await fe.EnregistrerParametres(p with { Connecteur = ConnecteurFe.Simule, Actif = true, AdresseFlux = null, ConnexionOauth = null, StatutsNonEnvoyes = [] }, admin, default);
            // Base jetable : flux et émissions restés des passages précédents traités d'abord.
            await new FileFlux(fe).TraiterAsync(100, default);
            await new ReleveFlux(fe).ReleverAsync(true, null, default);
        }
        await Scalaire("UPDATE document_fe_emission SET dfe_etat = 'DIFFEREE' WHERE dfe_etat = 'A_EMETTRE'");

        // Client professionnel complet de la démonstration (SIREN, adresse), présent dans l'annuaire, format Factur-X.
        var client = (long)(await Scalaire("""
            SELECT per_id FROM personne WHERE NOT per_societe_base AND per_siren ~ '^[0-9]{9}$' AND per_pays = 'FR' AND per_niv_code = 'SOCIETE'
              AND per_siren <> (SELECT per_siren FROM personne WHERE per_societe_base LIMIT 1) ORDER BY per_id LIMIT 1
            """))!;
        await Scalaire("UPDATE personne SET per_fe_type = 'B2B', per_fe_dans_annuaire = TRUE, per_fe_format = 'FACTURX' WHERE per_id = @p", ("p", client));

        async Task<long> Brouillon(long tiers)
        {
            return (long)(await Scalaire("""
                WITH d AS (INSERT INTO document (ent_tyd_id, ent_date, ent_std_id, ent_tiers_id, ent_cree_par, ent_total_ht, ent_total_tva,
                                                 ent_total_ttc, ent_net_a_payer, ent_cpa_code, ent_mode_reglement, ent_objet)
                    SELECT t.tyd_id, current_date, (SELECT std_id FROM statut_document WHERE std_code = 'BROUILLON' AND std_tyd_id = t.tyd_id),
                           @tiers, 'test', 150, 30, 180, 180, '30J', 'CHEQUE', 'Essai lot 24'
                    FROM type_document t WHERE t.tyd_code = 'V_FACTURE' RETURNING ent_id),
                l AS (INSERT INTO document_ligne (lig_ent_id, lig_ordre, lig_tyl_id, lig_libelle_html, lig_libelle_brut, lig_qte, lig_qte_vendue, lig_pv,
                                                  lig_pv_remise, lig_montant_ht, lig_tva_id, lig_taux_tva, lig_type_prix, lig_unt_code, lig_pv_fixe, lig_nat_id)
                    SELECT ent_id, 1, 3, 'Travaux', 'Travaux', 3, 3, 50, 50, 150, 1, 20, 'V', 'h', TRUE, (SELECT nat_id FROM nature_element ORDER BY nat_id LIMIT 1) FROM d RETURNING lig_ent_id),
                t AS (INSERT INTO document_tva (tva_ent_id, tva_ttv_id, tva_code, tva_taux, tva_categorie, tva_base_ht, tva_montant, tva_montant_annulation, tva_montant_net)
                    SELECT DISTINCT lig_ent_id, 1, 'T20', 20, 'N', 150, 30, 0, 30 FROM l RETURNING tva_ent_id)
                SELECT tva_ent_id FROM t
                """, ("tiers", tiers)))!;
        }
        async Task Valider(long ent)
        {
            using var scope = services.CreateScope();
            var documents = scope.ServiceProvider.GetRequiredService<DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>();
            var version = (int)(await Scalaire("SELECT ent_version FROM document WHERE ent_id = @e", ("e", ent)))!;
            await documents.Valider(ent, new DemandeVersion { EntVersion = version }, admin, default);
        }

        // 1. Facture validée : inscrite à émettre dans la transaction de la validation, puis émise par la tâche de fond.
        var ent = await Brouillon(client);
        await Valider(ent);
        Assert.Equal(EtatsEmissionFe.AEmettre, await Scalaire("SELECT dfe_etat FROM document_fe_emission WHERE dfe_ent_id = @e", ("e", ent)));
        Assert.Equal(PastillesEmissionFe.AEmettre, await Scalaire("SELECT statut_fe FROM v_liste_documents WHERE id = @e", ("e", ent)));
        using (var scope = services.CreateScope()) Assert.True(await EnvoiFactureBtp.TraiterAsync(scope.ServiceProvider, 10, default) >= 1);
        EtatEnvoiFe etat;
        using (var scope = services.CreateScope()) etat = await EnvoiFactureBtp.EtatAsync(scope.ServiceProvider.GetRequiredService<LogiBtpContext>(), ent, default);
        Assert.True(etat.Erreur is null, etat.Erreur);
        Assert.Equal((EtatsEmissionFe.Emise, Syntaxe.FacturX, PastillesEmissionFe.EnFile, false), (etat.Etat, etat.Syntaxe, etat.Pastille, etat.Emettable));
        var fluxId = etat.FluxId!.Value;

        // Factur-X lisible par le module (numéro de la pièce validée), rangé en GED de la pièce à l'étape ENVOI et au coffre.
        var numero = (string)(await Scalaire("SELECT ent_numero FROM document WHERE ent_id = @e", ("e", ent)))!;
        var contenu = (byte[])(await Scalaire("SELECT ffi_contenu FROM fe_fichier WHERE ffi_ffl_id = @f AND ffi_document = 'Original'", ("f", fluxId)))!;
        var lue = Lecture.Lire(contenu);
        Assert.Equal((Syntaxe.FacturX, numero), (lue.Syntaxe, lue.Facture.Numero));
        var ged = (long)(await Scalaire("SELECT ffl_ged_original_id FROM fe_flux WHERE ffl_id = @f", ("f", fluxId)))!;
        Assert.Equal(EtapesGed.Envoi, await Scalaire("SELECT vge_etape FROM version_ged WHERE vge_document = @g ORDER BY vge_id DESC LIMIT 1", ("g", ged)));
        Assert.Equal(true, await Scalaire("SELECT dge_coffre FROM document_ged WHERE dge_id = @g", ("g", ged)));
        if (Environment.GetEnvironmentVariable("LOGIBTP_REGENERER_EMISSION") == "1") File.WriteAllBytes(Ecrits("VALIDEE_FX.pdf"), contenu);

        // 2. Dépôt sur la plateforme simulée, accusé, Déposée → Mise à disposition (relève), statut recopié sur la pièce.
        using (var scope = services.CreateScope())
        {
            var fe = scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>();
            await new FileFlux(fe).TraiterAsync(100, default);
            for (var i = 0; i < 4; i++) await new ReleveFlux(fe).ReleverAsync(true, null, default);
            var d = await fe.Detail(fluxId, default);
            Assert.Equal(EtatFlux.Acquitte, d.Flux.Etat);
            Assert.Equal([StatutCdv.Deposee, StatutCdv.Emise, StatutCdv.Recue, StatutCdv.MiseADisposition], d.Statuts.OrderBy(s => s.Id).Select(s => s.Code));
            Assert.Equal(StatutCdv.MiseADisposition, d.Flux.StatutAffiche);
            var chronologie = (await fe.Chronologie(null, TypesElementFe.Document, ent.ToString(), default)).Select(e => e.Type).ToList();
            Assert.Equal([EvenementFe.Production, EvenementFe.Depot, EvenementFe.Accuse], chronologie.Where(t => t != EvenementFe.StatutRecu).Take(3));
            Assert.Equal(4, chronologie.Count(t => t == EvenementFe.StatutRecu));
        }
        Assert.Equal(StatutCdv.MiseADisposition, await Scalaire("SELECT statut_fe FROM v_liste_documents WHERE id = @e", ("e", ent)));
        using (var scope = services.CreateScope())
        {
            var e = await Assert.ThrowsAsync<ExceptionMetier>(() => EnvoiFactureBtp.EmettreAsync(scope.ServiceProvider, ent, admin, default));
            Assert.Equal(ErreursEmissionFe.DejaEmise, e.Code);
        }

        // 3. Client professionnel sans SIREN : validation refusée (Q5) ; passé particulier : validée, envoi habituel (hors flux).
        var incomplet = (long)(await Scalaire("""
            INSERT INTO personne (per_raison_sociale, per_niv_code, per_pays, per_fe_type) VALUES ('Client incomplet lot 24', 'SOCIETE', 'FR', 'B2B') RETURNING per_id
            """))!;
        var refusee = await Brouillon(incomplet);
        var refus = await Assert.ThrowsAsync<ExceptionMetier>(() => Valider(refusee));
        Assert.Equal("VALIDATION", refus.Code);
        Assert.Contains(ErreursEmissionFe.Incomplete, System.Text.Json.JsonSerializer.Serialize(refus.Details));
        await Scalaire("UPDATE personne SET per_fe_type = 'B2C' WHERE per_id = @p", ("p", incomplet));
        await Valider(refusee);
        using (var scope = services.CreateScope())
        {
            await EnvoiFactureBtp.TraiterAsync(scope.ServiceProvider, 10, default);
            etat = await EnvoiFactureBtp.EtatAsync(scope.ServiceProvider.GetRequiredService<LogiBtpContext>(), refusee, default);
        }
        Assert.Equal((EtatsEmissionFe.HorsFlux, MotifsEmissionFe.B2C, (long?)null), (etat.Etat, etat.Motif, etat.FluxId));
    }
}
