using LogiBTP.Mail.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using MimeKit;
using Xunit;

namespace LogiBTP.Mail.Tests;

/// <summary>
/// Parcours de l'envoi avec un faux transport (aucun serveur) : compte chiffré et alias, mise en file, envoi, journal,
/// limitation qui met en attente, confirmation d'un envoi groupé, erreurs classées (définitive, authentification,
/// blocage → compte suspendu). Base PostgreSQL où le schéma 007 est chargé : variable LOGIBTP_TEST_PG, sinon rien.
/// </summary>
public sealed class ServiceMailTests : IAsyncLifetime
{
    private static readonly string? Connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");
    private static readonly Utilisateur Admin = new("admin.test", "ADMIN");
    private readonly string _code = $"T{Guid.NewGuid():N}"[..20].ToUpperInvariant();
    private readonly Horloge _horloge = new(new DateTimeOffset(2026, 10, 23, 8, 0, 0, TimeSpan.Zero));
    private readonly FauxTransport _transport = new();
    private readonly SpecialisationTest _specialisation = new();
    private readonly Chiffrement _chiffrement = new("chaine-de-test");

    private sealed class Horloge(DateTimeOffset depart) : TimeProvider
    {
        public DateTimeOffset Maintenant { get; set; } = depart;
        public override DateTimeOffset GetUtcNow() => Maintenant;
    }

    private sealed class FauxTransport : ITransportMail
    {
        public List<MimeMessage> Envoyes { get; } = [];
        public ErreurEnvoi? Erreur { get; set; }

        public Task EnvoyerAsync(ServeurMail smtp, AuthMail auth, MimeMessage message, CancellationToken ct)
        {
            Assert.Equal(("smtp.exemple.fr", "secret"), (smtp.Hote, auth.MotDePasse));
            if (Erreur is not null) throw Erreur;
            Envoyes.Add(message);
            return Task.CompletedTask;
        }

        public Task CopierEnvoyesAsync(ServeurMail imap, AuthMail auth, MimeMessage message, CancellationToken ct) => Task.CompletedTask;
        public Task TesterAsync(ServeurMail? smtp, AuthMail? a, ServeurMail? imap, AuthMail? b, CancellationToken ct) => Erreur is null ? Task.CompletedTask : throw Erreur;
    }

    private sealed class SpecialisationTest : SpecialisationMail
    {
        public List<SignalMail> Signaux { get; } = [];
        public List<CourrielEnvoye> Apres { get; } = [];

        public override Task<List<PieceInfo>> PiecesAsync(IReadOnlyList<string> references, Utilisateur u, CancellationToken ct) =>
            Task.FromResult(references.Where(r => r == "ged:1").Select(r => new PieceInfo(r, "devis.pdf", "application/pdf", 3)).ToList());

        public override Task<PieceContenu?> LirePieceAsync(string reference, CancellationToken ct) =>
            Task.FromResult<PieceContenu?>(new PieceContenu("devis.pdf", "application/pdf", [1, 2, 3]));

        public override Task<long?> ApresEnvoiAsync(CourrielEnvoye c, CancellationToken ct)
        {
            Apres.Add(c);
            return Task.FromResult<long?>(42);
        }

        public override Task<IReadOnlyList<string>> AdministrateursAsync(CancellationToken ct) => Task.FromResult<IReadOnlyList<string>>(["admin.test"]);

        public override Task SignalerAsync(SignalMail s, IReadOnlyList<string> destinataires, CancellationToken ct)
        {
            Signaux.Add(s);
            return Task.CompletedTask;
        }
    }

    private MailDbContext Db() => new(new DbContextOptionsBuilder<MailDbContext>().UseNpgsql(Connexion).UseSnakeCaseNamingConvention().Options);

    private (ServiceComptesMail, ServiceEnvoiMail) Services(MailDbContext db)
    {
        var nettoyage = new NettoyageHtmlMail();
        var comptes = new ServiceComptesMail(db, _chiffrement, _transport, _specialisation, nettoyage, NullLogger<ServiceComptesMail>.Instance, _horloge);
        return (comptes, new ServiceEnvoiMail(db, comptes, _transport, _specialisation, nettoyage, NullLogger<ServiceEnvoiMail>.Instance, _horloge));
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        if (Connexion is null) return;
        await using var db = Db();
        var id = await db.Comptes.Where(c => c.McoCode == _code).Select(c => (long?)c.McoId).FirstOrDefaultAsync();
        if (id is null) return;
        var lots = await db.Messages.Where(m => m.MmeMcoId == id).Select(m => m.MmeMloId).ToListAsync();
        await db.Messages.Where(m => m.MmeMcoId == id).ExecuteDeleteAsync();
        await db.Lots.Where(l => lots.Contains(l.MloId)).ExecuteDeleteAsync();
        await db.Comptes.Where(c => c.McoId == id).ExecuteDeleteAsync();
    }

    private static List<DestinataireSaisi> D(params string[] a) => a.Select(x => new DestinataireSaisi(x)).ToList();

    [Fact]
    public async Task Parcours_d_envoi()
    {
        if (Connexion is null) return;
        await using var db = Db();
        var (comptes, envoi) = Services(db);
        var adresse = $"{_code.ToLowerInvariant()}@exemple.fr";
        var limites = new Limites(MessagesParMinute: 2, DestinatairesParMessage: 3, DestinatairesParHeure: 100, DestinatairesParJour: 100, MessagesParHeureParDomaine: 100, NouveauxParJour: 100);
        var c = await comptes.CreerAsync(Admin, new SaisieCompte(_code, adresse, "Service essai", true, false, "MOT_DE_PASSE", null,
            new ServeurMail("smtp.exemple.fr", 465, "SSL", null, "secret"), null, null, "<p>Signature</p>", "AUTRE", limites, false, null, true, $"Essai {_code}"), default);
        Assert.Equal($"Essai {_code}", c.Alias);
        Assert.Equal("A_VERIFIER", c.Etat);
        Assert.False(c.Smtp!.IdentifiantConfigure);
        var brut = await db.Comptes.AsNoTracking().FirstAsync(x => x.McoId == c.Id);
        Assert.StartsWith(Chiffrement.Prefixe, brut.McoIdentite);
        Assert.DoesNotContain(adresse, brut.McoIdentite);
        Assert.DoesNotContain("secret", brut.McoConnexion);
        Assert.Equal(adresse, (await comptes.AdresseAsync(Admin, c.Id, default)).Adresse);
        Assert.Equal("OK", (await comptes.TesterAsync(Admin, c.Id, default)).Etat);
        // Même adresse : refusée ; connexion non chiffrée : refusée.
        await Assert.ThrowsAsync<ExceptionMetier>(() => comptes.CreerAsync(Admin, new SaisieCompte(_code + "B", adresse.ToUpperInvariant(), null, true, false, "MOT_DE_PASSE", null,
            new ServeurMail("smtp.exemple.fr", 465, "SSL", null, "x"), null, null, null, "AUTRE", null, false, null, true, null), default));
        var alias = (await comptes.AliasAsync(default)).First(a => a.CompteId == c.Id).Id;

        // Envoi simple : mis en file, puis envoyé par le passage de fond, journalisé, suites appelées.
        var r = await envoi.EnvoyerAsync(Admin, new DemandeEnvoi(alias, D("claire@durand.fr"), null, null, "Devis DV-1", "<p>Bonjour</p><script>alert(1)</script>", ["ged:1"],
            "document", "12", "DOCUMENT_VENTE"), default);
        Assert.False(r.EnAttente);
        await Assert.ThrowsAsync<ExceptionMetier>(() => envoi.EnvoyerAsync(Admin, new DemandeEnvoi(alias, D("pas-une-adresse"), null, null, "x", "", null, null, null, null), default));
        Assert.Equal(1, await envoi.TraiterFileAsync(50, default));
        var m = Assert.Single(_transport.Envoyes);
        Assert.Equal(("Devis DV-1", "Service essai"), (m.Subject, ((MailboxAddress)m.From[0]).Name));
        Assert.Single(m.Attachments);
        Assert.Contains("Signature", m.HtmlBody);
        Assert.DoesNotContain("alert", m.HtmlBody);
        var detail = await envoi.MessageAsync(Admin, r.Messages[0], default);
        Assert.Equal(("ENVOYE", 42L), (detail.Message.Etat, detail.Message.DgeId));
        Assert.Equal("OK", Assert.Single(detail.Journal).Resultat);
        Assert.Equal("document", Assert.Single(_specialisation.Apres).TypeElement);

        // Débit de 2 messages par minute : le troisième attend son créneau.
        await envoi.EnvoyerAsync(Admin, new DemandeEnvoi(alias, D("a@client.fr"), null, null, "Deux", "", null, null, null, null), default);
        var t = await envoi.EnvoyerAsync(Admin, new DemandeEnvoi(alias, D("b@client.fr"), null, null, "Trois", "", null, null, null, null), default);
        Assert.True(t.EnAttente);
        Assert.Equal("débit par minute", t.Cause);
        Assert.Equal(1, await envoi.TraiterFileAsync(50, default));
        _horloge.Maintenant = _horloge.Maintenant.AddMinutes(2);
        Assert.Equal(1, await envoi.TraiterFileAsync(50, default));
        Assert.Contains(_specialisation.Signaux, s => s.Genre == "PARTI");

        // Au-delà de 3 destinataires par message : découpage en CCI ; confirmation exigée au-delà du seuil (paramètre).
        var seuil = await comptes.ParametreAsync("seuil_envoi_groupe", 50, default);
        await comptes.EnregistrerParametresAsync(Admin, new Dictionary<string, int> { ["seuil_envoi_groupe"] = 4 }, default);
        try
        {
            var demande = new DemandeEnvoi(alias, D("x@a.fr"), null, D("c1@a.fr", "c2@a.fr", "c3@a.fr", "c4@a.fr", "c5@a.fr"), "Groupé", "", null, null, null, null);
            var e = await Assert.ThrowsAsync<ExceptionMetier>(() => envoi.EnvoyerAsync(Admin, demande, default));
            Assert.Equal("MAIL_CONFIRMATION", e.Code);
            var g = await envoi.EnvoyerAsync(Admin, demande with { ConfirmationMassive = true }, default);
            Assert.Equal(2, g.Messages.Count);
            Assert.NotNull(g.Lot);
        }
        finally
        {
            await comptes.EnregistrerParametresAsync(Admin, new Dictionary<string, int> { ["seuil_envoi_groupe"] = seuil }, default);
        }

        // Erreur définitive : message en erreur, auteur prévenu.
        _horloge.Maintenant = _horloge.Maintenant.AddMinutes(5);
        _transport.Erreur = new ErreurEnvoi(550, "5.1.1 The email account that you tried to reach does not exist");
        await envoi.TraiterFileAsync(1, default);
        Assert.Contains(_specialisation.Signaux, s => s.Genre == "ERREUR");

        // Blocage de l'hébergeur : compte suspendu, envois groupés suspendus, administrateurs prévenus ; reprise.
        _transport.Erreur = new ErreurEnvoi(550, "5.4.5 Daily user sending quota exceeded");
        await envoi.TraiterFileAsync(50, default);
        Assert.Equal("SUSPENDU", (await db.Comptes.AsNoTracking().FirstAsync(x => x.McoId == c.Id)).McoEtat);
        Assert.Contains(_specialisation.Signaux, s => s.Genre == "BLOCAGE");
        _horloge.Maintenant = _horloge.Maintenant.AddHours(2);
        await envoi.TraiterFileAsync(50, default);
        Assert.Contains(await envoi.MessagesAsync(Admin, "attente", null, null, null, 1, 50, default), x => x.Etat == "SUSPENDU");
        _transport.Erreur = null;
        var compteurs = await envoi.ReprendreAsync(Admin, c.Id, default);
        Assert.Equal("OK", compteurs.First(x => x.Compte == c.Id).Etat);
        _horloge.Maintenant = _horloge.Maintenant.AddMinutes(1);
        Assert.True(await envoi.TraiterFileAsync(50, default) >= 1);

        // Authentification refusée : compte en erreur, le courriel attend.
        _horloge.Maintenant = _horloge.Maintenant.AddMinutes(5);
        await envoi.EnvoyerAsync(Admin, new DemandeEnvoi(alias, D("z@client.fr"), null, null, "Auth", "", null, null, null, null), default);
        _transport.Erreur = new ErreurEnvoi(535, "5.7.8 Username and Password not accepted");
        await envoi.TraiterFileAsync(50, default);
        Assert.Equal("ERREUR", (await db.Comptes.AsNoTracking().FirstAsync(x => x.McoId == c.Id)).McoEtat);
        Assert.Contains(await envoi.MessagesAsync(Admin, "attente", null, null, null, 1, 50, default), x => x.Objet == "Auth" && x.Attente!.Contains("authentification"));
    }
}
