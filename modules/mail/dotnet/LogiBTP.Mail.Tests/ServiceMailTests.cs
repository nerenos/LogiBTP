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

    private sealed class Journal<T> : Microsoft.Extensions.Logging.ILogger<T>
    {
        public List<string> Lignes { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(Microsoft.Extensions.Logging.LogLevel logLevel) => true;
        public void Log<TState>(Microsoft.Extensions.Logging.LogLevel l, Microsoft.Extensions.Logging.EventId e, TState s, Exception? x, Func<TState, Exception?, string> f) =>
            Lignes.Add($"{f(s, x)} {x}");
    }

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

        /// <summary>Courriels présents dans le dossier INBOX du faux serveur (UID croissants).</summary>
        public List<byte[]> Boite { get; } = [];
        public List<(uint Uid, string Action)> Actions { get; } = [];

        public Task<List<ResultatReleve>> ReleverAsync(ServeurMail imap, AuthMail auth, IReadOnlyList<DossierARelever> dossiers, DateTimeOffset depuis, long tailleMax,
            bool marquerLus, int max, CancellationToken ct)
        {
            var d = dossiers.Single();
            var nouveaux = Boite.Select((eml, i) => (Uid: (uint)(i + 1), Eml: eml)).Where(x => x.Uid > d.DernierUid).ToList();
            return Task.FromResult<List<ResultatReleve>>([new ResultatReleve(d.Nom, 7, (uint)Boite.Count,
                nouveaux.Select(x => new CourrielReleve(d.Nom, d.Role, x.Uid, false, x.Eml, false)).ToList(), null)]);
        }

        public Task ApresRattachementAsync(ServeurMail imap, AuthMail auth, string dossier, uint uid, string action, string? cible, CancellationToken ct)
        {
            Actions.Add((uid, action));
            return Task.CompletedTask;
        }
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

        public List<(long Message, string Element)> Rattaches { get; } = [];
        public List<long> Purges { get; } = [];

        public override Task<DepotRecu> RecevoirAsync(CourrielRecu c, CancellationToken ct) =>
            Task.FromResult(new DepotRecu(1000 + c.Id, c.Pieces.Select((p, i) => new PieceInfo($"ged:{2000 + i}", p.Nom, p.Type, p.Octets.Length)).ToList()));

        public override Task<ElementTrouve?> ResoudreElementAsync(string type, string code, Utilisateur u, CancellationToken ct) =>
            Task.FromResult(code == "DV-1" ? new ElementTrouve("document", "12", "Devis DV-1", "/document/12") : null);

        public override Task<ElementTrouve?> DecrireElementAsync(string type, string id, CancellationToken ct) =>
            Task.FromResult<ElementTrouve?>(new ElementTrouve(type, id, $"{type} {id}", null));

        public override Task RattacherAsync(MessageRattache m, ElementTrouve element, CancellationToken ct)
        {
            Rattaches.Add((m.Id, $"{element.Type}:{element.Id}"));
            return Task.CompletedTask;
        }

        public override Task PurgerAsync(IReadOnlyList<long> documents, CancellationToken ct)
        {
            Purges.AddRange(documents);
            return Task.CompletedTask;
        }

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
        var reception = new ServiceReceptionMail(db, comptes, _transport, _specialisation, nettoyage, NullLogger<ServiceReceptionMail>.Instance, _horloge);
        return (comptes, new ServiceEnvoiMail(db, comptes, reception, _transport, _specialisation, nettoyage, NullLogger<ServiceEnvoiMail>.Instance, _horloge));
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

    private static byte[] Eml(MimeMessage m)
    {
        using var o = new MemoryStream();
        m.WriteTo(o);
        return o.ToArray();
    }

    /// <summary>Courriel ordinaire reçu d'un client, avec une pièce jointe.</summary>
    private static byte[] CourrielClient()
    {
        var m = new MimeMessage { Subject = "Bon pour accord", MessageId = "rep-1@client.fr" };
        m.From.Add(new MailboxAddress("Claire Durand", "claire@durand.fr"));
        m.To.Add(new MailboxAddress("", "commercial@exemple.fr"));
        var b = new BodyBuilder { HtmlBody = "<p>Bon pour accord</p><img src=\"https://suivi.exemple/pixel.png\"><script>x()</script>" };
        b.Attachments.Add("devis-signe.pdf", [1, 2, 3], ContentType.Parse("application/pdf"));
        m.Body = b.ToMessageBody();
        return Eml(m);
    }

    /// <summary>Avis de non-remise (RFC 3464) d'un envoi de l'application.</summary>
    private static byte[] AvisNonRemise(string messageIdOrigine, string adresse)
    {
        var origine = new MimeMessage { Subject = "Devis", MessageId = messageIdOrigine };
        origine.From.Add(new MailboxAddress("", "commercial@exemple.fr"));
        origine.To.Add(new MailboxAddress("", adresse));
        origine.Body = new TextPart("plain") { Text = "…" };
        var statut = new MessageDeliveryStatus();
        statut.StatusGroups.Add([new Header("Reporting-MTA", "dns; mx.exemple.fr")]);
        statut.StatusGroups.Add([new Header("Final-Recipient", $"rfc822; {adresse}"), new Header("Action", "failed"), new Header("Status", "5.1.1"),
            new Header("Diagnostic-Code", "smtp; 550 5.1.1 User unknown")]);
        var rapport = new MultipartReport("delivery-status") { new TextPart("plain") { Text = "Courriel non remis" }, statut, new MessagePart { Message = origine } };
        var m = new MimeMessage { Subject = "Undelivered Mail Returned to Sender", Body = rapport };
        m.From.Add(new MailboxAddress("Mail Delivery System", "mailer-daemon@exemple.fr"));
        m.To.Add(new MailboxAddress("", "commercial@exemple.fr"));
        return Eml(m);
    }

    [Fact]
    public async Task Parcours_de_reception()
    {
        if (Connexion is null) return;
        await using var db = Db();
        var (comptes, envoi) = Services(db);
        var traces = new Journal<ServiceReceptionMail>();
        var reception = new ServiceReceptionMail(db, comptes, _transport, _specialisation, new NettoyageHtmlMail(), traces, _horloge);
        var c = await comptes.CreerAsync(Admin, new SaisieCompte(_code, $"{_code.ToLowerInvariant()}@exemple.fr", null, true, true, "MOT_DE_PASSE", null,
            new ServeurMail("smtp.exemple.fr", 465, "SSL", null, "secret"), new ServeurMail("imap.exemple.fr", 993, "SSL", null, "secret"), null, null, "AUTRE", null,
            false, null, true, $"Boîte {_code}", new OptionsCompte(ApresRattachement: "DEPLACER"), [new DossierCompte("INBOX", "RECEPTION")]), default);
        var alias = (await comptes.AliasAsync(default)).First(a => a.CompteId == c.Id).Id;
        var r = await envoi.EnvoyerAsync(Admin, new DemandeEnvoi(alias, D("inconnu@durand.fr"), null, null, "Devis DV-1", "<p>x</p>", null, "document", "12", null), default);
        await envoi.TraiterFileAsync(50, default);
        var idEnvoi = (await db.Messages.AsNoTracking().FirstAsync(m => m.MmeId == r.Messages[0])).MmeMessageId!;

        _transport.Boite.Add(CourrielClient());
        _transport.Boite.Add(AvisNonRemise(idEnvoi, "inconnu@durand.fr"));
        Assert.True(2 == await reception.ReleverMaintenantAsync(Admin, c.Id, default), string.Join(" | ", traces.Lignes));
        Assert.Equal(0, await reception.ReleverMaintenantAsync(Admin, c.Id, default));

        // Avis de non-remise : destinataire de l'envoi marqué, alerte à l'auteur, avis rattaché à l'élément de l'envoi.
        var detailEnvoi = await envoi.MessageAsync(Admin, r.Messages[0], default);
        Assert.Contains("5.1.1", detailEnvoi.Destinataires.Single(d => d.Role == "A").NonRemis);
        Assert.Contains(_specialisation.Signaux, s => s.Genre == "NON_REMIS");

        // Courriel ordinaire : à rapprocher, HTML nettoyé (ni image distante ni script), pièce rangée.
        var recus = await reception.RecusAsync(Admin, "a-rapprocher", c.Id, 1, 50, default);
        var recu = Assert.Single(recus);
        Assert.Equal(("Bon pour accord", "Claire Durand <claire@durand.fr>", 1), (recu.Objet, recu.Expediteur, recu.NbPieces));
        var detail = await envoi.MessageAsync(Admin, recu.Id, default);
        Assert.DoesNotContain("pixel", detail.CorpsHtml);
        Assert.DoesNotContain("script", detail.CorpsHtml);
        Assert.Equal("claire@durand.fr", detail.Destinataires.Single(d => d.Role == "DE").Adresse);

        // Rattachement manuel par le numéro : lien, suites de l'application, action sur le serveur (option DEPLACER).
        await Assert.ThrowsAsync<ExceptionMetier>(() => reception.RattacherAsync(Admin, recu.Id, new DemandeRattachement("document", null, "INCONNU"), default));
        var liens = await reception.RattacherAsync(Admin, recu.Id, new DemandeRattachement("document", null, "DV-1"), default);
        Assert.Equal(("document", "12", "MANUEL"), (liens.Single().Type, liens.Single().Id, liens.Single().Origine));
        Assert.Contains((recu.Id, "document:12"), _specialisation.Rattaches);
        Assert.Contains((1u, "DEPLACER"), _transport.Actions);
        Assert.Empty(await reception.RecusAsync(Admin, "a-rapprocher", c.Id, 1, 50, default));
        await reception.DetacherAsync(Admin, recu.Id, "document", "12", default);
        Assert.Single(await reception.RecusAsync(Admin, "a-rapprocher", c.Id, 1, 50, default));

        // Ignorer : retiré de la liste, document de la GED purgé ; un utilisateur hors des services du compte ne voit rien.
        await reception.IgnorerAsync(Admin, recu.Id, "publicité", default);
        Assert.Contains(1000 + recu.Id, _specialisation.Purges);
        Assert.Empty(await reception.RecusAsync(Admin, "a-rapprocher", c.Id, 1, 50, default));
        Assert.Empty(await reception.RecusAsync(new Utilisateur("autre", "SAISIE"), "tous", c.Id, 1, 50, default));
        await Assert.ThrowsAsync<ExceptionMetier>(() => reception.ReleverMaintenantAsync(new Utilisateur("autre", "SAISIE"), c.Id, default));
    }

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

        // Envoi automatique (notifications…) : expéditeur de l'usage, dans un lot (priorité basse), sans confirmation.
        Assert.True(await envoi.DisponibleAsync(default));
        var lot = await envoi.CreerLotAsync("NOTIFICATION", "Essai", "mail_fond", 2, 2, default);
        var auto = await envoi.EnvoyerAutomatiqueAsync(new EnvoiAutomatique("NOTIFICATION", D("n1@client.fr"), "[LogiBTP] Rappel", "<p>Texte</p>", "mail_fond", Lot: lot), default);
        var detailAuto = await envoi.MessageAsync(Admin, auto.Messages[0], default);
        Assert.Equal(("BASSE", lot), (detailAuto.Message.Priorite, detailAuto.Message.Lot));

        // Authentification refusée : compte en erreur, le courriel attend.
        _horloge.Maintenant = _horloge.Maintenant.AddMinutes(5);
        await envoi.EnvoyerAsync(Admin, new DemandeEnvoi(alias, D("z@client.fr"), null, null, "Auth", "", null, null, null, null), default);
        _transport.Erreur = new ErreurEnvoi(535, "5.7.8 Username and Password not accepted");
        await envoi.TraiterFileAsync(50, default);
        Assert.Equal("ERREUR", (await db.Comptes.AsNoTracking().FirstAsync(x => x.McoId == c.Id)).McoEtat);
        var attente = await envoi.MessagesAsync(Admin, "attente", null, null, null, 1, 50, default);
        Assert.Contains(attente, x => x.Objet == "Auth" && x.Etat == "A_ENVOYER");
        Assert.Contains(attente, x => x.Attente?.Contains("authentification") == true);
    }
}
