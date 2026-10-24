using System.Text.RegularExpressions;
using LogiBTP.Installation;
using LogiBTP.Socle;
using LogiBTP.Socle.Testing;
using LogiBTP.Socle.Web;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace LogiBTP.Installation.Tests;

public class ManifesteTests
{
    [Fact]
    public void Manifeste_couvre_tous_les_scripts_du_depot()
    {
        var m = ManifesteScripts.Lire(CasPartages.RacineDepot());
        Assert.Empty(m.Ecarts(CasPartages.RacineDepot()));
    }

    [Fact]
    public void Manifeste_dans_l_ordre_modules_puis_coeur()
    {
        var m = ManifesteScripts.Lire(CasPartages.RacineDepot());
        var uniques = m.Scripts.Where(s => !s.Rejouable).Select(s => Path.GetFileName(s.Chemin)).ToList();
        // Ordre binaire des noms de fichiers (007 avant 007b, 019 avant 019b), jamais celui de la locale.
        Assert.Equal(uniques.OrderBy(n => n, StringComparer.Ordinal), uniques);
        Assert.Equal("db/176_documents_vues_types.sql", m.Scripts[^1].Chemin);
        Assert.True(m.Scripts[^1].Rejouable);
    }

    [Theory]
    [InlineData("db/x.sql demo")]
    [InlineData("db/x.txt")]
    [InlineData("../x.sql")]
    [InlineData("db\\x.sql")]
    public void Manifeste_invalide_refuse(string ligne) =>
        Assert.Throws<FormatException>(() => ManifesteScripts.Analyser([ligne]));

    [Fact]
    public void Lecture_du_manifeste()
    {
        var m = ManifesteScripts.Analyser(["# commentaire", "", "db/a.sql", "db/b.sql rejouable"]);
        Assert.Equal([new ScriptManifeste("db/a.sql", false), new ScriptManifeste("db/b.sql", true)], m.Scripts);
    }

    [Fact]
    public void Empreinte_independante_des_fins_de_ligne() =>
        Assert.Equal(BaseDonnees.Empreinte("a\nb"), BaseDonnees.Empreinte("a\r\nb"));
}

public class PostgresTests
{
    [Fact]
    public void PgHba_reseau_docker_et_refus_du_reste()
    {
        var hba = ConfigurationPostgres.PgHba(new ReglagesPostgres { Reseau = "172.30.70.0/24" });
        Assert.Contains("local    all   postgres     peer", hba);
        Assert.Contains("host     all   postgres,logibtp_schema,logibtp_app,logibtp_lecture  172.30.70.0/24  scram-sha-256", hba);
        Assert.DoesNotContain("hostssl", hba);
        Assert.DoesNotContain("trust", hba);
        Assert.EndsWith("reject" + Environment.NewLine, hba);
    }

    [Fact]
    public void PgHba_base_distante_en_tls()
    {
        var hba = ConfigurationPostgres.PgHba(new ReglagesPostgres { AdressesApi = ["10.0.0.5"], Ssl = true });
        Assert.Contains("hostssl  all   postgres,logibtp_schema,logibtp_app,logibtp_lecture  10.0.0.5/32  scram-sha-256", hba);
        Assert.DoesNotContain("host     all   all          10.0.0.5", hba);
        Assert.Throws<ArgumentException>(() => ConfigurationPostgres.PgHba(new ReglagesPostgres { AdressesApi = ["10.0.0.5"] }));
        Assert.Throws<ArgumentException>(() => ConfigurationPostgres.PgHba(new ReglagesPostgres { Reseau = "pas un réseau" }));
    }

    [Fact]
    public void PostgresqlConf_memoire_et_ssl()
    {
        var conf = ConfigurationPostgres.PostgresqlConf(new ReglagesPostgres { MemoireMo = 4096 });
        Assert.Contains("shared_buffers = 1024MB", conf);
        Assert.Contains("effective_cache_size = 3072MB", conf);
        Assert.Contains("work_mem = 32MB", conf);
        Assert.Contains("hba_file = '/etc/logibtp/pg_hba.conf'", conf);
        Assert.Contains("ssl = off", conf);
        Assert.Contains("ssl_key_file = '/var/lib/postgresql/ssl/base.key'", ConfigurationPostgres.PostgresqlConf(new ReglagesPostgres { Ssl = true }));
    }

    [Theory]
    [InlineData("logibtp")]
    [InlineData("logibtp_acme_btp")]
    public void Nom_de_base_accepte(string nom) => Assert.Equal(nom, BaseDonnees.VerifierNom(nom));

    [Theory]
    [InlineData("Logibtp")]
    [InlineData("logibtp-acme")]
    [InlineData("1base")]
    [InlineData("logibtp;drop")]
    public void Nom_de_base_refuse(string nom) => Assert.Throws<ArgumentException>(() => BaseDonnees.VerifierNom(nom));

    [Fact]
    public void Litteral_et_mot_de_passe()
    {
        Assert.Equal("'l''apostrophe'", BaseDonnees.Litteral("l'apostrophe"));
        var mdp = Secrets.MotDePasse();
        Assert.Equal(32, mdp.Length);
        Assert.Matches("^[A-Za-z0-9]+$", mdp);
        Assert.NotEqual(mdp, Secrets.MotDePasse());
    }
}

public class SocietesInstallationTests
{
    [Fact]
    public void Preparation_et_ajout_de_societes()
    {
        var j = SocietesInstallation.Preparer(new(), "LogiBTP.Entreprise.fr", "Entreprise");
        SocietesInstallation.Ajouter(j, "acme-btp", "ACME BTP");
        SocietesInstallation.Ajouter(j, "acme-btp", null);
        SocietesInstallation.Preparer(j, "logibtp.entreprise.fr", null);
        var c = new ConfigurationBuilder().AddJsonStream(new MemoryStream(System.Text.Encoding.UTF8.GetBytes(j.ToJsonString()))).Build();
        Assert.Equal(["localhost", "logibtp.entreprise.fr"], c.GetSection("Societes:Domaines").Get<string[]>()!);
        Assert.Equal("Entreprise", c["Societes:LibellePrincipale"]);
        Assert.Equal("ACME BTP", c["Societes:Liste:acme-btp:Libelle"]);
        Assert.Single(SocietesInstallation.Societes(j));
    }

    [Theory]
    [InlineData("www")]
    [InlineData("a")]
    [InlineData("acme_btp")]
    [InlineData("acme-")]
    [InlineData("1acme")]
    public void Code_de_societe_refuse(string code) => Assert.Throws<ArgumentException>(() => SocietesInstallation.VerifierCode(code));

    [Fact]
    public void Connexions_deduites_du_modele()
    {
        var c = new ConfigurationManager();
        c.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["LOGIBTP_BASE_HOTE"] = "logibtp-base",
            ["LOGIBTP_BASE_MOT_DE_PASSE_APP"] = "secret",
            ["Societes:Liste:acme-btp:Libelle"] = "ACME",
            ["Societes:Liste:autre:Connexion"] = "Host=x;Database=y",
        });
        c.AjouterConnexionsModele();
        Assert.Equal("Host=logibtp-base;Port=5432;Database=logibtp;Username=logibtp_app;GSS Encryption Mode=Disable;Password=secret", c.GetConnectionString("LogiBTP"));
        Assert.Equal("Host=logibtp-base;Port=5432;Database=logibtp_acme_btp;Username=logibtp_app;GSS Encryption Mode=Disable;Password=secret", c["Societes:Liste:acme-btp:Connexion"]);
        Assert.Equal("Host=x;Database=y", c["Societes:Liste:autre:Connexion"]);
    }

    [Fact]
    public void Sans_modele_rien_ne_change()
    {
        var c = new ConfigurationManager();
        c.AddInMemoryCollection(new Dictionary<string, string?> { ["ConnectionStrings:LogiBTP"] = "Host=a" });
        c.AjouterConnexionsModele();
        Assert.Equal("Host=a", c.GetConnectionString("LogiBTP"));
        Assert.Equal("Host=h;Port=5432;Database=logibtp;Username=u;GSS Encryption Mode=Disable;SSL Mode=VerifyFull;Root Certificate=/r.crt",
            new ModeleConnexion("h", Ssl: "VerifyFull", Racine: "/r.crt").Chaine("logibtp", "u", null));
    }
}

public class ClientWebTests
{
    [Fact]
    public void Csp_du_serveur_alignee_sur_vite()
    {
        var vite = File.ReadAllText(CasPartages.Chemin("client/vite.config.js"));
        var bloc = Regex.Match(vite, @"export const CSP = \[(?<d>.*?)\]\.join", RegexOptions.Singleline).Groups["d"].Value;
        var directives = Regex.Matches(bloc, "\"(?<v>[^\"]+)\"").Select(m => m.Groups["v"].Value);
        Assert.Equal(string.Join("; ", directives), ClientWeb.Csp);
    }
}
