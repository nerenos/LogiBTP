using LogiBTP.Api.Btp;
using LogiBTP.Installation;
using LogiBTP.Socle;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>Certificat de la base : créé ou renouvelé à 60 jours de l'échéance, code de sortie « changé » (plan securite-base-suites, lot 1).</summary>
public class CertificatBaseTests : IDisposable
{
    private static readonly DateTime Jour = new(2026, 11, 8, 10, 0, 0);
    private readonly string _tmp = Path.Combine(Path.GetTempPath(), "logibtp-cert-" + Guid.NewGuid().ToString("N"));

    public CertificatBaseTests() => Directory.CreateDirectory(_tmp);
    public void Dispose() { try { Directory.Delete(_tmp, true); } catch (IOException) { } }

    [Fact]
    public void Decision_plus_de_60_jours_inchange() =>
        Assert.False(CommandeInstallation.CertificatBaseAEmettre(true, Jour.AddDays(61), Jour));

    [Theory]
    [InlineData(59)]
    [InlineData(60)]
    [InlineData(-5)]
    public void Decision_moins_de_60_jours_renouvele(int reste) =>
        Assert.True(CommandeInstallation.CertificatBaseAEmettre(true, Jour.AddDays(reste), Jour));

    [Fact]
    public void Decision_absent_ou_tls_inactif_emis()
    {
        Assert.True(CommandeInstallation.CertificatBaseAEmettre(true, null, Jour));
        Assert.True(CommandeInstallation.CertificatBaseAEmettre(false, Jour.AddDays(500), Jour));
    }

    [Fact]
    public void Preparation_rejouee_second_passage_inchange()
    {
        var domaine = "logibtp.exemple.fr";
        var env = Path.Combine(_tmp, ".env");
        File.WriteAllText(env, "");
        var dossierBase = Path.Combine(_tmp, "base");
        var certificats = new DossierCertificats(Path.Combine(_tmp, "certificats"));
        Directory.CreateDirectory(certificats.Dossier);
        var cle = Secrets.CleDonnees();
        IConfiguration Config(bool tls) => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            [VariablesEnv.CleChiffrement] = cle,
            [VariablesEnv.Domaine] = domaine,
            [VariablesEnv.BaseSslServeur] = tls ? "1" : null,
        }).Build();
        var maintenant = new DateTimeOffset(DateTime.Now);

        Assert.True(CommandeInstallation.RenouvelerCertificatBase(Config(false), env, domaine, dossierBase, certificats, maintenant, TextWriter.Null));
        Assert.False(CommandeInstallation.RenouvelerCertificatBase(Config(true), env, domaine, dossierBase, certificats, maintenant, TextWriter.Null));
        // À 61 jours de l'échéance (730 jours émis) : inchangé ; à 40 jours : renouvelé.
        Assert.False(CommandeInstallation.RenouvelerCertificatBase(Config(true), env, domaine, dossierBase, certificats, maintenant.AddDays(730 - 61), TextWriter.Null));
        Assert.True(CommandeInstallation.RenouvelerCertificatBase(Config(true), env, domaine, dossierBase, certificats, maintenant.AddDays(730 - 40), TextWriter.Null));
        Assert.Equal(10, CommandeInstallation.CodeCertificatBaseChange);
    }
}
