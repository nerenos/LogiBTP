using System.Text;
using LogiBTP.FactureElectronique.Formats;
using LogiBTP.FactureElectronique.Web;
using LogiBTP.FactureElectronique.Web.Connecteurs;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Npgsql;
using Xunit;

namespace LogiBTP.FactureElectronique.Tests;

/// <summary>
/// Service, file, relève et journal du module sur une base PostgreSQL où le script 099f est chargé (variable
/// LOGIBTP_TEST_PG, sinon rien) : file (dépôt, doublon, reprises 1/5/15/60 puis erreur, nouvelle tentative), relève
/// (accusés, statuts 200 → 205, curseur, idempotence, facture reçue rattachée, AlreadyExistingFlow), dépôt et import
/// manuels, magasin en base, journal (ajout seul, chaîne vérifiée, altération détectée). Les tests d'une même base se
/// partagent fe_parametre : ils sont dans cette seule classe (exécutée en série).
/// </summary>
public sealed class ServiceFactureElectroniqueTests : IAsyncLifetime
{
    private static readonly string? Connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");
    private static readonly Utilisateur Admin = new("admin.test", "ADMIN");
    private const string Panne = "PANNE_TEST";

    private readonly HorlogeTest horloge = new(new DateTimeOffset(2026, 11, 10, 8, 0, 0, TimeSpan.Zero));
    private readonly SpecialisationTest specialisation = new();
    private readonly ConnecteurPanne panne = new();
    private readonly string numero = "FE" + Random.Shared.NextInt64(100_000_000, 999_999_999);
    private ServiceProvider? services;

    private sealed class SpecialisationTest : SpecialisationFactureElectronique
    {
        public List<SignalementFe> Signalements { get; } = [];
        public List<StatutSignaleFe> Statuts { get; } = [];
        public ElementFe? Element { get; set; }
        public PieceRecueFe? Refus { get; set; }
        public List<StatutAPoser> StatutsCreation { get; } = [];
        public List<StatutSignaleFe> Poses { get; } = [];

        public override Task<PieceRecueFe?> CreerPieceRecueAsync(FactureRecueFe recue, CancellationToken ct) =>
            Task.FromResult(Refus ?? (Element is null ? null : PieceRecueFe.Creee(Element, new { recue.Facture!.Numero }) with { Statuts = [.. StatutsCreation] }));
        public override Task StatutPoseAsync(StatutSignaleFe statut, CancellationToken ct) { Poses.Add(statut); return Task.CompletedTask; }
        public override Task StatutRecuAsync(StatutSignaleFe statut, CancellationToken ct) { Statuts.Add(statut); return Task.CompletedTask; }
        public override Task SignalerAsync(SignalementFe s, CancellationToken ct) { Signalements.Add(s); return Task.CompletedTask; }
    }

    /// <summary>Connecteur qui échoue selon une liste d'exceptions, puis dépose.</summary>
    private sealed class ConnecteurPanne : ConnecteurPlateforme
    {
        public Queue<ExceptionConnecteur> Echecs { get; } = new();
        public int Depots { get; private set; }
        public override string Code => Panne;

        protected override Task<FluxDepose> DeposerFluxAsync(FluxPrepare flux, CancellationToken ct)
        {
            if (Echecs.TryDequeue(out var e)) throw e;
            Depots++;
            return Task.FromResult(new FluxDepose(Guid.NewGuid().ToString(), DateTimeOffset.UtcNow, flux.Flux.IdentifiantSuivi, flux.Flux.Nom, flux.Flux.Syntaxe));
        }

        protected override Task<PageFlux> RechercherFluxAsync(CriteresFlux c, string? curseur, int limite, CancellationToken ct) => Task.FromResult(new PageFlux([], null));
        protected override Task<Flux> LireFluxAsync(string idFlux, CancellationToken ct) => throw new NotSupportedException();
        protected override Task<FichierFlux> TelechargerFluxAsync(string idFlux, string t, CancellationToken ct) => throw new NotSupportedException();
        protected override Task VerifierSanteAsync(CancellationToken ct) => Task.CompletedTask;
    }

    private FactureElectroniqueDbContext Db() =>
        new(new DbContextOptionsBuilder<FactureElectroniqueDbContext>().UseNpgsql(Connexion).UseSnakeCaseNamingConvention().Options);

    private SocieteCourante Societe => new(null, "Essai", Connexion!);

    private ServiceProvider Services(Func<string, string, IMagasinFlux>? magasin = null)
    {
        var s = new ServiceCollection();
        s.AddSingleton<TimeProvider>(horloge);
        s.AddConnecteursFactureElectronique(new OptionsPlateformeSimulee { DelaiAccuse = TimeSpan.FromMinutes(1) }, magasin);
        s.AddConnecteurPlateforme(Panne, (_, _) => panne);
        return s.BuildServiceProvider();
    }

    private ServiceFactureElectronique Service(FactureElectroniqueDbContext db)
    {
        services ??= Services();
        return new(db, specialisation, services.GetRequiredService<FabriqueConnecteurs>(), Societe, services.GetRequiredService<DepotsManuels>(), horloge);
    }

    private PlateformeSimulee Plateforme => services!.GetRequiredService<PlateformesSimulees>().Pour(Societe.Base!);

    /// <summary>Facture CII d'exemple sous un numéro propre au test (marqueur facultatif).</summary>
    private byte[] Facture(string? suffixe = null) => Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(ConnecteurAfnorTests.Exemple(ConnecteurAfnorTests.Cii))
        .Replace("F202500003", numero + suffixe));

    private async Task Connecteur(string code)
    {
        await using var db = Db();
        var s = Service(db);
        var p = await s.Parametres(default);
        await s.EnregistrerParametres(p with { Connecteur = code, Actif = true, AdresseFlux = null, ConnexionOauth = null }, Admin, default);
    }

    public async Task InitializeAsync()
    {
        if (Connexion is null) return;
        // Restes d'un passage précédent : hors de la file et curseurs remis à zéro (base jetable des tests).
        await using var db = Db();
        await db.Database.ExecuteSqlRawAsync("UPDATE fe_flux SET ffl_etat = 'ABANDONNE' WHERE ffl_etat IN ('A_ENVOYER', 'ENVOYE')");
        await db.Database.ExecuteSqlRawAsync("UPDATE fe_releve SET fre_curseur = NULL, fre_derniere_releve = NULL");
    }

    public Task DisposeAsync()
    {
        services?.Dispose();
        return Task.CompletedTask;
    }

    private static async Task<List<string>> Etapes(FactureElectroniqueDbContext db, long flux) =>
        [.. (await JournalFe.ChronologieAsync(db, flux, null, null, default)).Select(e => $"{e.Type}:{e.EtatAvant}>{e.EtatApres}")];

    [Fact]
    public async Task File_depose_et_doublon_sans_effet()
    {
        if (Connexion is null) return;
        await Connecteur(ConnecteurFe.Simule);
        await using var db = Db();
        var s = Service(db);
        var a = new FluxAEmettre(Facture(), $"{numero}.xml") { IdSuivi = "SUIVI-" + numero, TypeElement = "DOCUMENT", IdElement = numero };
        var f = await s.MettreEnFileAsync(a, Admin, default);
        Assert.Equal((EtatFlux.AEnvoyer, numero, Syntaxe.Cii, ProfilFacture.En16931), (f.Etat, f.Numero, f.Syntaxe, f.Profil));

        // Doublon : même suivi et même fichier, le flux existant ; autre fichier, refus.
        Assert.Equal(f.Id, (await s.MettreEnFileAsync(a, Admin, default)).Id);
        var e = await Assert.ThrowsAsync<ExceptionMetier>(() => s.MettreEnFileAsync(a with { Contenu = Facture("B") }, Admin, default));
        Assert.Equal((409, ErreurFe.DemandeInvalide), (e.Statut, e.Code));

        Assert.Equal(new ResultatFile(1, 0, 0), await new FileFlux(s).TraiterAsync(10, default));
        Assert.Equal(new ResultatFile(0, 0, 0), await new FileFlux(s).TraiterAsync(10, default));
        var d = await s.Detail(f.Id, default);
        Assert.Equal((EtatFlux.Envoye, 1, EtatAccuse.EnAttente), (d.Flux.Etat, d.Flux.Essais, d.Flux.Accuse));
        Assert.NotNull(d.Flux.IdFlux);
        Assert.Equal(["PRODUCTION:>A_ENVOYER", "DEPOT:A_ENVOYER>ENVOYE"], await Etapes(db, f.Id));
        Assert.All(d.Chronologie, x => Assert.Equal(("DOCUMENT", numero), (x.TypeElement, x.IdElement)));
        Assert.Equal(TypeDocumentFlux.Original, Assert.Single(d.Fichiers).Document);
        Assert.Equal(Facture(), (await s.Fichier(f.Id, null, default)).Contenu);
        Assert.Single(await s.Chronologie(null, "DOCUMENT", numero, default), x => x.Type == EvenementFe.Depot);
        Assert.DoesNotContain(await s.Liste(new FiltreFlux(Erreurs: true, Limite: 500), default), x => x.Id == f.Id);
        Assert.Contains(await s.Liste(new FiltreFlux(Erreurs: false, Limite: 500), default), x => x.Id == f.Id);
        // Filtre des jours de création (horloge du test : 10/11/2026), bornes comprises.
        var jour = DateOnly.FromDateTime(horloge.GetUtcNow().UtcDateTime);
        Assert.Contains(await s.Liste(new FiltreFlux(Du: jour, Au: jour, Limite: 500), default), x => x.Id == f.Id);
        Assert.DoesNotContain(await s.Liste(new FiltreFlux(Du: jour.AddDays(1), Limite: 500), default), x => x.Id == f.Id);
        Assert.DoesNotContain(await s.Liste(new FiltreFlux(Au: jour.AddDays(-1), Limite: 500), default), x => x.Id == f.Id);
    }

    [Fact]
    public async Task Reprises_puis_erreur_puis_nouvelle_tentative()
    {
        if (Connexion is null) return;
        await Connecteur(Panne);
        await using var db = Db();
        var s = Service(db);
        var file = new FileFlux(s);
        for (var i = 0; i < 5; i++) panne.Echecs.Enqueue(new ExceptionConnecteur(ErreurFe.PlateformeIndisponible, "Service Unavailable", 503, requestId: "R" + i));
        var f = await s.MettreEnFileAsync(new FluxAEmettre(Facture(), $"{numero}.xml"), null, default);

        foreach (var minutes in FileFlux.Reprises)
        {
            Assert.Equal(new ResultatFile(0, 1, 0), await file.TraiterAsync(10, default));
            var x = (await s.Detail(f.Id, default)).Flux;
            Assert.Equal((EtatFlux.AEnvoyer, horloge.GetUtcNow().AddMinutes(minutes)), (x.Etat, x.ProchainEssai));
            // Pas dû avant l'échéance.
            horloge.Avancer(TimeSpan.FromMinutes(minutes) - TimeSpan.FromSeconds(1));
            Assert.Equal(new ResultatFile(0, 0, 0), await file.TraiterAsync(10, default));
            horloge.Avancer(TimeSpan.FromSeconds(1));
        }
        Assert.Equal(new ResultatFile(0, 0, 1), await file.TraiterAsync(10, default));
        var d = await s.Detail(f.Id, default);
        Assert.Equal((EtatFlux.Erreur, 5, 5), (d.Flux.Etat, d.Flux.Essais, d.Erreurs.Count));
        Assert.Equal((503, "R4"), (d.Erreurs[^1].StatutHttp, d.Erreurs[^1].RequestId));
        Assert.Contains(specialisation.Signalements, x => x.Flux.FflId == f.Id && x.Code == ErreurFe.PlateformeIndisponible);
        Assert.Equal(["PRODUCTION:>A_ENVOYER", .. Enumerable.Repeat("REPRISE:A_ENVOYER>A_ENVOYER", 4), "ERREUR:A_ENVOYER>ERREUR"], await Etapes(db, f.Id));

        await s.NouvelleTentative(f.Id, Admin, default);
        Assert.Equal(new ResultatFile(1, 0, 0), await file.TraiterAsync(10, default));
        Assert.Equal(["ACTION_UTILISATEUR:ERREUR>A_ENVOYER", "DEPOT:A_ENVOYER>ENVOYE"], (await Etapes(db, f.Id))[^2..]);
        var e = await Assert.ThrowsAsync<ExceptionMetier>(() => s.NouvelleTentative(f.Id, Admin, default));
        Assert.Equal(ErreurFe.EtatFluxInvalide, e.Code);

        // Échec définitif (400) : erreur tout de suite, sans reprise.
        panne.Echecs.Enqueue(new ExceptionConnecteur(ErreurFe.RequeteRefusee, "Bad Request", 400));
        var g = await s.MettreEnFileAsync(new FluxAEmettre(Facture("C"), $"{numero}C.xml"), null, default);
        Assert.Equal(new ResultatFile(0, 0, 1), await file.TraiterAsync(10, default));
        Assert.Equal(["PRODUCTION:>A_ENVOYER", "ERREUR:A_ENVOYER>ERREUR"], await Etapes(db, g.Id));

        // Filtre du tableau des flux : avec erreur enregistrée.
        var enErreur = await s.Liste(new FiltreFlux(Sens: SensFlux.Sortant, Erreurs: true, Limite: 500), default);
        Assert.Contains(enErreur, x => x.Id == f.Id);
        Assert.Contains(enErreur, x => x.Id == g.Id);
        Assert.DoesNotContain(await s.Liste(new FiltreFlux(Erreurs: false, Limite: 500), default), x => x.Id == g.Id);
    }

    [Fact]
    public async Task Releve_accuses_statuts_curseur_et_idempotence()
    {
        if (Connexion is null) return;
        await Connecteur(ConnecteurFe.Simule);
        await using var db = Db();
        var s = Service(db);
        var releve = new ReleveFlux(s);
        var f = await s.MettreEnFileAsync(new FluxAEmettre(Facture(), $"{numero}.xml"), null, default);
        var rejet = await s.MettreEnFileAsync(new FluxAEmettre(Facture("REJET"), $"{numero}REJET.xml"), null, default);
        // Déjà déposé sous ce suivi (réponse perdue) : la plateforme répond AlreadyExistingFlow, tenu pour un succès.
        Plateforme.Deposer(new FluxADeposer(Facture("D"), "d.xml", Syntaxe.Cii) { IdentifiantSuivi = "DEJA-" + numero }, null);
        var deja = await s.MettreEnFileAsync(new FluxAEmettre(Facture("D"), $"{numero}D.xml") { IdSuivi = "DEJA-" + numero }, null, default);
        Assert.Equal(3, (await new FileFlux(s).TraiterAsync(10, default)).Deposes);

        horloge.Avancer(TimeSpan.FromMinutes(1));
        var r = await releve.ReleverAsync(true, 2, default);
        Assert.Equal(3, r.Single(x => x.Sens == SensFlux.Sortant).Nouveaux);
        Assert.Equal(EtatFlux.Acquitte, (await s.Detail(f.Id, default)).Flux.Etat);
        var dr = await s.Detail(rejet.Id, default);
        Assert.Equal((EtatFlux.Erreur, MotifAccuse.AutreErreurTechnique), (dr.Flux.Etat, Assert.Single(dr.Erreurs).Code));
        Assert.Contains(specialisation.Signalements, x => x.Flux.FflId == rejet.Id);
        Assert.Equal(EtatFlux.Acquitte, (await s.Detail(deja.Id, default)).Flux.Etat);
        Assert.Equal("ACCUSE:ENVOYE>ACQUITTE", (await Etapes(db, f.Id))[^1]);

        // Pas encore due : rien.
        Assert.All(await releve.ReleverAsync(false, null, default), x => Assert.False(x.Faite));

        horloge.Avancer(TimeSpan.FromHours(1));
        r = await releve.ReleverAsync(true, 2, default);
        var entrants = r.Single(x => x.Sens == SensFlux.Entrant);
        Assert.Equal(12, entrants.Nouveaux);   // 6 statuts pour chacune des deux factures acceptées
        Assert.NotNull(entrants.Curseur);
        var d = await s.Detail(f.Id, default);
        Assert.Equal([StatutCdv.Deposee, StatutCdv.Emise, StatutCdv.Recue, StatutCdv.MiseADisposition, StatutCdv.PriseEnCharge, StatutCdv.Approuvee],
            d.Statuts.Select(x => x.Code));
        Assert.All(d.Statuts, x => Assert.Equal((SensStatut.Recu, "[]"), (x.Sens, x.Erreurs.GetRawText())));
        Assert.Equal(StatutCdv.Approuvee, d.Flux.StatutAffiche);
        Assert.Equal(6, (await Etapes(db, f.Id)).Count(x => x.StartsWith(EvenementFe.StatutRecu)));
        Assert.Equal($"{EvenementFe.StatutRecu}:{StatutCdv.PriseEnCharge}>{StatutCdv.Approuvee}", (await Etapes(db, f.Id))[^1]);
        Assert.Equal(6, specialisation.Statuts.Count(x => x.Facture?.FflId == f.Id));

        // Idempotence : une nouvelle relève (même curseur ou depuis le début) ne reprend rien.
        var evenements = await db.Evenements.CountAsync();
        Assert.All(await releve.ReleverAsync(true, 2, default), x => Assert.Equal(0, x.Nouveaux));
        await db.Database.ExecuteSqlRawAsync("UPDATE fe_releve SET fre_curseur = NULL");
        Assert.All(await releve.ReleverAsync(true, null, default), x => Assert.Equal(0, x.Nouveaux));
        Assert.Equal(evenements, await db.Evenements.CountAsync());
        Assert.Equal(6, (await s.Detail(f.Id, default)).Statuts.Count);
    }

    [Fact]
    public async Task Facture_recue_rattachee_et_import_manuel()
    {
        if (Connexion is null) return;
        await Connecteur(ConnecteurFe.Simule);
        await using var db = Db();
        var s = Service(db);
        specialisation.Element = new ElementFe("ACHAT", numero);
        Plateforme.RecevoirFacture(Facture("R"), "recue.xml");
        await new ReleveFlux(s).ReleverAsync(true, null, default);
        var recue = Assert.Single(await s.Liste(new FiltreFlux(Sens: SensFlux.Entrant, TypeElement: "ACHAT", IdElement: numero), default));
        Assert.Equal((EtatFlux.Traite, numero + "R", TypeFlux.FactureFournisseur), (recue.Etat, recue.Numero, recue.Type));
        Assert.Equal(["RECEPTION:>RECU", "LECTURE:RECU>RECU", "PIECE_CREEE:RECU>RECU", "RATTACHEMENT:RECU>TRAITE"], await Etapes(db, recue.Id));
        // Chronologie de l'élément : toutes les étapes du flux rattaché, réception et lecture comprises ; vue lisible gardée.
        Assert.Equal(4, (await s.Chronologie(null, "ACHAT", numero, default)).Count(x => x.FluxId == recue.Id));
        Assert.Contains((await s.Detail(recue.Id, default)).Fichiers, x => x.Document == TypeDocumentFlux.Lisible);
        Assert.Contains(specialisation.Signalements, x => x.Flux.FflId == recue.Id && x.Evenement == EvenementFe.Reception && x.Etat == EtatFlux.Traite);

        // Doublon refusé par l'application : tracé (étape DOUBLON, erreur), la facture reste à traiter.
        specialisation.Refus = PieceRecueFe.Refusee(ErreurFe.FactureEnDouble, "Déjà saisie", new ElementFe("ACHAT", numero));
        Plateforme.RecevoirFacture(Facture("D"), "double.xml");
        await new ReleveFlux(s).ReleverAsync(true, null, default);
        var double_ = (await s.Liste(new FiltreFlux(Sens: SensFlux.Entrant), default)).First(x => x.Numero == numero + "D");
        Assert.Equal((EtatFlux.Recu, null), (double_.Etat, double_.IdElement));
        Assert.Equal(["RECEPTION:>RECU", "LECTURE:RECU>RECU", "DOUBLON:RECU>RECU"], await Etapes(db, double_.Id));
        Assert.Equal(ErreurFe.FactureEnDouble, Assert.Single((await s.Detail(double_.Id, default)).Erreurs).Code);
        specialisation.Refus = null;

        // Import manuel d'une facture illisible : refusé ; d'une facture : reçue, à traiter.
        var e = await Assert.ThrowsAsync<ExceptionConnecteur>(() => s.Importer(new ImportManuel("x.xml", Convert.ToBase64String("<pas"u8.ToArray())), Admin, default));
        Assert.Equal(ErreurFe.DemandeInvalide, e.Code);
        specialisation.Element = null;
        var i = await s.Importer(new ImportManuel("import.xml", Convert.ToBase64String(Facture("I"))), Admin, default);
        Assert.Equal((EtatFlux.Recu, ConnecteurFe.Manuel, numero + "I"), (i.Etat, i.Connecteur, i.Numero));
        Assert.Equal(["IMPORT_MANUEL:>RECU", "LECTURE:RECU>RECU"], await Etapes(db, i.Id));
        Assert.Equal(Admin.Code, (await s.Chronologie(i.Id, null, null, default))[0].Utilisateur);
    }

    [Fact]
    public async Task Statuts_poses_cdar_en_file_transition_refusee_et_statut_non_envoye()
    {
        if (Connexion is null) return;
        await Connecteur(ConnecteurFe.Simule);
        await using var db = Db();
        var s = Service(db);
        // Prise en charge (204) posée dès le rattachement de la pièce créée, dans la transaction de la réception.
        specialisation.Element = new ElementFe("ACHAT", numero + "S");
        specialisation.StatutsCreation.Add(new StatutAPoser(StatutCdv.PriseEnCharge) { Origine = new { piece = "creee" } });
        Plateforme.RecevoirFacture(Facture("S"), "statuts.xml");
        await new ReleveFlux(s).ReleverAsync(true, null, default);
        specialisation.StatutsCreation.Clear();
        var recue = Assert.Single(await s.Liste(new FiltreFlux(Sens: SensFlux.Entrant, TypeElement: "ACHAT", IdElement: numero + "S"), default));
        Assert.Equal(["RECEPTION:>RECU", "LECTURE:RECU>RECU", "PIECE_CREEE:RECU>RECU", "RATTACHEMENT:RECU>TRAITE", "STATUT_POSE:>204"], await Etapes(db, recue.Id));
        var d = await s.Detail(recue.Id, default);
        var pec = Assert.Single(d.Statuts);
        Assert.Equal((StatutCdv.PriseEnCharge, SensStatut.Pose, EmetteurStatut.Acheteur), (pec.Code, pec.Sens, pec.Emetteur));
        Assert.NotNull(pec.FluxCdarId);
        // CDAR en file (A_ENVOYER, cycle de vie d'une facture fournisseur), rattaché au même élément, lu comme un 204 de l'acheteur.
        var cdar = (await s.Detail(pec.FluxCdarId!.Value, default)).Flux;
        Assert.Equal((EtatFlux.AEnvoyer, Syntaxe.Cdar, TypeFlux.CdvFactureFournisseur, "ACHAT", numero + "S"), (cdar.Etat, cdar.Syntaxe, cdar.Type, cdar.TypeElement, cdar.IdElement));
        var lu = Cdar.StatutsLus(Cdar.Lire((await s.Fichier(cdar.Id, null, default)).Contenu), SensFacture.Recue, []);
        Assert.Equal((StatutCdv.PriseEnCharge, EmetteurStatut.Acheteur), (Assert.Single(lu).Statut, lu[0].Emetteur));
        Assert.Empty(lu[0].Erreurs);

        // Approuvée (205) posée par l'utilisateur ; Refusée (210) ensuite interdite ; motif hors liste refusé.
        var approuvee = await s.PoserStatutAsync(recue.Id, new StatutAPoser(StatutCdv.Approuvee), Admin, default);
        Assert.NotNull(approuvee.FluxCdarId);
        var refus = await Assert.ThrowsAsync<ExceptionMetier>(() => s.PoserStatutAsync(recue.Id, new StatutAPoser(StatutCdv.Refusee, MotifStatut.Doublon), Admin, default));
        Assert.Equal(ErreurFe.TransitionInterdite, refus.Code);
        var motif = await Assert.ThrowsAsync<ExceptionMetier>(() => s.PoserStatutAsync(recue.Id, new StatutAPoser(StatutCdv.EnLitige, MotifStatut.RejSeman), Admin, default));
        Assert.Equal(ErreurFe.MotifNonAutorise, motif.Code);

        // Statut non envoyé (paramètre par code) : gardé au journal sans CDAR ; Refusée (exigée par le PPF) non paramétrable.
        var p = await s.Parametres(default);
        var invalide = await Assert.ThrowsAsync<ExceptionMetier>(() => s.EnregistrerParametres(p with { StatutsNonEnvoyes = [StatutCdv.Refusee] }, Admin, default));
        Assert.Equal(ErreurFe.ParametreInvalide, invalide.Code);
        await s.EnregistrerParametres(p with { StatutsNonEnvoyes = [StatutCdv.PaiementTransmis] }, Admin, default);
        Assert.Equal([StatutCdv.PaiementTransmis], (await s.Parametres(default)).StatutsNonEnvoyes);
        var paiement = await s.PoserStatutApplicationAsync(recue.Id, new StatutAPoser(StatutCdv.PaiementTransmis), "compta", default);
        Assert.Null(paiement.FluxCdarId);
        Assert.Equal("STATUT_POSE:205>211", (await Etapes(db, recue.Id))[^1]);
        Assert.Equal(ActeurFe.Systeme, (await s.Chronologie(recue.Id, null, null, default))[^1].Acteur);
        Assert.Equal([StatutCdv.PriseEnCharge, StatutCdv.Approuvee, StatutCdv.PaiementTransmis], specialisation.Poses.Where(x => x.Facture?.FflId == recue.Id).Select(x => x.Statut.FstCode));
        await s.EnregistrerParametres(p with { StatutsNonEnvoyes = [] }, Admin, default);

        // La file dépose les deux CDAR sur la plateforme simulée.
        Assert.True((await new FileFlux(s).TraiterAsync(20, default)).Deposes >= 2);
        db.ChangeTracker.Clear();
        Assert.Equal(EtatFlux.Envoye, (await s.Detail(approuvee.FluxCdarId!.Value, default)).Flux.Etat);
        Assert.Equal(EtatFlux.Envoye, (await s.Detail(pec.FluxCdarId.Value, default)).Flux.Etat);
    }

    [Fact]
    public async Task Facture_hors_plateforme_meme_traitement_sans_statut_envoye()
    {
        if (Connexion is null) return;
        await Connecteur(ConnecteurFe.Simule);
        await using var db = Db();
        var s = Service(db);
        // Factur-X ou XML glissé (lot 14) : flux reçu du connecteur MANUEL marqué hors plateforme, pièce créée et rattachée,
        // Prise en charge (204) posée au journal sans CDAR, puis Approuvée (205) de même.
        specialisation.Element = new ElementFe("ACHAT", numero + "H");
        specialisation.StatutsCreation.Add(new StatutAPoser(StatutCdv.PriseEnCharge));
        var f = await s.Importer(new ImportManuel("glissee.xml", Convert.ToBase64String(Facture("H")), HorsPlateforme: true), Admin, default);
        specialisation.StatutsCreation.Clear();
        Assert.Equal((EtatFlux.Traite, ConnecteurFe.Manuel, SensFlux.Entrant, true, numero + "H"), (f.Etat, f.Connecteur, f.Sens, f.HorsPlateforme, f.IdElement));
        Assert.Equal(["IMPORT_MANUEL:>RECU", "LECTURE:RECU>RECU", "PIECE_CREEE:RECU>RECU", "RATTACHEMENT:RECU>TRAITE", "STATUT_POSE:>204"], await Etapes(db, f.Id));
        var pec = Assert.Single((await s.Detail(f.Id, default)).Statuts);
        Assert.Null(pec.FluxCdarId);
        var approuvee = await s.PoserStatutApplicationAsync(f.Id, new StatutAPoser(StatutCdv.Approuvee), "compta", default);
        Assert.Null(approuvee.FluxCdarId);
        var c = (await s.Chronologie(f.Id, null, null, default))[^1];
        Assert.False(c.Detail!.Value.GetProperty("envoye").GetBoolean());
        Assert.True(c.Detail!.Value.GetProperty("hors_plateforme").GetBoolean());
        Assert.False(await db.Flux.AnyAsync(x => x.FflSyntaxe == Syntaxe.Cdar && x.FflIdElement == numero + "H"));
        // Un statut CDAR ne se reçoit pas hors plateforme.
        var cdar = await Assert.ThrowsAsync<ExceptionMetier>(() => s.ImporterHorsPlateformeAsync(
            File.ReadAllBytes(Directory.EnumerateFiles(LogiBTP.Socle.Testing.CasPartages.Chemin("modules", "facture-electronique", "tests", "exemples", "cdar", "fnfe"), "*.xml").Order().First()),
            "statut.xml", null, Admin, default));
        Assert.Equal(ErreurFe.DemandeInvalide, cdar.Code);
    }

    [Fact]
    public async Task Depot_manuel_confirme_avec_magasin_en_base()
    {
        if (Connexion is null) return;
        var options = Options.Create(new OptionsSocietes { Principale = Connexion });
        using var magasins = new MagasinsFluxBase(options);
        services = Services((b, m) => magasins.Pour(b, m));
        await Connecteur(ConnecteurFe.Manuel);
        await using var db = Db();
        var s = Service(db);
        var f = await s.MettreEnFileAsync(new FluxAEmettre(Facture(), $"{numero}.xml"), Admin, default);
        Assert.Equal(1, (await new FileFlux(s).TraiterAsync(10, default)).Deposes);
        var envoye = (await s.Detail(f.Id, default)).Flux;
        Assert.Equal(EtatFlux.Envoye, envoye.Etat);

        // Le dépôt manuel est retrouvé par un autre processus (nouveau registre, même base).
        using var autres = new MagasinsFluxBase(options);
        var relu = autres.Pour(Societe.Base!, ConnecteurFe.Manuel).Trouver(envoye.IdFlux!);
        Assert.Equal((EtatAccuse.EnAttente, envoye.Empreinte), (relu!.Flux.Accuse.Etat, relu.Flux.Empreinte));
        Assert.Equal(Facture(), relu.Original);

        var c = await s.ConfirmerDepotManuel(f.Id, new ConfirmationDepot(EtatAccuse.Ok), Admin, default);
        Assert.Equal(EtatFlux.Acquitte, c.Etat);
        Assert.Equal(["PRODUCTION:>A_ENVOYER", "DEPOT:A_ENVOYER>ENVOYE", "ACCUSE:ENVOYE>ACQUITTE"], await Etapes(db, f.Id));
        var dernier = (await s.Chronologie(f.Id, null, null, default))[^1];
        Assert.Equal((ActeurFe.Utilisateur, Admin.Code), (dernier.Acteur, dernier.Utilisateur));
        var e = await Assert.ThrowsAsync<ExceptionMetier>(() => s.ConfirmerDepotManuel(f.Id, new ConfirmationDepot(EtatAccuse.Ok), Admin, default));
        Assert.Equal(ErreurFe.EtatFluxInvalide, e.Code);

        // Plateforme simulée en base : le dépôt survit au registre.
        var simule = new PlateformeSimulee(autres.Pour(Societe.Base!, ConnecteurFe.Simule), horloge);
        var depot = simule.Deposer(new FluxADeposer(Facture("S"), "s.xml", Syntaxe.Cii), null);
        using var troisiemes = new MagasinsFluxBase(options);
        Assert.Equal(depot.IdFlux, new PlateformeSimulee(troisiemes.Pour(Societe.Base!, ConnecteurFe.Simule), horloge).Lire(depot.IdFlux).IdFlux);
    }

    [Fact]
    public async Task Journal_en_ajout_seul_chaine_verifiee_et_alteration_detectee()
    {
        if (Connexion is null) return;
        await Connecteur(ConnecteurFe.Simule);
        await using var db = Db();
        var s = Service(db);
        var f = await s.MettreEnFileAsync(new FluxAEmettre(Facture(), $"{numero}.xml"), Admin, default);
        await JournalFe.AjouterAsync(db, new EtapeFe(EvenementFe.ActionUtilisateur, ActeurFe.Utilisateur)
        {
            FluxId = f.Id, Utilisateur = Admin.Code, Detail = new { note = "essai", jeton = "ne-doit-pas-paraitre", access_token = "x" },
        }, default);
        var v = await s.VerifierJournal(default);
        Assert.True(v.Ok, $"{v.RangRompu} {v.Raison}");
        var dernier = (await s.Chronologie(f.Id, null, null, default))[^1];
        Assert.Equal(v.DerniereEmpreinte, dernier.Empreinte);
        Assert.DoesNotContain("ne-doit-pas-paraitre", dernier.Detail!.Value.GetRawText());
        Assert.False(dernier.Detail.Value.TryGetProperty("access_token", out _));

        // Ajout seul : UPDATE, DELETE et TRUNCATE refusés ; rang et empreinte fournis ignorés.
        foreach (var sql in new[] { $"UPDATE fe_evenement SET fev_utilisateur = 'x' WHERE fev_id = {dernier.Id}",
                     $"DELETE FROM fe_evenement WHERE fev_id = {dernier.Id}", "TRUNCATE fe_evenement CASCADE", "TRUNCATE fe_flux CASCADE" })
        {
            var e = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlRawAsync(sql));
            Assert.Contains("ni modifié ni supprimé", e.MessageText);
        }
        await db.Database.ExecuteSqlRawAsync(
            "INSERT INTO fe_evenement (fev_rang, fev_type, fev_acteur, fev_horodatage, fev_empreinte_precedente, fev_empreinte) " +
            "VALUES (1, 'CONTROLE', 'SYSTEME', '2000-01-01', repeat('a', 64), repeat('b', 64))");
        Assert.True((await s.VerifierJournal(default)).Ok);

        // Altération (triggers suspendus le temps d'une transaction annulée) : détectée au rang modifié.
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE fe_evenement DISABLE TRIGGER tr_fe_evenement_immuable");
            await db.Database.ExecuteSqlRawAsync($"UPDATE fe_evenement SET fev_etat_apres = 'TRAITE' WHERE fev_id = {dernier.Id}");
            var altere = await s.VerifierJournal(default);
            Assert.Equal((false, dernier.Rang, "Entrée modifiée"), (altere.Ok, altere.RangRompu, altere.Raison));
            await tx.RollbackAsync();
        }
        Assert.True((await s.VerifierJournal(default)).Ok);
    }
}
