using LogiBTP.Installation;
using Npgsql;
using Xunit;

namespace LogiBTP.Installation.Tests;

/// <summary>Dérive du schéma (plan versionnement-schema, lot 1) : unitaires sur instantanés construits à la main, puis intégration (LOGIBTP_TEST_PG).</summary>
// Collection commune : les essais sur une vraie base ne se jouent pas en parallèle (la charge fait varier des données tirées au hasard
// par des scripts de démonstration d'avant le lot, ce que compare ScriptsBaseTests).
[Collection("PostgreSQL")]
public class DeriveSchemaTests
{
    private static readonly string? Admin = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");

    private static InstantaneSchema Inst(params (string, string)[] o) => new(o.Select(p => KeyValuePair.Create(p.Item1, p.Item2)));

    private static readonly InstantaneSchema Base = Inst(
        ("table:tiers", "table"), ("colonne:tiers.tie_id", "integer NOT NULL"), ("colonne:tiers.tie_nom", "text NULL"), ("vue:v_tiers", "SELECT 1"));

    [Fact]
    public void Identiques_sans_ecart() => Assert.Empty(DeriveSchema.Comparer(Base, Inst(Base.Objets.Select(p => (p.Key, p.Value)).ToArray()), []));

    [Fact]
    public void Colonne_ajoutee_est_sans_conflit()
    {
        var reel = Inst([.. Base.Objets.Select(p => (p.Key, p.Value)), ("colonne:tiers.tie_note", "text NULL")]);
        var e = Assert.Single(DeriveSchema.Comparer(Base, reel, []));
        Assert.Equal((EcartSchema.Ajoute, "colonne:tiers.tie_note", false), (e.Type, e.Objet, e.EnConflit));
    }

    [Fact]
    public void Vue_modifiee_et_colonne_supprimee_sont_en_conflit()
    {
        var reel = Inst(("table:tiers", "table"), ("colonne:tiers.tie_id", "integer NOT NULL"), ("vue:v_tiers", "SELECT 2"));
        var ecarts = DeriveSchema.Comparer(Base, reel, []);
        Assert.Equal(2, ecarts.Count);
        var nom = Assert.Single(ecarts, e => e.Type == EcartSchema.Supprime);
        Assert.Equal("colonne:tiers.tie_nom", nom.Objet);
        var vue = Assert.Single(ecarts, e => e.Type == EcartSchema.Modifie);
        Assert.Equal(("SELECT 1", "SELECT 2"), (vue.Attendu, vue.Reel));
        Assert.All(ecarts, e => Assert.True(e.EnConflit));
    }

    [Fact]
    public void Table_supprimee_rapportee_seule()
    {
        var ecarts = DeriveSchema.Comparer(Base, Inst(("vue:v_tiers", "SELECT 1")), []);
        Assert.Equal(["table:tiers"], ecarts.Select(e => e.Objet));
    }

    [Fact]
    public void Objets_x_et_prefixes_declares_sont_ignores()
    {
        var reel = Inst([.. Base.Objets.Select(p => (p.Key, p.Value)), ("colonne:tiers.x_region", "text NULL"), ("table:acme_stock", "table"),
            ("colonne:acme_stock.sto_id", "integer NULL"), ("index:acme_stock.ix_a", "CREATE INDEX"), ("index:tiers.acme_ix", "CREATE INDEX")]);
        Assert.Empty(DeriveSchema.Comparer(Base, reel, ["acme_"]));
        Assert.Equal(2, DeriveSchema.Comparer(Base, reel, []).Count(e => e.Type == EcartSchema.Ajoute));
    }

    [Fact]
    public void Json_stable_et_aller_retour()
    {
        var a = Inst(("b", "2"), ("a", "1"));
        var b = Inst(("a", "1"), ("b", "2"));
        Assert.Equal(a.ToJson(), b.ToJson());
        Assert.Equal(a.Empreinte(), InstantaneSchema.DepuisJson(a.ToJson()).Empreinte());
    }

    // ------------------------------------------------------------ intégration

    private static string Racine()
    {
        var d = Directory.CreateTempSubdirectory("logibtp_derive_").FullName;
        Directory.CreateDirectory(Path.Combine(d, "db"));
        File.WriteAllText(Path.Combine(d, "db/a.sql"), """
            CREATE TABLE tiers (tie_id integer PRIMARY KEY, tie_nom text);
            CREATE VIEW v_tiers AS SELECT tie_id, tie_nom FROM tiers;
            """);
        return d;
    }

    private static readonly ScriptManifeste[] Scripts = [new("db/a.sql", false)];

    private static async Task Sql(string connexion, string sql)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, cnx);
        await cmd.ExecuteNonQueryAsync();
    }

    [Fact]
    public async Task Colonne_ajoutee_a_la_main_sans_conflit_vue_modifiee_refus_puis_forcage_inscrit()
    {
        if (Admin is null) return;
        var racine = Racine();
        try
        {
            await using var b = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);
            var moteur = new BaseDonnees(TextWriter.Null);
            await moteur.AppliquerAsync(b.Connexion, racine, Scripts);
            Assert.True((await ControleSchema.ControlerAsync(b.Connexion, racine, Scripts)).Ecarts.Count == 0);

            await Sql(b.Connexion, "ALTER TABLE tiers ADD COLUMN tie_note text; ALTER TABLE tiers ADD COLUMN x_region text");
            var r1 = await ControleSchema.ControlerAsync(b.Connexion, racine, Scripts);
            var e1 = Assert.Single(r1.Ecarts);
            Assert.Equal("colonne:tiers.tie_note", e1.Objet);
            Assert.Empty(r1.Conflits);

            await Sql(b.Connexion, "CREATE OR REPLACE VIEW v_tiers AS SELECT tie_id, tie_nom, tie_note FROM tiers");
            var r2 = await ControleSchema.ControlerAsync(b.Connexion, racine, Scripts);
            var conflit = Assert.Single(r2.Conflits);
            Assert.Equal(("vue:v_tiers", EcartSchema.Modifie), (conflit.Objet, conflit.Type));
            Assert.Contains("attendu", r2.Formater());

            // Forçage : inscrit au journal, puis mise à jour et nouvel instantané.
            await using (var cnx = new NpgsqlConnection(b.Connexion))
            {
                await cnx.OpenAsync();
                await JournalSchema.EnregistrerForcageAsync(cnx, r2.Conflits, "essai");
            }
            await moteur.AppliquerAsync(b.Connexion, racine, Scripts);
            Assert.Empty((await ControleSchema.ControlerAsync(b.Connexion, racine, Scripts)).Ecarts);
            await using var c = new NpgsqlConnection(b.Connexion);
            await c.OpenAsync();
            await using var cmd = new NpgsqlCommand("SELECT ifo_utilisateur, ifo_motif, ifo_base, ifo_ecarts FROM installation_forcage", c);
            await using var rd = await cmd.ExecuteReaderAsync();
            Assert.True(await rd.ReadAsync());
            Assert.Equal(Environment.UserName, rd.GetString(0));
            Assert.Equal("essai", rd.GetString(1));
            Assert.Contains("vue:v_tiers", rd.GetString(3));
        }
        finally { Directory.Delete(racine, true); }
    }

    [Fact]
    public async Task Prefixes_validation_dependances_et_adoption_verifiee()
    {
        if (Admin is null) return;
        var racine = Racine();
        try
        {
            await using var b = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);
            await new BaseDonnees(TextWriter.Null).AppliquerAsync(b.Connexion, racine, Scripts);
            await using var cnx = new NpgsqlConnection(b.Connexion);
            await cnx.OpenAsync();
            await Assert.ThrowsAsync<ArgumentException>(() => JournalSchema.AjouterPrefixeAsync(cnx, "ti", "x"));      // trop court
            await Assert.ThrowsAsync<ArgumentException>(() => JournalSchema.AjouterPrefixeAsync(cnx, "tie_", "x"));    // recouvre nos colonnes
            await Assert.ThrowsAsync<ArgumentException>(() => JournalSchema.AjouterPrefixeAsync(cnx, "tiers_xx_", "x"));
            await JournalSchema.AjouterPrefixeAsync(cnx, "acme_", "Acme");
            await Assert.ThrowsAsync<ArgumentException>(() => JournalSchema.AjouterPrefixeAsync(cnx, "acme_b_", "Autre"));

            await Sql(b.Connexion, "CREATE TABLE acme_stock (id int PRIMARY KEY, tie_id int REFERENCES tiers(tie_id)); CREATE INDEX acme_ix ON tiers(tie_nom)");
            var r = await ControleSchema.ControlerAsync(b.Connexion, racine, Scripts);
            var dep = Assert.Single(r.Ecarts);
            Assert.Equal(EcartSchema.Dependance, dep.Type);
            Assert.True(dep.EnConflit);

            // Adoption vérifiée : la base d'essai (même schéma que le manifeste) ne diffère pas de la référence.
            var csb = new NpgsqlConnectionStringBuilder(Admin);
            var ecarts = await ControleSchema.ComparerAReferenceAsync(Admin, csb.Username!,
                n => new NpgsqlConnectionStringBuilder(Admin) { Database = n, Pooling = false }.ConnectionString, new NpgsqlConnectionStringBuilder(b.Connexion).Database!, racine, Scripts, TextWriter.Null);
            Assert.DoesNotContain(ecarts, e => e.Type != EcartSchema.Dependance);

            await Sql(b.Connexion, "ALTER TABLE tiers DROP COLUMN tie_nom CASCADE");
            ecarts = await ControleSchema.ComparerAReferenceAsync(Admin, csb.Username!,
                n => new NpgsqlConnectionStringBuilder(Admin) { Database = n, Pooling = false }.ConnectionString, new NpgsqlConnectionStringBuilder(b.Connexion).Database!, racine, Scripts, TextWriter.Null);
            Assert.Contains(ecarts, e => e.EnConflit && e.Objet == "colonne:tiers.tie_nom");
        }
        finally { Directory.Delete(racine, true); }
    }
}
