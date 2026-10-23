using Xunit;

namespace LogiBTP.Mail.Tests;

public class ReglesEnvoiTests
{
    private static readonly DateTimeOffset T0 = new(2026, 10, 23, 10, 0, 0, TimeSpan.Zero);
    private static readonly Limites L = new(MessagesParMinute: 2, DestinatairesParMessage: 10, DestinatairesParHeure: 10, DestinatairesParJour: 20,
        MessagesParHeureParDomaine: 3, NouveauxParJour: 5);

    private static MessageAEnvoyer M(int destinataires = 1, string priorite = ReglesEnvoi.Normale, int nouveaux = 0, params string[] domaines) =>
        new(destinataires, nouveaux, domaines.Length == 0 ? ["exemple.fr"] : domaines, priorite);

    private static EnvoiPasse P(int minutesAvant, int destinataires = 1, int nouveaux = 0, string domaine = "autre.fr") =>
        new(T0.AddMinutes(-minutesAvant), destinataires, nouveaux, [domaine]);

    [Fact]
    public void Sans_historique_tout_de_suite()
    {
        var c = ReglesEnvoi.Calculer(L, [], M(), T0, 20);
        Assert.True(c.Immediat(T0));
        Assert.Null(c.Cause);
    }

    [Fact]
    public void Debit_par_minute()
    {
        var c = ReglesEnvoi.Calculer(L, [new(T0.AddSeconds(-50), 1, 0, ["a.fr"]), new(T0.AddSeconds(-10), 1, 0, ["a.fr"])], M(), T0, 20);
        Assert.Equal(T0.AddSeconds(10), c.Quand);
        Assert.Equal("débit par minute", c.Cause);
    }

    [Fact]
    public void Quota_horaire_compte_les_destinataires()
    {
        // 8 destinataires il y a 50 min et 1 il y a 10 min : un message à 3 destinataires attend la sortie du premier envoi.
        var c = ReglesEnvoi.Calculer(L, [P(50, 8), P(10, 1)], M(3), T0, 20);
        Assert.Equal(T0.AddMinutes(10), c.Quand);
        Assert.Equal("quota horaire", c.Cause);
        Assert.True(ReglesEnvoi.Calculer(L, [P(50, 8), P(10, 1)], M(1), T0, 20).Immediat(T0));
    }

    [Fact]
    public void Reserve_du_quota_journalier_pour_les_envois_prioritaires()
    {
        // 16 destinataires sur le jour (quota 20, réserve 20 % : 16 pour les envois en nombre).
        var passes = new List<EnvoiPasse> { P(600, 8), P(300, 8) };
        Assert.True(ReglesEnvoi.Calculer(L, passes, M(2), T0, 20).Immediat(T0));
        var basse = ReglesEnvoi.Calculer(L, passes, M(2, ReglesEnvoi.Basse), T0, 20);
        Assert.Equal(T0.AddMinutes(-600).AddDays(1), basse.Quand);
        Assert.Contains("réserve", basse.Cause);
    }

    [Fact]
    public void Messages_par_domaine_et_nouveaux_destinataires()
    {
        var passes = new List<EnvoiPasse> { P(40, 1, 0, "client.fr"), P(30, 1, 0, "client.fr"), P(20, 1, 0, "client.fr") };
        var c = ReglesEnvoi.Calculer(L, passes, M(1, ReglesEnvoi.Normale, 0, "CLIENT.fr"), T0, 20);
        Assert.Equal(T0.AddMinutes(20), c.Quand);
        Assert.Equal("messages par heure vers CLIENT.fr", c.Cause);
        var n = ReglesEnvoi.Calculer(L, [P(100, 1, 4)], M(1, ReglesEnvoi.Normale, 2), T0, 20);
        Assert.Equal(T0.AddMinutes(-100).AddDays(1), n.Quand);
    }

    [Fact]
    public void Message_plus_gros_que_la_limite_part_quand_la_fenetre_est_vide()
    {
        Assert.True(ReglesEnvoi.Calculer(L, [], M(15), T0, 20).Immediat(T0));
        Assert.Equal(T0.AddMinutes(55), ReglesEnvoi.Calculer(L with { DestinatairesParJour = 100 }, [P(5, 1)], M(15), T0, 20).Quand);
    }

    [Fact]
    public void Estimation_d_un_lot_lisse()
    {
        var l = L with { MessagesParHeureParDomaine = 100 };
        var messages = Enumerable.Range(0, 4).Select(_ => M()).ToList();
        var e = ReglesEnvoi.Estimer(l, [], messages, T0, 20);
        Assert.Equal(T0, e.Depart);
        Assert.Equal(T0.AddSeconds(90), e.Fin);
        Assert.Equal(TimeSpan.FromSeconds(30), ReglesEnvoi.Lissage(l));
        // Même domaine : le quatrième message attend la limite par domaine (3 par heure).
        Assert.Equal("messages par heure vers exemple.fr", ReglesEnvoi.Estimer(L, [], messages, T0, 20).Cause);
        var gros = ReglesEnvoi.Estimer(l, [], Enumerable.Range(0, 12).Select(_ => M()).ToList(), T0, 20);
        Assert.Equal("quota horaire", gros.Cause);
        Assert.True(gros.Duree > TimeSpan.FromMinutes(59));
    }

    [Fact]
    public void Quota_jour_reprises_et_decoupage()
    {
        Assert.Equal(50, ReglesEnvoi.TauxQuotaJour(L, [P(10, 6), P(1500, 9), P(60, 4)], T0));
        Assert.Equal(T0.AddMinutes(1), ReglesEnvoi.ProchainEssai(1, T0));
        Assert.Equal(T0.AddMinutes(60), ReglesEnvoi.ProchainEssai(4, T0));
        Assert.Null(ReglesEnvoi.ProchainEssai(5, T0));
        Assert.Equal([3, 3, 1], ReglesEnvoi.Decouper(Enumerable.Range(1, 7).ToList(), 3).Select(x => x.Count));
        Assert.Equal(10, ReglesEnvoi.TauxNonRemise(50, 5));
    }

    [Theory]
    [InlineData(535, "5.7.8 Username and Password not accepted", GenreErreur.Authentification)]
    [InlineData(550, "5.4.5 Daily user sending quota exceeded", GenreErreur.Blocage)]
    [InlineData(421, "4.7.0 Try again later, closing connection (rate limit)", GenreErreur.Blocage)]
    [InlineData(552, "5.7.1 Message rejected: spam detected", GenreErreur.Blocage)]
    [InlineData(451, "4.3.0 Mail server temporarily rejected message", GenreErreur.Temporaire)]
    [InlineData(null, "Connexion impossible", GenreErreur.Temporaire)]
    [InlineData(550, "5.1.1 The email account that you tried to reach does not exist", GenreErreur.Definitive)]
    public void Classement_des_erreurs_SMTP(int? code, string texte, GenreErreur attendu) => Assert.Equal(attendu, ReglesEnvoi.Classer(code, texte));

    [Fact]
    public void Limites_par_defaut_completees()
    {
        Assert.Equal(500, Limites.Defaut("GMAIL").DestinatairesParJour);
        var l = Limites.Completer("GMAIL", new Limites(0, 0, 0, 300, 0, 0));
        Assert.Equal((20, 300), (l.MessagesParMinute, l.DestinatairesParJour));
    }

    [Fact]
    public void Adresses_et_gabarits()
    {
        Assert.True(Adresses.Valide("prenom.nom+devis@exemple.fr"));
        Assert.False(Adresses.Valide("sans-arobase.fr"));
        Assert.False(Adresses.Valide("a@b"));
        var (v, r) = Adresses.Analyser("Claire Durand <claire@durand.fr>; marc@dupuis.fr, CLAIRE@durand.fr, n'importe quoi");
        Assert.Equal([new AdresseSaisie("claire@durand.fr", "Claire Durand"), new AdresseSaisie("marc@dupuis.fr")], v);
        Assert.Equal(["n'importe quoi"], r);
        Assert.Equal("dupuis.fr", Adresses.Domaine("Marc@Dupuis.FR"));
        var vars = new Dictionary<string, string?> { ["numero"] = "DV2026-00012", ["tiers"] = "Durand & fils" };
        Assert.Equal("Devis DV2026-00012 –  Durand &amp; fils", Adresses.Remplir("Devis {{numero}} – {{inconnue}} {{ tiers }}", vars, true));
        Assert.Equal("Durand & fils", Adresses.Remplir("{{tiers}}", vars, false));
        Assert.Equal(["numero", "tiers"], Adresses.Variables("{{numero}} {{tiers}} {{numero}}"));
    }
}
