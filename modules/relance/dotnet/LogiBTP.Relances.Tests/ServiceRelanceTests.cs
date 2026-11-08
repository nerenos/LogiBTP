using LogiBTP.Relances.Web;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LogiBTP.Relances.Tests;

/// <summary>
/// Service du module sur une spécialisation de test : préparation regroupée, validation partielle et échec d'envoi,
/// suspensions, journal qui fait avancer le niveau (groupe d'indices compris), recommandé en attente de numéro, portée,
/// règle. Base PostgreSQL où le script 099t est chargé : variable LOGIBTP_TEST_PG, sinon rien.
/// </summary>
public sealed class ServiceRelanceTests : IAsyncLifetime
{
    private static readonly string? Connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");
    private static readonly Utilisateur Admin = new("admin.test", "ADMIN");
    private static readonly DateOnly Jour = new(2026, 11, 8);

    // Identifiants propres à l'instance (pièces, tiers, chargés) : les tests ne se gênent pas dans une base partagée.
    private readonly long _base = Random.Shared.NextInt64(1, 1_000_000) * 1000 + 9_000_000_000;
    private readonly SpecialisationTest _specialisation = new();
    private readonly List<long> _lots = [];

    private sealed class Horloge(DateOnly jour) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(jour.ToDateTime(new TimeOnly(12, 0)), TimeSpan.Zero);
        public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;
    }

    private sealed class SpecialisationTest : SpecialisationRelance
    {
        public List<PieceEnAttente> Pieces { get; } = [];
        public Dictionary<long, SurchargeTiers> Surcharges { get; } = [];
        public PorteeRelance Portee { get; set; } = PorteeRelance.Toutes;
        public HashSet<long> TiersEnEchec { get; } = [];
        public List<EnvoiRelance> Envois { get; } = [];
        public List<RelanceDto> Apres { get; } = [];

        public override Task<List<PieceEnAttente>> PiecesEnAttenteAsync(RelanceDbContext db, FiltrePieces filtre, CancellationToken ct) =>
            Task.FromResult(Pieces.Where(p => (filtre.TiersId is null || p.TiersId == filtre.TiersId) && (filtre.Pieces is null || filtre.Pieces.Contains(p.Id))).ToList());

        public override Task<Dictionary<long, SurchargeTiers>> RegleDuTiersAsync(RelanceDbContext db, IReadOnlyCollection<long> tiers, CancellationToken ct) =>
            Task.FromResult(Surcharges.Where(s => tiers.Contains(s.Key)).ToDictionary());

        public override Task<PorteeRelance> PorteeAsync(RelanceDbContext db, Utilisateur utilisateur, CancellationToken ct) => Task.FromResult(Portee);

        public override async Task<ResultatEnvoi> EnvoyerAsync(RelanceDbContext db, EnvoiRelance envoi, CancellationToken ct)
        {
            if (TiersEnEchec.Contains(envoi.TiersId)) throw new InvalidOperationException("Serveur de courriel indisponible");
            Envois.Add(envoi);
            return await base.EnvoyerAsync(db, envoi, ct);
        }

        public override Task ApresEnvoiAsync(RelanceDbContext db, IReadOnlyList<RelanceDto> relances, CancellationToken ct)
        {
            Apres.AddRange(relances);
            return Task.CompletedTask;
        }
    }

    private RelanceDbContext Db() => new(new DbContextOptionsBuilder<RelanceDbContext>().UseNpgsql(Connexion).UseSnakeCaseNamingConvention().Options);

    private ServiceRelance Service(RelanceDbContext db, DateOnly? jour = null) => new(db, _specialisation, new Horloge(jour ?? Jour));

    private long Id(int n) => _base + n;

    /// <summary>Devis envoyé il y a <paramref name="jours"/> jours.</summary>
    private PieceEnAttente Devis(int n, int tiers, int jours, int? charge = 1, int? groupe = null) =>
        new(Id(n), NatureRelance.Devis, Id(tiers), charge is int c ? Id(c) : null, Jour.AddDays(-jours), 1000m, GroupeId: groupe is int g ? Id(g) : null,
            Numero: $"D{n}");

    /// <summary>Facture dont l'unique échéance est échue depuis <paramref name="jours"/> jours.</summary>
    private PieceEnAttente Facture(int n, int tiers, int jours, int? charge = 1, decimal reste = 500m) =>
        new(Id(n), NatureRelance.Facture, Id(tiers), charge is int c ? Id(c) : null, Echeances: [new EcheanceRelance(Id(n) * 10, Jour.AddDays(-jours), reste)],
            Numero: $"F{n}");

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        if (Connexion is null) return;
        await using var db = Db();
        var bas = _base;
        var haut = _base + 1000;
        await db.Relances.Where(r => r.RelTiersId >= bas && r.RelTiersId < haut).ExecuteDeleteAsync();
        await db.Lots.Where(l => _lots.Contains(l.RloId)).ExecuteDeleteAsync();
        await db.Suspensions.Where(s => (s.RsuEntId >= bas && s.RsuEntId < haut) || (s.RsuTiersId >= bas && s.RsuTiersId < haut)).ExecuteDeleteAsync();
    }

    private async Task<LotDto> PreparerAsync(ServiceRelance s)
    {
        var lot = await s.Preparer(new DemandePreparation(Jour), Admin, default);
        Assert.NotNull(lot);
        _lots.Add(lot.Id);
        return lot;
    }

    [Fact]
    public async Task Preparation_regroupe_par_tiers_charge_nature_et_mode_puis_exclut_les_pieces_proposees()
    {
        if (Connexion is null) return;
        _specialisation.Pieces.AddRange([Facture(1, 100, 20), Facture(2, 100, 40), Devis(3, 100, 20), Devis(4, 101, 5)]);
        await using var db = Db();
        var s = Service(db);

        var dues = await s.Dues(Jour, Admin, default);
        Assert.Equal(2, dues.Count);
        var factures = dues.Single(g => g.Nature == NatureRelance.Facture);
        Assert.Equal((2, 1000m, 40), (factures.Niveau, factures.Montant, factures.Jours));
        Assert.Equal([1, 2], factures.Pieces.Select(p => p.Niveau));

        var lot = await PreparerAsync(s);
        Assert.Equal((EtatLotRelance.Prepare, 3, 2), (lot.Etat, lot.Nombre, lot.Groupes.Count));
        Assert.All(lot.Groupes.SelectMany(g => g.Relances), r => Assert.Equal(EtatRelance.Proposee, r.Etat));
        Assert.Empty(await s.Dues(Jour, Admin, default));
        Assert.Null(await s.Preparer(new DemandePreparation(Jour), Admin, default));
    }

    [Fact]
    public async Task Validation_partielle_echec_d_envoi_puis_annulation()
    {
        if (Connexion is null) return;
        _specialisation.Pieces.AddRange([Facture(1, 100, 20), Facture(2, 100, 20), Devis(3, 101, 20)]);
        _specialisation.TiersEnEchec.Add(Id(101));
        await using var db = Db();
        var s = Service(db);
        var lot = await PreparerAsync(s);
        var factures = lot.Groupes.Single(g => g.Nature == NatureRelance.Facture);
        var devis = lot.Groupes.Single(g => g.Nature == NatureRelance.Devis);

        // Une seule des deux factures retenue, commentaire : le lot devient partiel.
        var retenue = factures.Relances[0].Id;
        var v = await s.Valider(lot.Id, new ValidationLot([new GroupeValide(factures.Groupe, ModeRelance.Courrier, "Appel la veille", [retenue])]), Admin, default);
        Assert.Empty(v.Echecs);
        Assert.Equal(EtatLotRelance.Partiel, v.Lot.Etat);
        var envoi = Assert.Single(_specialisation.Envois);
        Assert.Equal((ModeRelance.Courrier, 1, "Appel la veille"), (envoi.Mode, envoi.Pieces.Count, envoi.Commentaire));
        var faite = v.Lot.Groupes.SelectMany(g => g.Relances).Single(r => r.Id == retenue);
        Assert.Equal((EtatRelance.Envoyee, ModeRelance.Courrier, Jour), (faite.Etat, faite.Mode, faite.Date));
        Assert.Equal([retenue], _specialisation.Apres.Select(r => r.Id));

        // Échec d'envoi : le groupe reste proposé, l'échec est signalé.
        v = await s.Valider(lot.Id, new ValidationLot([new GroupeValide(devis.Groupe)]), Admin, default);
        Assert.Equal(devis.Groupe, Assert.Single(v.Echecs).Groupe);
        Assert.All(v.Lot.Groupes.Single(g => g.Groupe == devis.Groupe).Relances, r => Assert.Equal(EtatRelance.Proposee, r.Etat));
        Assert.Equal(EtatLotRelance.Partiel, v.Lot.Etat);

        // TACHE refusée pour une facture ; groupe inconnu refusé.
        var e = await Assert.ThrowsAsync<ExceptionMetier>(() => s.Valider(lot.Id, new ValidationLot([new GroupeValide(factures.Groupe, ModeRelance.Tache)]), Admin, default));
        Assert.Equal(ErreurRelance.Mode, e.Code);
        e = await Assert.ThrowsAsync<ExceptionMetier>(() => s.Valider(lot.Id, new ValidationLot([new GroupeValide(99)]), Admin, default));
        Assert.Equal(ErreurRelance.GroupeInconnu, e.Code);

        // Annulation du reste : le lot est clos, les pièces annulées redeviennent dues.
        var clos = await s.Annuler(lot.Id, new DemandeAnnulation(), Admin, default);
        Assert.Equal(EtatLotRelance.Envoye, clos.Etat);
        e = await Assert.ThrowsAsync<ExceptionMetier>(() => s.Valider(lot.Id, new ValidationLot([new GroupeValide(devis.Groupe)]), Admin, default));
        Assert.Equal(ErreurRelance.LotClos, e.Code);
        var dues = await s.Dues(Jour, Admin, default);
        Assert.Equal([Id(2), Id(3)], dues.SelectMany(g => g.Pieces).Select(p => p.Id).Order());
    }

    [Fact]
    public async Task Suspension_par_piece_ou_par_tiers_jusqu_a_sa_date()
    {
        if (Connexion is null) return;
        _specialisation.Pieces.AddRange([Facture(1, 100, 20), Facture(2, 100, 20), Devis(3, 101, 20)]);
        await using var db = Db();
        var s = Service(db);

        var e = await Assert.ThrowsAsync<ExceptionMetier>(() => s.EnregistrerSuspension(null, new SuspensionSaisie(Id(1), Id(100), Jour, MotifSuspension.Litige), Admin, default));
        Assert.Equal(ErreurRelance.SuspensionCible, e.Code);
        e = await Assert.ThrowsAsync<ExceptionMetier>(() => s.EnregistrerSuspension(null, new SuspensionSaisie(Id(1), null, Jour, "INCONNU"), Admin, default));
        Assert.Equal(ErreurRelance.SuspensionMotif, e.Code);
        e = await Assert.ThrowsAsync<ExceptionMetier>(() => s.EnregistrerSuspension(null, new SuspensionSaisie(Id(1), null, Jour.AddDays(-1), MotifSuspension.Litige), Admin, default));
        Assert.Equal(ErreurRelance.SuspensionDate, e.Code);

        await s.EnregistrerSuspension(null, new SuspensionSaisie(Id(1), null, Jour.AddDays(10), MotifSuspension.Promesse, "Paiement promis"), Admin, default);
        var tiers = await s.EnregistrerSuspension(null, new SuspensionSaisie(null, Id(101), Jour, MotifSuspension.Echelonnement), Admin, default);
        Assert.Equal([Id(2)], (await s.Dues(Jour, Admin, default)).SelectMany(g => g.Pieces).Select(p => p.Id));
        Assert.Single(await s.Suspensions(Id(1), null, true, default));

        // Le lendemain de la suspension du tiers, son devis revient ; la pièce reste suspendue.
        Assert.Equal([Id(2), Id(3)], (await s.Dues(Jour.AddDays(1), Admin, default)).SelectMany(g => g.Pieces).Select(p => p.Id).Order());
        await s.SupprimerSuspension(tiers.Id, default);
        Assert.Empty(await s.Suspensions(null, Id(101), false, default));
    }

    [Fact]
    public async Task Le_journal_fait_avancer_le_niveau_y_compris_pour_un_autre_indice()
    {
        if (Connexion is null) return;
        _specialisation.Pieces.Add(Devis(1, 100, 20, groupe: 50));
        await using var db = Db();
        var s = Service(db);

        var e = await Assert.ThrowsAsync<ExceptionMetier>(() => s.Noter(new RelanceNotee(Id(1), ModeRelance.Courriel, Jour.AddDays(-10)), Admin, default));
        Assert.Equal(ErreurRelance.RienANoter, e.Code);
        var notee = await s.Noter(new RelanceNotee(Id(1), ModeRelance.Tache, Jour, "Appel du client"), Admin, default);
        Assert.Equal((1, EtatRelance.Envoyee, (long?)null), (notee.Niveau, notee.Etat, notee.LotId));
        Assert.Single(_specialisation.Apres);
        Assert.Empty(await s.Dues(Jour, Admin, default));
        Assert.Equal(2, Assert.Single(Assert.Single(await s.Dues(Jour.AddDays(15), Admin, default)).Pieces).Niveau);

        // Nouvel indice du même devis (même groupe) : la relance du premier compte.
        _specialisation.Pieces.Clear();
        _specialisation.Pieces.Add(Devis(2, 100, 20, groupe: 50));
        Assert.Empty(await s.Dues(Jour, Admin, default));
        Assert.Equal([notee.Id], (await s.Journal(Id(2), Id(50), null, default)).Select(r => r.Id));
        Assert.Equal([notee.Id], (await s.Journal(null, null, Id(100), default)).Select(r => r.Id));
    }

    [Fact]
    public async Task Le_recommande_attend_son_numero()
    {
        if (Connexion is null) return;
        _specialisation.Pieces.AddRange([Facture(1, 100, 61), Facture(2, 100, 70)]);
        await using var db = Db();
        var s = Service(db);
        var lot = await PreparerAsync(s);
        var groupe = Assert.Single(lot.Groupes);
        Assert.Equal((ModeRelance.Recommande, 3), (groupe.Mode, groupe.Niveau));

        var v = await s.Valider(lot.Id, new ValidationLot([new GroupeValide(groupe.Groupe)]), Admin, default);
        Assert.Equal(EtatLotRelance.Envoye, v.Lot.Etat);
        Assert.All(v.Lot.Groupes[0].Relances, r => Assert.Equal(EtatRelance.AttenteNumero, r.Etat));
        Assert.Empty(await s.Dues(Jour, Admin, default));

        var premiere = v.Lot.Groupes[0].Relances[0].Id;
        var e = await Assert.ThrowsAsync<ExceptionMetier>(() => s.SaisirNumero(premiere, new NumeroRecommande(" "), Admin, default));
        Assert.Equal(ErreurRelance.NumeroVide, e.Code);
        var lettre = await s.SaisirNumero(premiere, new NumeroRecommande(" 1A 234 567 8901 2 "), Admin, default);
        Assert.Equal(2, lettre.Count);
        Assert.All(lettre, r => Assert.Equal((EtatRelance.Envoyee, "1A 234 567 8901 2"), (r.Etat, r.Recommande)));
        e = await Assert.ThrowsAsync<ExceptionMetier>(() => s.SaisirNumero(premiere, new NumeroRecommande("X"), Admin, default));
        Assert.Equal(ErreurRelance.PasEnAttenteNumero, e.Code);
    }

    [Fact]
    public async Task Portee_et_surcharges_du_tiers()
    {
        if (Connexion is null) return;
        _specialisation.Pieces.AddRange([Facture(1, 100, 20, charge: 1), Facture(2, 101, 20, charge: 2), Devis(3, 102, 20, charge: null), Devis(4, 103, 20)]);
        _specialisation.Surcharges[Id(102)] = new SurchargeTiers(ModePrefere: ModeRelance.Tache);
        _specialisation.Surcharges[Id(103)] = new SurchargeTiers(NePasRelancer: true);
        _specialisation.Surcharges[Id(101)] = new SurchargeTiers(new RegleRelance([new NiveauRelance(1, 30, ModeRelance.Courrier)]));
        await using var db = Db();
        var s = Service(db);

        // Règle propre du tiers 101 : rien à 20 jours ; « ne pas relancer » : rien ; mode préféré appliqué.
        var dues = await s.Dues(Jour, Admin, default);
        Assert.Equal([Id(1), Id(3)], dues.SelectMany(g => g.Pieces).Select(p => p.Id).Order());
        Assert.Equal(ModeRelance.Tache, dues.Single(g => g.TiersId == Id(102)).Mode);

        // Portée par chargé : une pièce sans chargé n'est vue qu'en portée TOUT.
        var lot = await PreparerAsync(s);
        _specialisation.Portee = new PorteeRelance(false, [Id(2)]);
        Assert.Equal([Id(2)], (await s.Dues(Jour.AddDays(20), Admin, default)).SelectMany(g => g.Pieces).Select(p => p.Id));
        var e = await Assert.ThrowsAsync<ExceptionMetier>(() => s.Valider(lot.Id, new ValidationLot([new GroupeValide(lot.Groupes[0].Groupe)]), Admin, default));
        Assert.Equal(403, e.Statut);
    }

    [Fact]
    public async Task Regle_par_defaut_controlee_et_reservee_a_l_administrateur()
    {
        if (Connexion is null) return;
        await using var db = Db();
        var s = Service(db);
        var regles = await s.Regles(default);
        Assert.Equal([15, 30, 60], regles[NatureRelance.Facture].Niveaux.Select(n => n.Delai));
        Assert.Equal(ModeRelance.Recommande, regles[NatureRelance.Facture].Niveaux[^1].Mode);

        var regle = new RegleRelance([new NiveauRelance(1, 15, ModeRelance.Tache)]);
        await Assert.ThrowsAsync<ExceptionMetier>(() => s.EnregistrerRegle(NatureRelance.Facture, regle, new Utilisateur("u", "UTILISATEUR"), default));
        var e = await Assert.ThrowsAsync<ExceptionMetier>(() => s.EnregistrerRegle(NatureRelance.Facture, regle, Admin, default));
        Assert.Equal(ErreurRelance.NiveauMode, e.Code);
        e = await Assert.ThrowsAsync<ExceptionMetier>(() => s.EnregistrerRegle("AVOIR", regle, Admin, default));
        Assert.Equal(ErreurRelance.Nature, e.Code);
    }
}
