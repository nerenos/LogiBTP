using System.Text;
using System.Text.Json.Nodes;
using LogiBTP.FactureElectronique.Formats;
using LogiBTP.FactureElectronique.Web;
using LogiBTP.FactureElectronique.Web.Connecteurs;
using LogiBTP.Socle.Web;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace LogiBTP.FactureElectronique.Tests;

/// <summary>
/// Connecteur AFNOR XP Z12-013 contre une PA de test locale (<see cref="ServeurAfnorTest"/>, Kestrel sur 127.0.0.1) :
/// codes alignés sur les swaggers 1.3.0, dépôt multipart, recherche paginée, trois docType, annuaire, erreurs 400–503,
/// délai, jeton jamais journalisé, connecteur propre à une PA par surcharge.
/// </summary>
public sealed class ConnecteurAfnorTests : IAsyncLifetime
{
    private static readonly DateTimeOffset Depart = new(2026, 11, 9, 8, 0, 0, TimeSpan.Zero);
    private readonly HorlogeTest horloge = new(Depart);
    private readonly HttpClient http = new();
    private readonly JetonsTest jetons = new();
    private readonly JournalTest journal = new();
    private ServeurAfnorTest serveur = null!;

    public async Task InitializeAsync() =>
        serveur = await ServeurAfnorTest.DemarrerAsync(new PlateformeSimulee(new MagasinFluxMemoire(), horloge,
            new OptionsPlateformeSimulee { DelaiAccuse = TimeSpan.Zero }));

    public async Task DisposeAsync()
    {
        await serveur.DisposeAsync();
        http.Dispose();
    }

    private ParametresConnecteur Parametres => new(ConnecteurFe.Afnor, "societe_test")
    {
        AdresseFlux = serveur.AdresseFlux, AdresseAnnuaire = serveur.AdresseAnnuaire, ConnexionOAuth = 7, Organisation = "ORG-100000009",
    };

    private ConnecteurAfnor Connecteur(ParametresConnecteur? p = null) => new(p ?? Parametres, http, jetons, journal);

    internal static byte[] Exemple(params string[] chemin) => File.ReadAllBytes(LectureCiiTests.Dossier(chemin));

    internal static readonly string[] Cii = ["cii", "en16931", "UC1_F202500003_00-INV_20250701_EN16931_FX_CII_Commentee.xml"];
    internal static readonly string[] FacturX = ["factur-x", "en16931", "UC1_F202500003_00-INV_20250701_EN16931_FX.pdf"];

    private static FluxADeposer Facture(string[] chemin, string syntaxe, string? suivi = null) =>
        new(Exemple(chemin), chemin[^1], syntaxe) { Profil = ProfilFacture.En16931, RegleTraitement = RegleTraitement.B2B, IdentifiantSuivi = suivi };

    // ---------------------------------------------------------------- contrat des swaggers

    public static TheoryData<string, string, Type> Enumerations() => new()
    {
        { "flux", "FlowSyntax", typeof(Syntaxe) },
        { "flux", "FlowProfile", typeof(ProfilFacture) },
        { "flux", "ProcessingRule", typeof(RegleTraitement) },
        { "flux", "FlowType", typeof(TypeFlux) },
        { "flux", "FlowDirection", typeof(SensFlux) },
        { "flux", "FlowAckStatus", typeof(EtatAccuse) },
        { "flux", "ReasonCodeEnum", typeof(MotifAccuse) },
        { "annuaire", "recipientPlatformType", typeof(TypePlateformeAnnuaire) },
        { "annuaire", "directoryLineStatus", typeof(EtatLigneAnnuaire) },
        { "annuaire", "containsOrStrictOrStartWithOperator", typeof(OperateurAnnuaire) },
    };

    private static string[] Valeurs(Type t) =>
        [.. t.GetFields().Where(f => f.IsLiteral && f.FieldType == typeof(string)).Select(f => (string)f.GetRawConstantValue()!)];

    [Theory]
    [MemberData(nameof(Enumerations))]
    public void Codes_identiques_aux_enumerations_des_swaggers(string service, string schema, Type codes) =>
        Assert.Equal(Swaggers.Enum(service == "flux" ? Swaggers.Flux : Swaggers.Annuaire, schema).Order(), Valeurs(codes).Order());

    [Fact]
    public void Codes_des_documents_et_de_l_origine_de_la_regle_identiques_au_swagger()
    {
        var docType = Swaggers.Flux["paths"]!["/v1/flows/{flowId}"]!["get"]!["parameters"]!.AsArray()
            .First(p => p!["name"]!.GetValue<string>() == "docType")!["schema"]!["enum"]!.AsArray().Select(v => v!.GetValue<string>());
        Assert.Equal(docType.Order(), Valeurs(typeof(TypeDocumentFlux)).Order());
        var origine = Swaggers.Flux["components"]!["schemas"]!["FlowExtension"]!["properties"]!["processingRuleSource"]!["enum"]!.AsArray()
            .Select(v => v!.GetValue<string>());
        Assert.Equal(origine.Order(), Valeurs(typeof(OrigineRegle)).Order());
        var niveaux = Swaggers.Flux["components"]!["schemas"]!["AcknowledgementDetail"]!["properties"]!["level"]!["enum"]!.AsArray()
            .Select(v => v!.GetValue<string>());
        Assert.Equal(niveaux.Order(), Valeurs(typeof(NiveauAccuse)).Order());
    }

    // ---------------------------------------------------------------- dépôt

    [Fact]
    public async Task Depot_multipart_avec_flowInfo_json_file_sha256_et_en_tetes()
    {
        var flux = Facture(Cii, Syntaxe.Cii, "LOGIBTP-F202500003");
        var d = await Connecteur().DeposerAsync(flux);

        var r = Assert.Single(serveur.Requetes);
        Assert.Equal("POST", r.Methode);
        Assert.Equal("/pa/flow-service/v1/flows", r.Chemin);
        Assert.True(Swaggers.Chemin(Swaggers.Flux, "POST", "/v1/flows"));
        Assert.True(Guid.TryParse(r.RequestId, out _));
        Assert.Equal("ORG-100000009", r.Organisation);
        Assert.StartsWith("multipart/form-data", r.TypeContenu);
        Assert.Equal("application/json", r.TypeInfoFlux);
        Assert.Equal("application/xml", r.TypeFichier);
        Assert.Equal(flux.Nom, r.NomFichier);
        Assert.Equal(flux.Contenu, r.Fichier);
        var info = r.InfoFlux!.AsObject();
        Assert.Equal(ConnecteurPlateforme.Empreinte(flux.Contenu), info["sha256"]!.GetValue<string>());
        Assert.Equal(["flowProfile", "flowSyntax", "name", "processingRule", "sha256", "trackingId"], info.Select(p => p.Key).Order());
        Assert.Equal("CII", info["flowSyntax"]!.GetValue<string>());

        Assert.False(string.IsNullOrEmpty(d.IdFlux));
        Assert.Equal(Depart, d.DeposeLe);
        Assert.Equal("LOGIBTP-F202500003", d.IdentifiantSuivi);
        Assert.Equal(ConnecteurPlateforme.Empreinte(flux.Contenu), d.Empreinte);
        Assert.Equal(1, jetons.Demandes);

        var meta = await Connecteur().FluxAsync(d.IdFlux);
        Assert.Equal(EtatAccuse.Ok, meta.Accuse.Etat);
        Assert.Equal(TypeFlux.FactureClient, meta.Type);
        Assert.Equal(SensFlux.Sortant, meta.Sens);
        Assert.Equal(OrigineRegle.Fournie, meta.OrigineRegle);
        Assert.Contains("docType=Metadata", serveur.Requetes.Last().Requete);
    }

    [Fact]
    public async Task Depot_factur_x_en_application_pdf_et_accuse_error_du_doublon()
    {
        var c = Connecteur();
        await c.DeposerAsync(Facture(FacturX, Syntaxe.FacturX, "SUIVI-1"));
        Assert.Equal("application/pdf", serveur.Requetes.Last().TypeFichier);
        var doublon = await c.DeposerAsync(Facture(FacturX, Syntaxe.FacturX, "SUIVI-1"));
        var meta = await c.FluxAsync(doublon.IdFlux);
        Assert.Equal(EtatAccuse.Erreur, meta.Accuse.Etat);
        var detail = Assert.Single(meta.Accuse.Details);
        Assert.Equal((NiveauAccuse.Erreur, "trackingId", MotifAccuse.FluxExistant), (detail.Niveau, detail.Element, detail.Motif));
    }

    [Fact]
    public async Task Demande_invalide_refusee_avant_tout_envoi()
    {
        var c = Connecteur();
        async Task Refus(Func<Task> appel) => Assert.Equal(ErreurFe.DemandeInvalide, (await Assert.ThrowsAsync<ExceptionConnecteur>(appel)).Code);
        await Refus(() => c.DeposerAsync(new FluxADeposer([], "vide.xml", Syntaxe.Cii)));
        await Refus(() => c.DeposerAsync(new FluxADeposer([1], new string('n', 256), Syntaxe.Cii)));
        await Refus(() => c.DeposerAsync(new FluxADeposer([1], "f.xml", "PDF")));
        await Refus(() => c.DeposerAsync(new FluxADeposer([1], "f.xml", Syntaxe.Cii) { IdentifiantSuivi = new string('s', 65) }));
        await Refus(() => c.RechercherAsync(new CriteresFlux()));
        await Refus(() => c.RechercherAsync(new CriteresFlux { Sens = [SensFlux.Entrant] }, limite: 101));
        await Refus(() => c.TelechargerAsync("id", "Pdf"));
        await Refus(() => c.TelechargerAsync("id", TypeDocumentFlux.Metadonnees));
        await Refus(() => c.UniteLegaleAsync("12345678"));
        await Refus(() => c.EtablissementAsync("1234567890123A"));
        await Refus(() => c.CodeRoutageAsync("12345678901234", "code avec espace"));
        await Refus(() => c.RechercherLignesAnnuaireAsync(new RechercheAnnuaire([])));
        await Refus(() => c.AbonnerAsync(new DemandeAbonnement(new Uri("http://exemple.test/rappel"))));
        Assert.Empty(serveur.Requetes);
        Assert.Equal(0, jetons.Demandes);
    }

    // ---------------------------------------------------------------- recherche paginée

    [Fact]
    public async Task Recherche_paginee_par_curseur_et_relève_suivante()
    {
        var c = Connecteur();
        for (var i = 0; i < 5; i++) await c.DeposerAsync(Facture(Cii, Syntaxe.Cii, $"SUIVI-{i}") with { RegleTraitement = null });
        var criteres = new CriteresFlux { Sens = [SensFlux.Sortant], Types = [TypeFlux.FactureClient], ModifieApres = Depart.AddDays(-1) };

        var p1 = await c.RechercherAsync(criteres, limite: 2);
        Assert.Equal(2, p1.Flux.Count);
        Assert.NotNull(p1.CurseurSuivant);
        var corps = serveur.Requetes.Last().Corps!.AsObject();
        Assert.Equal(2, corps["limit"]!.GetValue<int>());
        Assert.Null(corps["cursor"]);
        Assert.Equal(["Out"], corps["where"]!["flowDirection"]!.AsArray().Select(v => v!.GetValue<string>()));
        Assert.Equal("2026-11-08T08:00:00.000Z", corps["where"]!["updatedAfter"]!.GetValue<string>());

        var p2 = await c.RechercherAsync(criteres, p1.CurseurSuivant, 2);
        Assert.Equal(p1.CurseurSuivant, serveur.Requetes.Last().Corps!["cursor"]!.GetValue<string>());
        var p3 = await c.RechercherAsync(criteres, p2.CurseurSuivant, 2);
        Assert.Single(p3.Flux);
        Assert.Null(p3.CurseurSuivant);
        Assert.Equal(5, p1.Flux.Concat(p2.Flux).Concat(p3.Flux).Select(f => f.IdFlux).Distinct().Count());
        Assert.All(p1.Flux, f => Assert.Equal(OrigineRegle.Calculee, f.OrigineRegle));

        var (tous, curseur) = await c.RechercherToutAsync(criteres, limite: 2);
        Assert.Equal(5, tous.Count);
        Assert.Equal(p2.CurseurSuivant, curseur);
        // Relève suivante depuis le dernier curseur : rien de nouveau hormis la dernière page déjà lue (idempotente).
        var (encore, _) = await c.RechercherToutAsync(criteres, curseur, 2);
        Assert.Equal(p3.Flux.Select(f => f.IdFlux), encore.Select(f => f.IdFlux));
        Assert.All(serveur.Requetes.Where(r => r.Chemin.EndsWith("/search", StringComparison.Ordinal)),
            r => Assert.True(Swaggers.Chemin(Swaggers.Flux, "POST", "/v1/flows/search")));
    }

    // ---------------------------------------------------------------- téléchargement

    [Fact]
    public async Task Telechargement_des_trois_docType()
    {
        var c = Connecteur();
        var pdf = Exemple(FacturX);
        var d = await c.DeposerAsync(Facture(FacturX, Syntaxe.FacturX));

        var original = await c.TelechargerAsync(d.IdFlux, TypeDocumentFlux.Original);
        Assert.Equal(pdf, original.Contenu);
        Assert.Equal(FacturX[^1], original.Nom);
        Assert.Contains("docType=Original", serveur.Requetes.Last().Requete);

        var converti = await c.TelechargerAsync(d.IdFlux, TypeDocumentFlux.Converti);
        Assert.Equal(ExtractionFacturX.Extraire(pdf), converti.Contenu);
        Assert.Equal(Syntaxe.Cii, Lecture.Detecter(converti.Contenu));
        Assert.Contains("docType=Converted", serveur.Requetes.Last().Requete);

        var lisible = await c.TelechargerAsync(d.IdFlux, TypeDocumentFlux.Lisible);
        Assert.Contains("F202500003", Encoding.UTF8.GetString(lisible.Contenu));
        Assert.Contains("docType=ReadableView", serveur.Requetes.Last().Requete);
        Assert.All(serveur.Requetes.Where(r => r.Methode == "GET"), r => Assert.True(Swaggers.Chemin(Swaggers.Flux, "GET", r.Chemin["/pa/flow-service".Length..])));

        // CII seul : pas de document converti → 404.
        var cii = await c.DeposerAsync(Facture(Cii, Syntaxe.Cii));
        var e = await Assert.ThrowsAsync<ExceptionConnecteur>(() => c.TelechargerAsync(cii.IdFlux, TypeDocumentFlux.Converti));
        Assert.Equal((ErreurFe.RessourceIntrouvable, 404, "MISSING_RESOURCE"), (e.Code, e.StatutHttp, e.CodePlateforme));
    }

    // ---------------------------------------------------------------- annuaire

    private void Annuaire()
    {
        var a = serveur.Plateforme.Annuaire;
        a.Ajouter(new UniteLegale("200000008", "MAITRE D'OUVRAGE", "PrivateVatRegistered", "A"));
        a.Ajouter(new Etablissement("20000000800014", "200000008", "SIEGE", "P", "A",
            new AdresseAnnuaire("1 RUE DU CHANTIER", null, null, "75001", null, "PARIS", "FR", null), new DonneesB2g(false, null, true, false, null, null), null));
        a.Ajouter(new CodeRoutage("SERVICE-TRAVAUX", "20000000800014", "0224", "SERVICE TRAVAUX", true, "A", null));
        a.Ajouter(new LigneAnnuaire("200000008_20000000800014_SERVICE-TRAVAUX", TypePlateformeAnnuaire.Pa, EtatLigneAnnuaire.Active, "200000008",
            "20000000800014", "SERVICE-TRAVAUX", null));
        a.Ajouter(new LigneAnnuaire("200000008", TypePlateformeAnnuaire.Pa, EtatLigneAnnuaire.Active, "200000008", null, null, null));
    }

    [Fact]
    public async Task Annuaire_unite_legale_etablissement_code_de_routage_et_lignes()
    {
        Annuaire();
        var c = Connecteur();
        var u = await c.UniteLegaleAsync("200000008");
        Assert.Equal(("MAITRE D'OUVRAGE", "PrivateVatRegistered", "A"), (u.RaisonSociale, u.TypeEntite, u.EtatAdministratif));
        Assert.Equal("/pa/directory-service/v1/siren/code-insee:200000008", serveur.Requetes.Last().Chemin);

        var e = await c.EtablissementAsync("20000000800014");
        Assert.Equal(("SIEGE", "P", "PARIS", true), (e.Nom, e.TypeEtablissement, e.Adresse?.Localite, e.DonneesB2g?.GereStatutPaiement));
        Assert.Equal("MAITRE D'OUVRAGE", e.UniteLegale?.RaisonSociale);
        Assert.Equal("?include=siren", serveur.Requetes.Last().Requete);

        var code = await c.CodeRoutageAsync("20000000800014", "SERVICE-TRAVAUX");
        Assert.Equal(("SERVICE TRAVAUX", true), (code.Nom, code.GereEngagement));

        var l = await c.LigneAnnuaireAsync("200000008_20000000800014_SERVICE-TRAVAUX");
        Assert.Equal((TypePlateformeAnnuaire.Pa, EtatLigneAnnuaire.Active, "SERVICE-TRAVAUX"), (l.TypePlateforme, l.Etat, l.CodeRoutage?.IdentifiantRoutage));
        Assert.Equal("SIEGE", l.Etablissement?.Nom);

        var lignes = await c.RechercherLignesAnnuaireAsync(new RechercheAnnuaire([new FiltreAnnuaire("siren", "200000008")]) { Limite = 1 });
        Assert.Equal(2, lignes.Total);
        Assert.Single(lignes.Resultats);
        var corps = serveur.Requetes.Last().Corps!.AsObject();
        Assert.Equal("strict", corps["filters"]!["siren"]!["op"]!.GetValue<string>());
        Assert.Equal(1, corps["limit"]!.GetValue<int>());

        var unites = await c.RechercherUnitesLegalesAsync(new RechercheAnnuaire([new FiltreAnnuaire("businessName", "OUVRAGE", OperateurAnnuaire.Contient)]));
        Assert.Equal("200000008", Assert.Single(unites.Resultats).Siren);
        var etabs = await c.RechercherEtablissementsAsync(new RechercheAnnuaire([new FiltreAnnuaire("postalCode", "75", OperateurAnnuaire.CommencePar)]));
        Assert.Single(etabs.Resultats);
        var codes = await c.RechercherCodesRoutageAsync(new RechercheAnnuaire([new FiltreAnnuaire("siret", "20000000800014")]));
        Assert.Single(codes.Resultats);

        Assert.All(serveur.Requetes, r => Assert.True(Swaggers.Chemin(Swaggers.Annuaire, r.Methode, r.Chemin["/pa/directory-service".Length..]), r.Chemin));
        var absent = await Assert.ThrowsAsync<ExceptionConnecteur>(() => c.UniteLegaleAsync("999999999"));
        Assert.Equal(ErreurFe.RessourceIntrouvable, absent.Code);
    }

    // ---------------------------------------------------------------- erreurs

    [Theory]
    [InlineData(400, "MISSING_REQUIRED_FIELD", ErreurFe.RequeteRefusee, false)]
    [InlineData(401, "MISSING_TOKEN", ErreurFe.NonAuthentifie, false)]
    [InlineData(403, "FORBIDDEN_ACCESS", ErreurFe.AccesRefusePlateforme, false)]
    [InlineData(404, "MISSING_RESOURCE", ErreurFe.RessourceIntrouvable, false)]
    [InlineData(408, "TIMEOUT", ErreurFe.DelaiDepasse, true)]
    [InlineData(413, "FILE_SIZE_EXCEEDED", ErreurFe.FichierTropGros, false)]
    [InlineData(422, "UNPROCESSABLE_ENTITY", ErreurFe.DonneesIncoherentes, false)]
    [InlineData(429, "TOO_MANY_REQUESTS", ErreurFe.TropDeRequetes, true)]
    [InlineData(500, "INTERNAL_ERROR", ErreurFe.ErreurPlateforme, true)]
    [InlineData(501, "NOT_IMPLEMENTED", ErreurFe.FonctionNonPriseEnCharge, false)]
    [InlineData(503, "RESOURCE_ERROR", ErreurFe.PlateformeIndisponible, true)]
    public async Task Erreurs_400_a_503_traduites_en_codes(int statut, string codePa, string code, bool reessayable)
    {
        serveur.Forcer.Enqueue((statut, codePa, "token=fuite-0001 dans le message"));
        var e = await Assert.ThrowsAsync<ExceptionConnecteur>(() => Connecteur().DeposerAsync(Facture(Cii, Syntaxe.Cii)));
        Assert.Equal((code, statut, codePa, reessayable), (e.Code, e.StatutHttp, e.CodePlateforme, e.Reessayable));
        Assert.Equal(serveur.Requetes.Last().RequestId, e.RequestId);
        Assert.DoesNotContain("fuite-0001", e.Message);
    }

    [Fact]
    public async Task En_tete_absent_et_curseur_inconnu_refuses()
    {
        var c = Connecteur();
        // Le serveur rend 400 (Request-Id manquant) : un connecteur dérivé qui oublie l'en-tête est refusé.
        var sans = new SansRequestId(Parametres, http, jetons);
        Assert.Equal(ErreurFe.RequeteRefusee, (await Assert.ThrowsAsync<ExceptionConnecteur>(() => sans.FluxAsync("x"))).Code);
        var e = await Assert.ThrowsAsync<ExceptionConnecteur>(() => c.RechercherAsync(new CriteresFlux { Sens = [SensFlux.Entrant] }, "inconnu"));
        Assert.Equal((ErreurFe.RequeteRefusee, 400), (e.Code, e.StatutHttp));
    }

    private sealed class SansRequestId(ParametresConnecteur p, HttpClient h, IFournisseurJeton j) : ConnecteurAfnor(p, h, j)
    {
        protected override async Task PreparerAsync(HttpRequestMessage requete, string requestId, CancellationToken ct)
        {
            await base.PreparerAsync(requete, requestId, ct);
            requete.Headers.Remove("Request-Id");
        }
    }

    [Fact]
    public async Task Delai_depasse_et_plateforme_injoignable()
    {
        serveur.Attente = TimeSpan.FromSeconds(5);
        var lent = Connecteur(Parametres with { Delai = TimeSpan.FromMilliseconds(200) });
        var e = await Assert.ThrowsAsync<ExceptionConnecteur>(() => lent.FluxAsync("x"));
        Assert.Equal((ErreurFe.DelaiDepasse, true), (e.Code, e.Reessayable));
        serveur.Attente = TimeSpan.Zero;

        // Port fermé de la machine locale : aucun accès réseau extérieur.
        var ferme = Connecteur(Parametres with { AdresseFlux = new Uri("http://127.0.0.1:9/flow-service") });
        e = await Assert.ThrowsAsync<ExceptionConnecteur>(() => ferme.FluxAsync("x"));
        Assert.Equal((ErreurFe.PlateformeIndisponible, true), (e.Code, e.Reessayable));
        var sante = await ferme.SanteAsync();
        Assert.False(sante.Disponible);
        Assert.Equal(ErreurFe.PlateformeIndisponible, sante.Code);
    }

    [Fact]
    public async Task Sante_abonnement_et_parametres_absents()
    {
        var c = Connecteur();
        Assert.True((await c.SanteAsync()).Disponible);
        Assert.Equal("/pa/flow-service/v1/healthcheck", serveur.Requetes.Last().Chemin);
        var a = await c.AbonnerAsync(new DemandeAbonnement(new Uri("https://logibtp.test/rappel")) { Types = [TypeFlux.CdvFactureClient], Sens = SensFlux.Entrant });
        Assert.False(string.IsNullOrEmpty(a.Id));
        Assert.Equal("https://logibtp.test/rappel", serveur.Requetes.Last().Corps!["callbackUrl"]!.GetValue<string>());

        var sansConnexion = Connecteur(Parametres with { ConnexionOAuth = null });
        Assert.Equal(ErreurFe.ParametreConnecteur, (await Assert.ThrowsAsync<ExceptionConnecteur>(() => sansConnexion.FluxAsync("x"))).Code);
        var sansAdresse = Connecteur(Parametres with { AdresseAnnuaire = null });
        Assert.Equal(ErreurFe.ParametreConnecteur, (await Assert.ThrowsAsync<ExceptionConnecteur>(() => sansAdresse.UniteLegaleAsync("200000008"))).Code);
        var mauvaisJeton = new ConnecteurAfnor(Parametres, http, new JetonsTest("autre"));
        Assert.Equal(ErreurFe.NonAuthentifie, (await Assert.ThrowsAsync<ExceptionConnecteur>(() => mauvaisJeton.FluxAsync("x"))).Code);
    }

    [Fact]
    public async Task Jeton_jamais_journalise()
    {
        var c = Connecteur();
        var d = await c.DeposerAsync(Facture(Cii, Syntaxe.Cii));
        await c.RechercherAsync(new CriteresFlux { Sens = [SensFlux.Entrant] });
        serveur.Forcer.Enqueue((500, "INTERNAL_ERROR", $"Authorization: Bearer {ServeurAfnorTest.Jeton}"));
        var e = await Assert.ThrowsAsync<ExceptionConnecteur>(() => c.FluxAsync(d.IdFlux));
        Assert.NotEmpty(journal.Messages);
        Assert.All(journal.Messages, m => Assert.DoesNotContain(ServeurAfnorTest.Jeton, m));
        Assert.DoesNotContain(ServeurAfnorTest.Jeton, e.Message);
        Assert.Contains(journal.Messages, m => m.Contains(serveur.Requetes.Last().RequestId!, StringComparison.Ordinal));
    }

    // ---------------------------------------------------------------- fabrique et surcharge par une PA

    /// <summary>PA fictive dont l'API ajoute un en-tête et range ses services sous un autre chemin.</summary>
    private sealed class ConnecteurPaExemple(ParametresConnecteur p, HttpClient h, IFournisseurJeton j) : ConnecteurAfnor(p, h, j)
    {
        public override string Code => "PA_EXEMPLE";

        protected override async Task PreparerAsync(HttpRequestMessage requete, string requestId, CancellationToken ct)
        {
            await base.PreparerAsync(requete, requestId, ct);
            requete.Headers.Add("X-Pa-Exemple", "1");
        }
    }

    [Fact]
    public async Task Fabrique_connecteurs_fournis_et_surcharge_par_une_pa()
    {
        var services = new ServiceCollection()
            .AddSingleton<TimeProvider>(horloge)
            .AddSingleton<IFournisseurJeton>(jetons)
            .AddConnecteursFactureElectronique()
            .AddConnecteurPlateforme("PA_EXEMPLE", (p, s) => new ConnecteurPaExemple(p, http, s.GetRequiredService<IFournisseurJeton>()))
            .BuildServiceProvider();
        var fabrique = services.GetRequiredService<FabriqueConnecteurs>();
        Assert.Equal([ConnecteurFe.Afnor, ConnecteurFe.Simule, ConnecteurFe.Manuel, "PA_EXEMPLE"], fabrique.Codes);

        Assert.IsType<ConnecteurAfnor>(fabrique.Creer(Parametres));
        var simule = Assert.IsType<ConnecteurSimule>(fabrique.Creer(Parametres with { Code = ConnecteurFe.Simule }));
        Assert.Same(simule.Plateforme, Assert.IsType<ConnecteurSimule>(fabrique.Creer(Parametres with { Code = ConnecteurFe.Simule })).Plateforme);
        Assert.NotSame(simule.Plateforme, Assert.IsType<ConnecteurSimule>(fabrique.Creer(new ParametresConnecteur(ConnecteurFe.Simule, "autre_base"))).Plateforme);
        Assert.False(Assert.IsType<ConnecteurManuel>(fabrique.Creer(Parametres with { Code = ConnecteurFe.Manuel })).TransmetAutomatiquement);

        var pa = fabrique.Creer(Parametres with { Code = "PA_EXEMPLE" });
        Assert.Equal("PA_EXEMPLE", pa.Code);
        await pa.DeposerAsync(Facture(Cii, Syntaxe.Cii));
        Assert.Equal("/pa/flow-service/v1/flows", serveur.Requetes.Last().Chemin);

        Assert.Equal(ErreurFe.ConnecteurInconnu, Assert.Throws<ExceptionConnecteur>(() => fabrique.Creer(Parametres with { Code = "INCONNU" })).Code);
        Assert.Equal(ErreurFe.ParametreConnecteur, Assert.Throws<ExceptionConnecteur>(() => fabrique.Creer(new ParametresConnecteur(ConnecteurFe.Simule, ""))).Code);
    }
}
