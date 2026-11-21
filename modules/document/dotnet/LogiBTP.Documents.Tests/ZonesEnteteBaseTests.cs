using LogiBTP.Documents.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Testing;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace LogiBTP.Documents.Tests;

/// <summary>
/// Zones d'entête (colonnes x_ de document) sur une base PostgreSQL neuve : tables type_document et document réduites à
/// leurs clés, puis la mineure 1.2 du module. Variable LOGIBTP_TEST_PG_ADMIN (superutilisateur, base postgres), sinon ignorés.
/// </summary>
public sealed class ZonesEnteteBaseTests
{
    private static readonly string? Admin = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG_ADMIN");
    private static readonly Utilisateur Chef = new("admin", Profils.Admin);
    private static readonly Utilisateur Simple = new("jean", "UTILISATEUR");

    private sealed class Contexte(DbContextOptions options) : DocumentDbContext<Document, DocumentLigne>(options);

    private sealed class Purge : IPurgeCacheBase
    {
        public List<string> Appels { get; } = [];
        public void Purger(string connexion) => Appels.Add(connexion);
    }

    private sealed class BaseZones : IAsyncDisposable
    {
        private readonly string _nom = "test_zones_" + Guid.NewGuid().ToString("N")[..12];
        public string Connexion => new NpgsqlConnectionStringBuilder(Admin!) { Database = _nom, Pooling = false }.ConnectionString;

        public static async Task<BaseZones> CreerAsync(bool journal = true)
        {
            var b = new BaseZones();
            await Executer(Admin!, $"CREATE DATABASE {b._nom} ENCODING 'UTF8' TEMPLATE template0");
            await Executer(b.Connexion, """
                CREATE TABLE type_document (tyd_id SERIAL PRIMARY KEY, tyd_code VARCHAR(20) NOT NULL);
                CREATE TABLE document (ent_id BIGSERIAL PRIMARY KEY, ent_numero TEXT);
                CREATE TABLE autre_table (aut_id SERIAL PRIMARY KEY);
                INSERT INTO type_document (tyd_code) VALUES ('DEV'), ('FAC');
                """);
            await Executer(b.Connexion, await File.ReadAllTextAsync(CasPartages.Chemin("modules", "document", "db", "1.2_zones_entete.sql")));
            if (journal) await Executer(b.Connexion, """
                CREATE TABLE installation_script (isc_chemin TEXT PRIMARY KEY, isc_empreinte TEXT NOT NULL, isc_applique_le TIMESTAMPTZ NOT NULL DEFAULT now(),
                    isc_module TEXT, isc_version TEXT, isc_type TEXT, isc_origine TEXT NOT NULL DEFAULT 'logibtp');
                """);
            return b;
        }

        public async ValueTask DisposeAsync()
        {
            NpgsqlConnection.ClearAllPools();
            await Executer(Admin!, $"DROP DATABASE IF EXISTS {_nom} WITH (FORCE)");
        }
    }

    private static async Task Executer(string connexion, string sql)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, cnx);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<object?> Scalaire(string connexion, string sql)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, cnx);
        var v = await cmd.ExecuteScalarAsync();
        return v is DBNull ? null : v;
    }

    private static (ZonesEnteteDocument<Document, DocumentLigne> Service, Contexte Db, Purge Purge) Service(string connexion)
    {
        var db = new Contexte(new DbContextOptionsBuilder<Contexte>().UseNpgsql(connexion).UseSnakeCaseNamingConvention().Options);
        var purge = new Purge();
        return (new ZonesEnteteDocument<Document, DocumentLigne>(db, new IPurgeCacheBase[] { purge }), db, purge);
    }

    private static DemandeZoneEntete Demande(string colonne, string type, string libelle = "Libellé", int ordre = 0, List<OptionZone>? valeurs = null,
        string? famille = null, string? typeDocument = null, string? groupe = null, bool obligatoire = false) =>
        new() { Colonne = colonne, Type = type, Libelle = libelle, Ordre = ordre, Valeurs = valeurs, Famille = famille, TypeDocument = typeDocument, Groupe = groupe, Obligatoire = obligatoire };

    private static async Task<ExceptionMetier> Refuse(Func<Task> acte, int statut)
    {
        var e = await Assert.ThrowsAsync<ExceptionMetier>(acte);
        Assert.Equal(statut, e.Statut);
        return e;
    }

    private static void AssertCodes(ExceptionMetier e, params string[] attendus) => Assert.Equal(attendus, Codes(e));

    private static string[] Codes(ExceptionMetier e) => ((IReadOnlyList<ChampEnErreur>)e.Details!).Select(x => x.Code).ToArray();

    private static string ColonneInfo(string colonne, string info) =>
        $"SELECT {info} FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'document' AND column_name = '{colonne}'";

    [Fact]
    public async Task Creation_types_sql_portees_journal_et_caches_purges()
    {
        if (Admin is null) return;
        await using var b = await BaseZones.CreerAsync();
        var (zones, db, purge) = Service(b.Connexion);
        await using var _ = db;

        await zones.Creer(Demande("x_badge", "texte", "Badge", 2, groupe: " Chantier "), Chef, default);
        await zones.Creer(Demande("x_cout", "montant", "Coût", 3, obligatoire: true, famille: "V"), Chef, default);
        await zones.Creer(Demande("x_poids", "nombre", "Poids", 4), Chef, default);
        await zones.Creer(Demande("x_embauche", "date", "Embauche", 5, typeDocument: "DEV"), Chef, default);
        await zones.Creer(Demande("x_actif", "booleen", "Actif", 6, obligatoire: true), Chef, default);
        var liste = await zones.Creer(Demande("x_niveau", "liste", "Niveau", 1, [new() { Valeur = "a", Libelle = "Débutant" }, new() { Valeur = "b" }]), Chef, default);
        Assert.Equal("b", liste.Valeurs![1].Libelle);
        Assert.Equal(6, purge.Appels.Count);

        var tout = await zones.Lister(Chef, default);
        Assert.Equal(new[] {"x_badge", "x_niveau", "x_cout", "x_poids", "x_embauche", "x_actif"}.Order().ToList(), tout.Select(z => z.Colonne).Order().ToList());
        Assert.Equal("Chantier", tout.First(z => z.Colonne == "x_badge").Groupe);
        Assert.Equal("V", tout.First(z => z.Colonne == "x_cout").Famille);
        Assert.True(tout.First(z => z.Colonne == "x_cout").Obligatoire);
        Assert.Equal("DEV", tout.First(z => z.Colonne == "x_embauche").TypeDocument);
        Assert.False(tout.First(z => z.Colonne == "x_actif").Obligatoire);
        // Portées : x_cout (famille V) et x_embauche (type DEV) ; le reste est global.
        Assert.Equal(new[] {"x_badge", "x_niveau", "x_poids", "x_actif", "x_cout", "x_embauche"}.Order().ToList(), ZonesEntete.DuType(tout, "V", "DEV").Select(z => z.Colonne).Order().ToList());
        Assert.Equal(new[] {"x_badge", "x_niveau", "x_poids", "x_actif"}.Order().ToList(), ZonesEntete.DuType(tout, "A", "CMD").Select(z => z.Colonne).Order().ToList());

        Assert.Equal("text", await Scalaire(b.Connexion, ColonneInfo("x_badge", "data_type")));
        Assert.Equal("numeric", await Scalaire(b.Connexion, ColonneInfo("x_cout", "data_type")));
        Assert.Equal(18, await Scalaire(b.Connexion, ColonneInfo("x_cout", "numeric_precision")));
        Assert.Equal(2, await Scalaire(b.Connexion, ColonneInfo("x_cout", "numeric_scale")));
        Assert.Equal("date", await Scalaire(b.Connexion, ColonneInfo("x_embauche", "data_type")));
        Assert.Equal("boolean", await Scalaire(b.Connexion, ColonneInfo("x_actif", "data_type")));
        Assert.Equal("text", await Scalaire(b.Connexion, ColonneInfo("x_niveau", "data_type")));
        Assert.Equal("YES", await Scalaire(b.Connexion, ColonneInfo("x_niveau", "is_nullable")));
        Assert.Null(await Scalaire(b.Connexion, ColonneInfo("x_niveau", "column_default")));

        Assert.Equal("zone|societe|document", await Scalaire(b.Connexion, "SELECT isc_type || '|' || isc_origine || '|' || isc_module FROM installation_script WHERE isc_chemin = 'zone:document/document.x_badge'"));
        Assert.Null(await Scalaire(b.Connexion, "SELECT isc_version FROM installation_script WHERE isc_chemin = 'zone:document/document.x_badge'"));
    }

    [Fact]
    public async Task Creation_sans_journal_ne_fait_rien_de_plus()
    {
        if (Admin is null) return;
        await using var b = await BaseZones.CreerAsync(journal: false);
        var (zones, db, _) = Service(b.Connexion);
        await using var _ = db;
        await zones.Creer(Demande("x_a", "texte"), Chef, default);
        Assert.Equal(1L, await Scalaire(b.Connexion, "SELECT count(*) FROM document_zone_entete"));
    }

    [Fact]
    public async Task Refus_nom_type_portee_doublon_et_non_admin()
    {
        if (Admin is null) return;
        await using var b = await BaseZones.CreerAsync();
        var (zones, db, _) = Service(b.Connexion);
        await using var _ = db;

        AssertCodes(await Refuse(() => zones.Creer(Demande("ent_numero", "texte"), Chef, default), 422), ErreursZoneEntete.NomInvalide);
        AssertCodes(await Refuse(() => zones.Creer(Demande("x_a\"; DROP TABLE document; --", "texte"), Chef, default), 422), ErreursZoneEntete.NomInvalide);
        AssertCodes(await Refuse(() => zones.Creer(Demande("x_a", "json"), Chef, default), 422), ErreursZoneEntete.TypeInvalide);
        AssertCodes(await Refuse(() => zones.Creer(Demande("x_a", "texte", " "), Chef, default), 422), ErreursZoneEntete.LibelleObligatoire);
        AssertCodes(await Refuse(() => zones.Creer(Demande("x_a", "liste"), Chef, default), 422), ErreursZoneEntete.Valeurs);
        AssertCodes(await Refuse(() => zones.Creer(Demande("x_a", "texte", famille: "V", typeDocument: "DEV"), Chef, default), 422), ErreursZoneEntete.PorteeInvalide);
        AssertCodes(await Refuse(() => zones.Creer(Demande("x_a", "texte", typeDocument: "INCONNU"), Chef, default), 422), ErreursZoneEntete.PorteeInvalide);
        await zones.Creer(Demande("x_a", "texte"), Chef, default);
        AssertCodes(await Refuse(() => zones.Creer(Demande("x_a", "texte"), Chef, default), 422), ErreursZoneEntete.Existe);

        // Les fonctions SQL refont les contrôles (même appelées sans le service) : ni autre table, ni colonne de LogiBTP.
        var e = await Assert.ThrowsAsync<PostgresException>(() => Executer(b.Connexion, "SELECT document_zone_creer('ent_numero', 'texte', 'X', NULL, 0, FALSE, NULL, NULL, NULL)"));
        Assert.StartsWith("ZONE_NOM_INVALIDE", e.MessageText);
        e = await Assert.ThrowsAsync<PostgresException>(() => Executer(b.Connexion, "SELECT document_zone_retirer('ent_numero')"));
        Assert.StartsWith("ZONE_NOM_INVALIDE", e.MessageText);
        e = await Assert.ThrowsAsync<PostgresException>(() => Executer(b.Connexion, "SELECT document_zone_retirer('x_inconnue')"));
        Assert.StartsWith("ZONE_INCONNUE", e.MessageText);

        // Non administrateur : 403, rien n'est créé ni lu.
        await Refuse(() => zones.Creer(Demande("x_b", "texte"), Simple, default), 403);
        await Refuse(() => zones.Lister(Simple, default), 403);
        await Refuse(() => zones.Modifier("x_a", new() { Libelle = "Z" }, Simple, default), 403);
        await Refuse(() => zones.Supprimer("x_a", Simple, default), 403);
        Assert.Equal(1L, await Scalaire(b.Connexion, "SELECT count(*) FROM document_zone_entete"));
        Assert.Equal(new[] { "x_a" }, (await zones.Lister(Chef, default)).Select(z => z.Colonne));
    }

    [Fact]
    public async Task Modification_portee_libelle_valeurs_puis_retrait_de_la_colonne()
    {
        if (Admin is null) return;
        await using var b = await BaseZones.CreerAsync();
        var (zones, db, purge) = Service(b.Connexion);
        await using var _ = db;
        await zones.Creer(Demande("x_niveau", "liste", "Niveau", 1, [new() { Valeur = "a" }]), Chef, default);
        await zones.Creer(Demande("x_note", "texte", "Note"), Chef, default);

        var m = await zones.Modifier("x_niveau", new() { Libelle = " Niveau 2 ", Groupe = "Suivi", Ordre = 7, Obligatoire = true, Valeurs = [new() { Valeur = "a" }, new() { Valeur = "b", Libelle = "B" }], TypeDocument = "FAC", Actif = false }, Chef, default);
        Assert.Equal(("Niveau 2", "Suivi", 7, true, "FAC", false), (m.Libelle, m.Groupe, m.Ordre, m.Obligatoire, m.TypeDocument, m.Actif));
        Assert.Equal(new[] { "a", "b" }, m.Valeurs!.Select(v => v.Valeur));
        Assert.Empty(ZonesEntete.DuType([m], "V", "FAC"));

        var e = await Refuse(() => zones.Modifier("x_niveau", new() { Libelle = "N", Valeurs = [] }, Chef, default), 422);
        AssertCodes(e, ErreursZoneEntete.Valeurs);
        e = await Refuse(() => zones.Modifier("x_note", new() { Libelle = "N", Famille = "V", TypeDocument = "FAC" }, Chef, default), 422);
        AssertCodes(e, ErreursZoneEntete.PorteeInvalide);
        await Refuse(() => zones.Modifier("x_absente", new() { Libelle = "N" }, Chef, default), 404);

        var avant = purge.Appels.Count;
        await Executer(b.Connexion, "UPDATE document SET x_note = 'a' WHERE false");
        await zones.Supprimer("x_note", Chef, default);
        Assert.Equal(avant + 1, purge.Appels.Count);
        Assert.Null(await Scalaire(b.Connexion, ColonneInfo("x_note", "data_type")));
        Assert.Equal(1L, await Scalaire(b.Connexion, "SELECT count(*) FROM document_zone_entete"));
        await Refuse(() => zones.Supprimer("x_note", Chef, default), 404);
        // La colonne d'une zone retirée peut être recréée ; une colonne LogiBTP reste intacte.
        await zones.Creer(Demande("x_note", "date"), Chef, default);
        Assert.Equal("text", await Scalaire(b.Connexion, ColonneInfo("ent_numero", "data_type")));
    }

    [Fact]
    public async Task Un_type_qui_porte_une_zone_ne_se_supprime_pas()
    {
        if (Admin is null) return;
        await using var b = await BaseZones.CreerAsync();
        var (zones, db, _) = Service(b.Connexion);
        await using var _ = db;
        await zones.Creer(Demande("x_dev", "texte", typeDocument: "DEV"), Chef, default);
        await Assert.ThrowsAsync<PostgresException>(() => Executer(b.Connexion, "DELETE FROM type_document WHERE tyd_code = 'DEV'"));
        await Executer(b.Connexion, "DELETE FROM type_document WHERE tyd_code = 'FAC'");
    }
}
