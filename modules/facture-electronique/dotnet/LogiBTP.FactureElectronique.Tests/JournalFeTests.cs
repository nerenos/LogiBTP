using System.Text.Json.Nodes;
using LogiBTP.FactureElectronique.Web;
using Xunit;

namespace LogiBTP.FactureElectronique.Tests;

/// <summary>Journal chaîné (sans base) : vérification d'une chaîne, altérations détectées, détail sans jeton ; reprises de la file.</summary>
public class JournalFeTests
{
    private static readonly DateTimeOffset Depart = new(2026, 11, 10, 8, 0, 0, 123, TimeSpan.Zero);

    /// <summary>Chaîne construite comme le trigger fn_fe_evenement_chainer.</summary>
    private static List<EvenementFeEntite> Chaine(int n)
    {
        var liste = new List<EvenementFeEntite>();
        var precedente = JournalFe.EmpreinteOrigine;
        for (var i = 1; i <= n; i++)
        {
            var e = new EvenementFeEntite
            {
                FevId = i, FevRang = i, FevFflId = 10 + i, FevType = i == 1 ? EvenementFe.Production : EvenementFe.Depot, FevEtatAvant = i == 1 ? null : EtatFlux.AEnvoyer,
                FevEtatApres = i == 1 ? EtatFlux.AEnvoyer : EtatFlux.Envoye, FevActeur = ActeurFe.Systeme, FevDetail = $$"""{"essai": {{i}}}""",
                FevHorodatage = Depart.AddSeconds(i), FevEmpreintePrecedente = precedente,
            };
            e.FevEmpreinte = JournalFe.Empreinte(e);
            precedente = e.FevEmpreinte;
            liste.Add(e);
        }
        return liste;
    }

    [Fact]
    public void Chaine_intacte_verifiee()
    {
        var c = Chaine(4);
        var v = JournalFe.Verifier(c);
        Assert.True(v.Ok);
        Assert.Equal((4, c[^1].FevEmpreinte), (v.Entrees, v.DerniereEmpreinte));
        Assert.True(JournalFe.Verifier([]).Ok);
    }

    [Fact]
    public void Texte_de_l_empreinte_comme_le_trigger()
    {
        var e = Chaine(1)[0];
        Assert.Equal($"{new string('0', 64)}|1|2026-11-10T08:00:01.123Z|PRODUCTION|11||||A_ENVOYER|SYSTEME||{{\"essai\": 1}}", JournalFe.Texte(e));
    }

    [Fact]
    public void Alterations_detectees()
    {
        var c = Chaine(4);
        c[2].FevDetail = """{"essai": 99}""";
        Assert.Equal((false, 3L, "Entrée modifiée"), (JournalFe.Verifier(c).Ok, JournalFe.Verifier(c).RangRompu!.Value, JournalFe.Verifier(c).Raison));

        c = Chaine(4);
        // Entrée 2 modifiée puis réempreinte : la suivante ne s'y chaîne plus.
        c[1].FevEmpreinte = JournalFe.Empreinte(Modifier(c[1]));
        Assert.Equal((3L, "Chaînage rompu"), (JournalFe.Verifier(c).RangRompu!.Value, JournalFe.Verifier(c).Raison));

        c = Chaine(4);
        c.RemoveAt(1);
        Assert.Equal((3L, "Entrée manquante"), (JournalFe.Verifier(c).RangRompu!.Value, JournalFe.Verifier(c).Raison));
    }

    private static EvenementFeEntite Modifier(EvenementFeEntite e)
    {
        e.FevEtatApres = EtatFlux.Erreur;
        return e;
    }

    [Fact]
    public void Detail_sans_jeton_ni_secret()
    {
        var d = JournalFe.Detail(new { code = "X", jeton = "abc", sous = new { access_token = "t", client_secret = "s", message = "Bearer eyJabc.def" } });
        var n = JsonNode.Parse(d!)!;
        Assert.Null(n["jeton"]);
        Assert.Null(n["sous"]!["access_token"]);
        Assert.Null(n["sous"]!["client_secret"]);
        Assert.DoesNotContain("eyJabc", d);
        Assert.Equal("X", (string?)n["code"]);
        Assert.Null(JournalFe.Detail(null));
    }

    [Fact]
    public void Reprises_1_5_15_60_minutes_puis_plus_rien()
    {
        Assert.Equal([1, 5, 15, 60], FileFlux.Reprises.Select(m => (int)(FileFlux.ProchainEssai(Array.IndexOf(FileFlux.Reprises, m) + 1, Depart)! - Depart).Value.TotalMinutes));
        Assert.Null(FileFlux.ProchainEssai(5, Depart));
        Assert.Null(FileFlux.ProchainEssai(0, Depart));
    }
}
