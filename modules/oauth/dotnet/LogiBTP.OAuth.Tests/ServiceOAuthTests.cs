using System.Text;
using LogiBTP.OAuth.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;

namespace LogiBTP.OAuth.Tests;

/// <summary>
/// Parcours complet d'une connexion avec un faux fournisseur (aucun appel réseau) : autorisation, retour, jeton,
/// renouvellement, rappel d'échéance, refus du fournisseur, reconnexion avec un autre compte. Base PostgreSQL où le
/// schéma 004 est chargé : variable LOGIBTP_TEST_PG, sinon le test ne fait rien.
/// </summary>
public sealed class ServiceOAuthTests : IAsyncLifetime
{
    private static readonly string? Connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");
    private readonly string _code = $"T{Guid.NewGuid():N}"[..20].ToUpperInvariant();
    private readonly Horloge _horloge = new(new DateTimeOffset(2026, 10, 23, 8, 0, 0, TimeSpan.Zero));
    private readonly FauxClient _client = new();
    private readonly SpecialisationTest _specialisation = new();
    private static readonly Utilisateur Admin = new("admin.test", "ADMIN");

    private sealed class Horloge(DateTimeOffset depart) : TimeProvider
    {
        public DateTimeOffset Maintenant { get; set; } = depart;
        public override DateTimeOffset GetUtcNow() => Maintenant;
    }

    private sealed class FauxClient() : ClientOAuth(new HttpClient())
    {
        public string Compte { get; set; } = "boite.essai@gmail.com";
        public int Rafraichissements { get; private set; }
        public bool Refuser { get; set; }

        public override Task<ReponseJeton> EchangerCodeAsync(FournisseurEntite f, ClientFournisseur c, string code, string verificateur, string adresseRetour, CancellationToken ct)
        {
            Assert.Equal("secret", c.Secret);
            var charge = ReglesOAuth.Base64Url(Encoding.UTF8.GetBytes($$"""{"email":"{{Compte}}"}"""));
            return Task.FromResult(new ReponseJeton($"acces-{code}", "rafraichissement-1", "Bearer", 3600, null, null, $"e.{charge}.s"));
        }

        public override Task<ReponseJeton> RafraichirAsync(FournisseurEntite f, ClientFournisseur c, string rafraichissement, string? portees, CancellationToken ct)
        {
            if (Refuser) throw new ErreurOAuth("invalid_grant", "Token has been expired or revoked.");
            Rafraichissements++;
            return Task.FromResult(new ReponseJeton($"acces-r{Rafraichissements}", null, "Bearer", 3600, null, null, null));
        }

        public override Task RevoquerAsync(FournisseurEntite f, ClientFournisseur c, string jeton, CancellationToken ct) => Task.CompletedTask;
    }

    private sealed class SpecialisationTest : SpecialisationOAuth
    {
        public List<SignalOAuth> Signaux { get; } = [];

        public override Task<IReadOnlyList<string>> DestinatairesAsync(IReadOnlyList<string> droits, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<string>>(["admin.test"]);

        public override Task SignalerAsync(SignalOAuth signal, IReadOnlyList<string> destinataires, CancellationToken ct)
        {
            Signaux.Add(signal);
            return Task.CompletedTask;
        }
    }

    private OAuthDbContext Db() => new(new DbContextOptionsBuilder<OAuthDbContext>().UseNpgsql(Connexion).UseSnakeCaseNamingConvention().Options);

    private ServiceOAuth Service(OAuthDbContext db) => new(db, new Chiffrement("chaine-de-test"), _client, _specialisation,
        Options.Create(new OptionsOAuth()), new SocieteCourante(null, "Test", Connexion!), new ServiceCollection().BuildServiceProvider(), _horloge);

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        if (Connexion is null) return;
        await using var db = Db();
        await db.Connexions.Where(c => c.OcoCode == _code).ExecuteDeleteAsync();
    }

    private async Task<string> StateAsync(OAuthDbContext db, long id) =>
        await db.Autorisations.AsNoTracking().Where(a => a.OauOcoId == id).OrderByDescending(a => a.OauExpireLe).Select(a => a.OauState).FirstAsync();

    [Fact]
    public async Task Parcours_complet_d_une_connexion_Google_en_mode_test()
    {
        if (Connexion is null) return;
        await using var db = Db();
        var s = Service(db);
        var c = await s.CreerAsync(Admin, new SaisieConnexion(_code, "Gmail essais", "GOOGLE", null, true), default);
        Assert.Equal("A_CONNECTER", c.Etat);
        Assert.Equal("openid email https://mail.google.com/", c.Portees);
        await Assert.ThrowsAsync<ExceptionMetier>(() => s.AutoriserAsync(Admin, c.Id, "http://localhost:5173", false, default));
        await s.EnregistrerClientAsync(Admin, c.Id, new SaisieClient("client-1", "secret", null, null), default);
        await Assert.ThrowsAsync<ExceptionMetier>(() => s.AutoriserAsync(new Utilisateur("autre", "UTILISATEUR"), c.Id, "http://localhost:5173", false, default));

        var url = await s.AutoriserAsync(Admin, c.Id, "http://localhost:5173", false, default);
        Assert.Contains("client_id=client-1", url);
        var r = await s.TerminerAsync(await StateAsync(db, c.Id), "c1", null, default);
        Assert.True(r.Ok, r.Message);
        Assert.Equal("http://localhost:5173", r.Origine);
        Assert.False((await s.TerminerAsync("_.deja-utilise", "c1", null, default)).Ok);

        var lue = await db.Connexions.AsNoTracking().FirstAsync(x => x.OcoId == c.Id);
        Assert.Equal("OK", lue.OcoEtat);
        Assert.StartsWith(Chiffrement.Prefixe, lue.OcoCompte);
        Assert.StartsWith(Chiffrement.Prefixe, lue.OcoJetons);
        Assert.DoesNotContain("acces-c1", lue.OcoJetons);
        Assert.Equal(_horloge.Maintenant.AddDays(7), lue.OcoRafraichissementExpireLe);
        Assert.Equal("boite.essai@gmail.com", await s.CompteAsync(Admin, c.Id, default));

        // Jeton valable : rendu tel quel ; expiré : renouvelé.
        var j = await s.JetonAsync(c.Id, default);
        Assert.Equal(("acces-c1", "boite.essai@gmail.com"), (j.Jeton, j.Compte));
        _horloge.Maintenant = _horloge.Maintenant.AddHours(2);
        Assert.Equal("acces-r1", (await s.JetonAsync(c.Id, default)).Jeton);

        // Rappel à moins d'un jour de la fin de l'autorisation (mode test : 7 jours), une seule fois.
        await s.PasserAsync(default);
        Assert.Empty(_specialisation.Signaux);
        _horloge.Maintenant = _horloge.Maintenant.AddDays(6);
        await s.PasserAsync(default);
        await s.PasserAsync(default);
        var rappels = _specialisation.Signaux.Where(x => x.Genre == "RAPPEL").ToList();
        Assert.Single(rappels);
        Assert.Contains("dans 1 jour", rappels[0].Titre);

        // Refus du fournisseur : à reconnecter, signal immédiat, CONNEXION_A_RECONNECTER pour les modules.
        _client.Refuser = true;
        _horloge.Maintenant = _horloge.Maintenant.AddHours(2);
        var e = await Assert.ThrowsAsync<ExceptionMetier>(() => s.JetonAsync(c.Id, default));
        Assert.Equal(IFournisseurJeton.AReconnecter, e.Code);
        Assert.Single(_specialisation.Signaux, x => x.Genre == "ECHEC");
        Assert.Equal("A_RECONNECTER", (await s.DetailAsync(Admin, c.Id, default)).Etat);

        // Reconnexion avec un autre compte : refusée sans confirmation, acceptée avec.
        _client.Refuser = false;
        _client.Compte = "autre.boite@gmail.com";
        await s.AutoriserAsync(Admin, c.Id, "http://localhost:5173", false, default);
        Assert.False((await s.TerminerAsync(await StateAsync(db, c.Id), "c2", null, default)).Ok);
        await s.AutoriserAsync(Admin, c.Id, "http://localhost:5173", true, default);
        Assert.True((await s.TerminerAsync(await StateAsync(db, c.Id), "c3", null, default)).Ok);
        Assert.Equal("autre.boite@gmail.com", (await s.JetonAsync(c.Id, default)).Compte);
    }
}
