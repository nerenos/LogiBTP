using System.Security.Cryptography.X509Certificates;
using LogiBTP.Installation.Web;
using Xunit;

namespace LogiBTP.Installation.Tests;

public class CertificatsTests
{
    private static readonly DateTimeOffset Maintenant = new(2026, 10, 25, 10, 0, 0, TimeSpan.FromHours(2));

    private static (CertificatEmis Racine, CertificatEmis Serveur) Emettre(string domaine = "logibtp.entreprise.fr")
    {
        var racine = AutoriteCertificats.CreerRacine(domaine, [domaine], Maintenant, "Entreprise");
        return (racine, AutoriteCertificats.Emettre(racine.Certificat, racine.ClePem, AutoriteCertificats.NomsInstallation(domaine), Maintenant));
    }

    [Fact]
    public void Racine_autorite_limitee_au_domaine()
    {
        var (racine, _) = Emettre();
        var c = racine.Certificat;
        Assert.Equal(["logibtp.entreprise.fr"], AutoriteCertificats.NomsPermis(c));
        var contraintes = c.Extensions.OfType<X509BasicConstraintsExtension>().Single();
        Assert.True(contraintes.CertificateAuthority);
        Assert.True(c.Extensions.Single(e => e.Oid?.Value == "2.5.29.30").Critical);
        Assert.Equal(Maintenant.AddYears(10).UtcDateTime, c.NotAfter.ToUniversalTime(), TimeSpan.FromSeconds(1));
    }

    [Fact]
    public void Serveur_joker_730_jours_chaine_valide()
    {
        var (racine, serveur) = Emettre();
        var c = serveur.Certificat;
        Assert.True(c.HasPrivateKey);
        Assert.Equal(["logibtp.entreprise.fr", "*.logibtp.entreprise.fr"], AutoriteCertificats.NomsDns(c));
        Assert.True((c.NotAfter - c.NotBefore).TotalDays <= 825);
        Assert.True(AutoriteCertificats.Couvre(c, "logibtp.entreprise.fr"));
        Assert.True(AutoriteCertificats.Couvre(c, "acme.logibtp.entreprise.fr"));
        Assert.False(AutoriteCertificats.Couvre(c, "a.b.logibtp.entreprise.fr"));
        Assert.False(AutoriteCertificats.Couvre(c, "entreprise.fr"));
        using var chaine = new X509Chain();
        chaine.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
        chaine.ChainPolicy.CustomTrustStore.Add(racine.Certificat);
        chaine.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
        chaine.ChainPolicy.VerificationTime = Maintenant.AddDays(1).UtcDateTime;
        Assert.True(chaine.Build(c), string.Join(", ", chaine.ChainStatus.Select(s => s.StatusInformation)));
        Assert.Throws<ArgumentException>(() => AutoriteCertificats.Emettre(racine.Certificat, racine.ClePem, ["x"], Maintenant, 900));
    }

    [Fact]
    public void Nom_hors_contrainte_refuse_par_la_chaine()
    {
        var (racine, _) = Emettre();
        var etranger = AutoriteCertificats.Emettre(racine.Certificat, racine.ClePem, ["www.banque.fr"], Maintenant);
        using var chaine = new X509Chain();
        chaine.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
        chaine.ChainPolicy.CustomTrustStore.Add(racine.Certificat);
        chaine.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
        chaine.ChainPolicy.VerificationTime = Maintenant.AddDays(1).UtcDateTime;
        Assert.False(chaine.Build(etranger.Certificat));
    }

    [Fact]
    public void Cle_de_la_racine_chiffree_par_la_cle_des_donnees()
    {
        var (racine, _) = Emettre();
        var chiffree = AutoriteCertificats.ChiffrerCle(racine.ClePem, "cle-des-donnees");
        Assert.Contains("ENCRYPTED PRIVATE KEY", chiffree);
        Assert.Equal(racine.ClePem, AutoriteCertificats.DechiffrerCle(chiffree, "cle-des-donnees"));
        Assert.Throws<InvalidOperationException>(() => AutoriteCertificats.DechiffrerCle(chiffree, "autre"));
    }

    [Fact]
    public void Profil_apple_et_script_des_postes()
    {
        var (racine, _) = Emettre();
        var profil = AutoriteCertificats.ProfilApple(racine.Certificat, "logibtp.entreprise.fr");
        Assert.Contains("<string>com.apple.security.root</string>", profil);
        Assert.Contains(Convert.ToBase64String(racine.Certificat.RawData), profil);
        Assert.Equal(profil, AutoriteCertificats.ProfilApple(racine.Certificat, "logibtp.entreprise.fr"));
        System.Xml.Linq.XDocument.Parse(profil, System.Xml.Linq.LoadOptions.None);
        var script = AutoriteCertificats.ScriptPostes(racine.Certificat, "logibtp.entreprise.fr");
        Assert.Contains(racine.Certificat.Thumbprint, script);
        Assert.Contains("'Root', 'LocalMachine'", script);
    }

    [Fact]
    public void Dossier_ecrit_et_relu()
    {
        var dossier = Path.Combine(Path.GetTempPath(), "logibtp-certificats-" + Guid.NewGuid().ToString("N"));
        try
        {
            var (racine, serveur) = Emettre();
            var d = new DossierCertificats(dossier);
            d.Ecrire(OrigineCertificat.LogiBtp, "logibtp.entreprise.fr", serveur.CertificatPem, serveur.ClePem, racine.Certificat, Maintenant);
            Assert.True(d.Present);
            var infos = d.Infos()!;
            Assert.Equal(OrigineCertificat.LogiBtp, infos.Origine);
            Assert.Equal(AutoriteCertificats.Empreinte(racine.Certificat), infos.EmpreinteRacine);
            Assert.Equal(racine.Certificat.Thumbprint, d.LireRacine()!.Thumbprint);
            var cs = new CertificatServeur(d);
            Assert.True(cs.Actif);
            Assert.Equal(serveur.Certificat.Thumbprint, cs.Courant()!.Thumbprint);
            Assert.True(cs.Courant()!.HasPrivateKey);
            var pem = Path.Combine(dossier, "fourni.pem");
            File.WriteAllText(pem, serveur.CertificatPem + "\n" + racine.CertificatPem);
            File.WriteAllText(Path.Combine(dossier, "fourni.key"), serveur.ClePem);
            var (chaine, _, r) = DossierCertificats.LireFourni(pem, Path.Combine(dossier, "fourni.key"), null);
            Assert.Equal(racine.Certificat.Thumbprint, r!.Thumbprint);
            Assert.DoesNotContain(racine.CertificatPem.Trim(), chaine);
        }
        finally { Directory.Delete(dossier, true); }
    }

    [Theory]
    [InlineData("acme.logibtp.entreprise.fr", "logibtp.entreprise.fr", "acme.logibtp.entreprise.fr")]
    [InlineData("LOGIBTP.entreprise.fr", "logibtp.entreprise.fr", "logibtp.entreprise.fr")]
    [InlineData("piege.exemple.com", "logibtp.entreprise.fr", "logibtp.entreprise.fr")]
    [InlineData("192.168.1.10", "logibtp.entreprise.fr", "logibtp.entreprise.fr")]
    [InlineData("", null, null)]
    public void Redirection_vers_le_domaine_seulement(string hote, string? domaine, string? attendu) =>
        Assert.Equal(attendu, ExtensionsHttpsInstallation.DestinationRedirection(hote, domaine));
}
