using System.Diagnostics;
using System.Text.Json;
using LogiBTP.Fiches.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Donnees;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace LogiBTP.Fiches.Tests;

/// <summary>
/// Champs supplémentaires en colonnes x_ sur une base PostgreSQL neuve (scripts du module Fiche seulement : 040, 041, 042
/// puis la mineure 1.1) : variable LOGIBTP_TEST_PG_ADMIN (superutilisateur, base postgres), sinon ignorés.
/// </summary>
public sealed class ChampsSupplementairesBaseTests
{
    private static readonly string? Admin = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG_ADMIN");
    private static readonly Utilisateur Chef = new("admin", Profils.Admin);
    private static readonly Utilisateur Simple = new("jean", "UTILISATEUR");

    private static string Racine => LogiBTP.Socle.Testing.CasPartages.Chemin("modules", "fiche", "db");

    internal sealed class BaseFiche : IAsyncDisposable
    {
        private readonly string _nom = "test_fiche_" + Guid.NewGuid().ToString("N")[..12];
        public string Connexion => new NpgsqlConnectionStringBuilder(Admin!) { Database = _nom, Pooling = false }.ConnectionString;
        public string Nom => _nom;

        public static async Task<BaseFiche> CreerAsync(bool journal = true)
        {
            var b = new BaseFiche();
            await Executer(Admin!, $"CREATE DATABASE {b._nom} ENCODING 'UTF8' TEMPLATE template0");
            foreach (var f in new[] { "040_fiche_schema.sql", "041_fiche_parametrage.sql", "042_fiche_chrono.sql", "1.1_champs_supplementaires.sql" })
                await Executer(b.Connexion, await File.ReadAllTextAsync(Path.Combine(Racine, f)));
            // Journal de l'installeur (colonnes de la mise à jour) : seulement s'il existe, la fonction y inscrit la zone.
            if (journal) await Executer(b.Connexion, """
                CREATE TABLE installation_script (isc_chemin TEXT PRIMARY KEY, isc_empreinte TEXT NOT NULL, isc_applique_le TIMESTAMPTZ NOT NULL DEFAULT now(),
                    isc_module TEXT, isc_version TEXT, isc_type TEXT, isc_origine TEXT NOT NULL DEFAULT 'logibtp');
                """);
            await Executer(b.Connexion, """
                CREATE TABLE temoin_fiche (tem_id SERIAL PRIMARY KEY, tem_nom TEXT, tem_props JSONB);
                CREATE TABLE autre_table (aut_id SERIAL PRIMARY KEY);
                INSERT INTO type_fiche (tyf_code, tyf_libelle, tyf_table, tyf_cle, tyf_colonne_proprietes, tyf_definition) VALUES
                  ('temoin', 'Témoin', 'temoin_fiche', 'tem_id', 'tem_props',
                   '{"libelle":"Témoin","champs":[{"code":"nom","libelle":"Nom","colonne":"tem_nom","type":"texte"}]}');
                INSERT INTO droit_fiche (drf_profil, drf_type, drf_action) VALUES ('ADMIN', 'temoin', 'VOIR'), ('ADMIN', 'temoin', 'MODIFIER');
                """);
            return b;
        }

        /// <summary>Base vide (cible d'une restauration).</summary>
        public static async Task<BaseFiche> CreerVideAsync()
        {
            var b = new BaseFiche();
            await Executer(Admin!, $"CREATE DATABASE {b._nom} ENCODING 'UTF8' TEMPLATE template0");
            return b;
        }

        public async ValueTask DisposeAsync()
        {
            NpgsqlConnection.ClearAllPools();
            await Executer(Admin!, $"DROP DATABASE IF EXISTS {_nom} WITH (FORCE)");
        }
    }

    internal static async Task Executer(string connexion, string sql)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, cnx);
        await cmd.ExecuteNonQueryAsync();
    }

    internal static async Task<object?> Scalaire(string connexion, string sql)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, cnx);
        var v = await cmd.ExecuteScalarAsync();
        return v is DBNull ? null : v;
    }

    /// <summary>Services du module sur une base : caches singletons partagés entre les portées d'un même essai.</summary>
    private sealed class Essai(string connexion, CacheTypesColonnes cache, ServiceProvider racine) : IAsyncDisposable
    {
        public static Essai Sur(string connexion)
        {
            var s = new ServiceCollection();
            s.AddScoped(_ => new ConnexionRequete(connexion));
            s.AddScoped<UniteEcriture>();
            s.AddModuleFiche<SpecialisationFiche>((sp, o) => o.ConfigurerBase(sp).UseSnakeCaseNamingConvention());
            var p = s.BuildServiceProvider();
            return new Essai(connexion, p.GetRequiredService<CacheTypesColonnes>(), p);
        }

        public CacheTypesColonnes Cache => cache;
        public AsyncServiceScope Portee() => racine.CreateAsyncScope();
        public async ValueTask DisposeAsync() => await racine.DisposeAsync();
    }

    private static DemandeChampColonne Demande(string colonne, string type, string libelle = "Libellé", int ordre = 0, List<OptionChamp>? valeurs = null, string table = "temoin_fiche") =>
        new() { Table = table, Colonne = colonne, Type = type, Libelle = libelle, Ordre = ordre, Valeurs = valeurs };

    private static async Task<ExceptionMetier> Refuse(Func<Task> acte, int statut)
    {
        var e = await Assert.ThrowsAsync<ExceptionMetier>(acte);
        Assert.Equal(statut, e.Statut);
        return e;
    }

    private static string[] Codes(ExceptionMetier e) => ((List<ErreurChamp>)e.Details!).Select(x => x.Code).ToArray();

    [Fact]
    public async Task Creation_visible_dans_la_definition_types_sql_journal_et_cache_purge()
    {
        if (Admin is null) return;
        await using var b = await BaseFiche.CreerAsync();
        await using var essai = Essai.Sur(b.Connexion);
        await using var p = essai.Portee();
        var champs = p.ServiceProvider.GetRequiredService<ServiceChampsSupplementaires>();
        var fiches = p.ServiceProvider.GetRequiredService<ServiceFiche>();

        // La définition (et le cache des colonnes) est lue avant : la création doit la rafraîchir sans redémarrage.
        Assert.DoesNotContain((await fiches.Definition("temoin", Chef, default)).Champs, c => c.Code.StartsWith("x_"));
        Assert.NotEmpty(essai.Cache.Tables);

        await champs.Creer(Demande("x_badge", "texte", "Badge", 2), Chef, default);
        await champs.Creer(Demande("x_cout", "montant", "Coût", 3), Chef, default);
        await champs.Creer(Demande("x_poids", "nombre", "Poids", 4), Chef, default);
        await champs.Creer(Demande("x_embauche", "date", "Embauche", 5), Chef, default);
        await champs.Creer(Demande("x_actif", "booleen", "Actif", 6), Chef, default);
        var liste = await champs.Creer(Demande("x_niveau", "liste", "Niveau", 1, [new() { Valeur = "a", Libelle = "Débutant" }, new() { Valeur = "b" }]), Chef, default);
        Assert.Equal("b", liste.Valeurs![1].Libelle);

        var def = await fiches.Definition("temoin", Chef, default);
        var x = def.Champs.Where(c => c.Code.StartsWith("x_")).ToList();
        Assert.Equal(["x_niveau", "x_badge", "x_cout", "x_poids", "x_embauche", "x_actif"], x.Select(c => c.Code));
        Assert.Equal(["liste", "texte", "nombre", "nombre", "date", "booleen"], x.Select(c => c.Type));
        Assert.Equal("Débutant", x[0].Options![0].Libelle);
        Assert.All(x, c => Assert.True(c.ColonneSupplementaire));
        Assert.All(x, c => Assert.Null(c.Colonne));

        Assert.Equal("text", await Scalaire(b.Connexion, ColonneInfo("x_badge", "data_type")));
        Assert.Equal("numeric", await Scalaire(b.Connexion, ColonneInfo("x_cout", "data_type")));
        Assert.Equal(18, await Scalaire(b.Connexion, ColonneInfo("x_cout", "numeric_precision")));
        Assert.Equal(2, await Scalaire(b.Connexion, ColonneInfo("x_cout", "numeric_scale")));
        Assert.Equal("date", await Scalaire(b.Connexion, ColonneInfo("x_embauche", "data_type")));
        Assert.Equal("boolean", await Scalaire(b.Connexion, ColonneInfo("x_actif", "data_type")));
        Assert.Equal("text", await Scalaire(b.Connexion, ColonneInfo("x_niveau", "data_type")));
        Assert.Equal("YES", await Scalaire(b.Connexion, ColonneInfo("x_niveau", "is_nullable")));
        Assert.Null(await Scalaire(b.Connexion, ColonneInfo("x_niveau", "column_default")));

        // Journal : une ligne « zone » d'origine société par champ créé, hors des versions de module.
        Assert.Equal("zone|societe|fiche", await Scalaire(b.Connexion, "SELECT isc_type || '|' || isc_origine || '|' || isc_module FROM installation_script WHERE isc_chemin = 'zone:fiche/temoin_fiche.x_badge'"));
        Assert.Null(await Scalaire(b.Connexion, "SELECT isc_version FROM installation_script WHERE isc_chemin = 'zone:fiche/temoin_fiche.x_badge'"));
    }

    private static string ColonneInfo(string colonne, string info) =>
        $"SELECT {info} FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'temoin_fiche' AND column_name = '{colonne}'";

    [Fact]
    public async Task Creation_sans_journal_ne_fait_rien_de_plus()
    {
        if (Admin is null) return;
        await using var b = await BaseFiche.CreerAsync(journal: false);
        await using var essai = Essai.Sur(b.Connexion);
        await using var p = essai.Portee();
        await p.ServiceProvider.GetRequiredService<ServiceChampsSupplementaires>().Creer(Demande("x_a", "texte"), Chef, default);
        Assert.Equal(1L, await Scalaire(b.Connexion, "SELECT count(*) FROM fiche_champ_supplementaire"));
    }

    [Fact]
    public async Task Refus_table_non_ouverte_nom_invalide_type_invalide_doublon_et_non_admin()
    {
        if (Admin is null) return;
        await using var b = await BaseFiche.CreerAsync();
        await using var essai = Essai.Sur(b.Connexion);
        await using var p = essai.Portee();
        var champs = p.ServiceProvider.GetRequiredService<ServiceChampsSupplementaires>();

        Assert.Equal([ErreursChampSupplementaire.TableFermee], Codes(await Refuse(() => champs.Creer(Demande("x_a", "texte", table: "autre_table"), Chef, default), 422)));
        Assert.Equal([ErreursChampSupplementaire.TableFermee], Codes(await Refuse(() => champs.Creer(Demande("x_a", "texte", table: "type_fiche"), Chef, default), 422)));
        Assert.Equal([ErreursChampSupplementaire.NomInvalide], Codes(await Refuse(() => champs.Creer(Demande("tem_nom", "texte"), Chef, default), 422)));
        Assert.Equal([ErreursChampSupplementaire.NomInvalide], Codes(await Refuse(() => champs.Creer(Demande("x_a\"; DROP TABLE temoin_fiche; --", "texte"), Chef, default), 422)));
        Assert.Equal([ErreursChampSupplementaire.TypeInvalide], Codes(await Refuse(() => champs.Creer(Demande("x_a", "json"), Chef, default), 422)));
        await champs.Creer(Demande("x_a", "texte"), Chef, default);
        Assert.Equal([ErreursChampSupplementaire.Existe], Codes(await Refuse(() => champs.Creer(Demande("x_a", "texte"), Chef, default), 422)));

        // Non administrateur : 403, rien n'est créé ni lu.
        await Refuse(() => champs.Creer(Demande("x_b", "texte"), Simple, default), 403);
        await Refuse(() => champs.Lister(null, Simple, default), 403);
        await Refuse(() => champs.Tables(Simple, default), 403);
        await Refuse(() => champs.Modifier("temoin_fiche", "x_a", new() { Libelle = "Z" }, Simple, default), 403);
        await Refuse(() => champs.Supprimer("temoin_fiche", "x_a", Simple, default), 403);
        Assert.Equal(1L, await Scalaire(b.Connexion, "SELECT count(*) FROM fiche_champ_supplementaire"));
        Assert.Equal(["temoin_fiche"], (await champs.Tables(Chef, default)).Select(t => t.Table));
        Assert.Equal(["temoin"], (await champs.Tables(Chef, default))[0].Types);
    }

    [Fact]
    public async Task La_fonction_sql_refuse_elle_meme_table_nom_type_et_colonne_hors_registre()
    {
        if (Admin is null) return;
        await using var b = await BaseFiche.CreerAsync();
        foreach (var (sql, code) in new[]
        {
            ("SELECT fiche_champ_creer('autre_table', 'x_a', 'texte', 'A', 0, NULL)", "CHAMP_TABLE_FERMEE"),
            ("SELECT fiche_champ_creer('temoin_fiche', 'tem_nom2', 'texte', 'A', 0, NULL)", "CHAMP_NOM_INVALIDE"),
            ("SELECT fiche_champ_creer('temoin_fiche', 'x_a; DROP TABLE temoin_fiche', 'texte', 'A', 0, NULL)", "CHAMP_NOM_INVALIDE"),
            ("SELECT fiche_champ_creer('temoin_fiche', 'x_a', 'serial', 'A', 0, NULL)", "CHAMP_TYPE_INVALIDE"),
            ("SELECT fiche_champ_creer('temoin_fiche', 'x_a', 'texte', ' ', 0, NULL)", "CHAMP_LIBELLE_OBLIGATOIRE"),
            ("SELECT fiche_champ_retirer('temoin_fiche', 'tem_nom')", "CHAMP_NOM_INVALIDE"),
            ("SELECT fiche_champ_retirer('temoin_fiche', 'x_absent')", "CHAMP_INCONNU"),
        })
        {
            var e = await Assert.ThrowsAsync<PostgresException>(() => Executer(b.Connexion, sql));
            Assert.StartsWith(code, e.MessageText);
        }
        Assert.Equal(0L, await Scalaire(b.Connexion, "SELECT count(*) FROM information_schema.columns WHERE table_name = 'temoin_fiche' AND column_name LIKE 'x\\_%'"));
        Assert.Equal(3L, await Scalaire(b.Connexion, "SELECT count(*) FROM information_schema.columns WHERE table_name = 'temoin_fiche'"));
    }

    [Fact]
    public async Task Fonctions_definer_avec_chemin_fixe_sans_droit_public()
    {
        if (Admin is null) return;
        await using var b = await BaseFiche.CreerAsync();
        Assert.Equal(3L, await Scalaire(b.Connexion, "SELECT count(*) FROM pg_proc WHERE proname LIKE 'fiche_champ_%' AND prosecdef AND proconfig::text LIKE '%search_path=public, pg_temp%'"));
        Assert.Equal(0L, await Scalaire(b.Connexion, "SELECT count(*) FROM pg_proc WHERE proname LIKE 'fiche_champ_%' AND coalesce(proacl::text, '=X') ~ '(^\\{|,)=X'"));
    }

    [Fact]
    public async Task Valeur_enregistree_dans_une_fiche_creation_et_modification_validees_selon_le_type()
    {
        if (Admin is null) return;
        await using var b = await BaseFiche.CreerAsync();
        await using var essai = Essai.Sur(b.Connexion);
        await using var p = essai.Portee();
        var champs = p.ServiceProvider.GetRequiredService<ServiceChampsSupplementaires>();
        var fiches = p.ServiceProvider.GetRequiredService<ServiceFiche>();
        await champs.Creer(Demande("x_badge", "texte", "Badge"), Chef, default);
        await champs.Creer(Demande("x_cout", "montant", "Coût"), Chef, default);
        await champs.Creer(Demande("x_embauche", "date", "Embauche"), Chef, default);
        await champs.Creer(Demande("x_actif", "booleen", "Actif"), Chef, default);
        await champs.Creer(Demande("x_niveau", "liste", "Niveau", valeurs: [new() { Valeur = "a" }, new() { Valeur = "b" }]), Chef, default);

        static Dictionary<string, JsonElement> V(params (string, object?)[] l) => l.ToDictionary(x => x.Item1, x => JsonSerializer.SerializeToElement(x.Item2));

        // Création avec valeurs, relue par la fiche.
        var cree = await fiches.Creer("temoin", new DemandeEnregistrement { Valeurs = V(("nom", "Dupont"), ("x_badge", "B-12"), ("x_cout", "1234,5"), ("x_embauche", "2026-03-04"), ("x_actif", true), ("x_niveau", "b")) }, Chef, default);
        Assert.Equal("B-12", cree.Valeurs["x_badge"]);
        Assert.Equal(1234.5m, cree.Valeurs["x_cout"]);
        Assert.Equal("2026-03-04", cree.Valeurs["x_embauche"]);
        Assert.Equal(true, cree.Valeurs["x_actif"]);
        Assert.Equal("b", cree.Valeurs["x_niveau"]);

        // Modification (verrou détenu) : valeur changée, autre vidée.
        var jeton = Guid.NewGuid();
        Assert.True((await fiches.Verrouiller("temoin", cree.Id!, new DemandeVerrou { Jeton = jeton }, Chef, default)).Ok);
        var modifie = await fiches.Enregistrer("temoin", cree.Id!, new DemandeEnregistrement { Jeton = jeton, H = cree.H, Valeurs = V(("x_badge", "B-99"), ("x_niveau", null)) }, Chef, default);
        Assert.Equal("B-99", modifie.Valeurs["x_badge"]);
        Assert.Null(modifie.Valeurs["x_niveau"]);
        Assert.Equal("B-99", await Scalaire(b.Connexion, "SELECT x_badge FROM temoin_fiche"));

        // Valeurs refusées selon le type : 422 VALIDATION, rien n'est écrit.
        foreach (var (code, valeur, attendu) in new (string, object?, string)[] { ("x_cout", "abc", "NOMBRE"), ("x_cout", "12,505", "FORMAT"), ("x_embauche", "pas une date", "DATE"), ("x_niveau", "z", "LISTE") })
        {
            var e = await Refuse(() => fiches.Enregistrer("temoin", cree.Id!, new DemandeEnregistrement { Jeton = jeton, H = modifie.H, Valeurs = V((code, valeur)) }, Chef, default), 422);
            Assert.Equal("VALIDATION", e.Code);
            Assert.Contains(attendu, Codes(e));
        }
        Assert.Equal(1234.50m, await Scalaire(b.Connexion, "SELECT x_cout FROM temoin_fiche"));

        // Champ désactivé : plus dans la définition, valeur conservée en base, écriture refusée.
        await champs.Modifier("temoin_fiche", "x_badge", new ModificationChampColonne { Libelle = "Badge 2", Ordre = 9, Actif = false }, Chef, default);
        Assert.DoesNotContain(( await fiches.Definition("temoin", Chef, default)).Champs, c => c.Code == "x_badge");
        Assert.Equal("B-99", await Scalaire(b.Connexion, "SELECT x_badge FROM temoin_fiche"));
        await Refuse(() => fiches.Enregistrer("temoin", cree.Id!, new DemandeEnregistrement { Jeton = jeton, H = modifie.H, Valeurs = V(("x_badge", "B-1")) }, Chef, default), 422);
    }

    [Fact]
    public async Task Modification_du_libelle_de_l_ordre_et_des_valeurs_et_refus_des_valeurs_vides()
    {
        if (Admin is null) return;
        await using var b = await BaseFiche.CreerAsync();
        await using var essai = Essai.Sur(b.Connexion);
        await using var p = essai.Portee();
        var champs = p.ServiceProvider.GetRequiredService<ServiceChampsSupplementaires>();
        await champs.Creer(Demande("x_niveau", "liste", "Niveau", valeurs: [new() { Valeur = "a" }]), Chef, default);
        var m = await champs.Modifier("temoin_fiche", "x_niveau", new() { Libelle = " Niveau 2 ", Ordre = 7, Valeurs = [new() { Valeur = "a" }, new() { Valeur = "c", Libelle = "C" }], Actif = true }, Chef, default);
        Assert.Equal(("Niveau 2", 7, 2), (m.Libelle, m.Ordre, m.Valeurs!.Count));
        Assert.Equal(["a"], (await champs.Lister("temoin_fiche", Chef, default))[0].Valeurs!.Take(1).Select(v => v.Valeur));
        Assert.Equal([ErreursChampSupplementaire.Valeurs], Codes(await Refuse(() => champs.Modifier("temoin_fiche", "x_niveau", new() { Libelle = "N", Valeurs = [] }, Chef, default), 422)));
        await Refuse(() => champs.Modifier("temoin_fiche", "x_absent", new() { Libelle = "N" }, Chef, default), 404);
    }

    [Fact]
    public async Task Suppression_retire_la_colonne_le_registre_et_le_champ_de_la_definition()
    {
        if (Admin is null) return;
        await using var b = await BaseFiche.CreerAsync();
        await using var essai = Essai.Sur(b.Connexion);
        await using var p = essai.Portee();
        var champs = p.ServiceProvider.GetRequiredService<ServiceChampsSupplementaires>();
        var fiches = p.ServiceProvider.GetRequiredService<ServiceFiche>();
        await champs.Creer(Demande("x_badge", "texte", "Badge"), Chef, default);
        Assert.Contains((await fiches.Definition("temoin", Chef, default)).Champs, c => c.Code == "x_badge");

        await champs.Supprimer("temoin_fiche", "x_badge", Chef, default);
        Assert.Equal(0L, await Scalaire(b.Connexion, "SELECT count(*) FROM information_schema.columns WHERE table_name = 'temoin_fiche' AND column_name = 'x_badge'"));
        Assert.Equal(0L, await Scalaire(b.Connexion, "SELECT count(*) FROM fiche_champ_supplementaire"));
        Assert.DoesNotContain((await fiches.Definition("temoin", Chef, default)).Champs, c => c.Code == "x_badge");
        // Une fiche se lit toujours après le retrait (le cache des colonnes a été vidé).
        var cree = await fiches.Creer("temoin", new DemandeEnregistrement { Valeurs = new() { ["nom"] = JsonSerializer.SerializeToElement("Dupont") } }, Chef, default);
        Assert.Equal("Dupont", cree.Valeurs["nom"]);
        await Refuse(() => champs.Supprimer("temoin_fiche", "x_badge", Chef, default), 404);
        // Une colonne de LogiBTP n'est jamais retirée, même par un nom valide en apparence.
        await Refuse(() => champs.Supprimer("temoin_fiche", "tem_nom", Chef, default), 422);
        Assert.Equal(1L, await Scalaire(b.Connexion, "SELECT count(*) FROM information_schema.columns WHERE table_name = 'temoin_fiche' AND column_name = 'tem_nom'"));
    }

    [Fact]
    public async Task Sauvegarde_et_restauration_gardent_le_champ_son_registre_et_ses_valeurs()
    {
        if (Admin is null) return;
        await using var b = await BaseFiche.CreerAsync();
        await using var essai = Essai.Sur(b.Connexion);
        await using (var p = essai.Portee())
        {
            var champs = p.ServiceProvider.GetRequiredService<ServiceChampsSupplementaires>();
            await champs.Creer(Demande("x_badge", "texte", "Badge", 3), Chef, default);
        }
        await Executer(b.Connexion, "INSERT INTO temoin_fiche (tem_nom, x_badge) VALUES ('Dupont', 'B-12')");

        var fichier = Path.Combine(Path.GetTempPath(), "logibtp-fiche-" + Guid.NewGuid().ToString("N") + ".dump");
        await using var restaure = await BaseFiche.CreerVideAsync();
        try
        {
            Lancer("pg_dump", ["-Fc", "-f", fichier, "-h", Hote(b), "-p", Port(b), "-U", Utilisateur(b), b.Nom], b);
            Lancer("pg_restore", ["-d", restaure.Nom, "-h", Hote(b), "-p", Port(b), "-U", Utilisateur(b), fichier], b);
        }
        finally
        {
            File.Delete(fichier);
        }
        Assert.Equal("Badge|3", await Scalaire(restaure.Connexion, "SELECT fcs_libelle || '|' || fcs_ordre FROM fiche_champ_supplementaire WHERE fcs_colonne = 'x_badge'"));
        Assert.Equal("B-12", await Scalaire(restaure.Connexion, "SELECT x_badge FROM temoin_fiche"));
        Assert.Equal("zone", await Scalaire(restaure.Connexion, "SELECT isc_type FROM installation_script WHERE isc_chemin = 'zone:fiche/temoin_fiche.x_badge'"));
        // Les fonctions suivent la base : le champ se retire sur la base restaurée.
        await Executer(restaure.Connexion, "SELECT fiche_champ_retirer('temoin_fiche', 'x_badge')");
    }

    private static string Hote(BaseFiche b) => new NpgsqlConnectionStringBuilder(b.Connexion).Host!;
    private static string Port(BaseFiche b) => new NpgsqlConnectionStringBuilder(b.Connexion).Port.ToString();
    private static string Utilisateur(BaseFiche b) => new NpgsqlConnectionStringBuilder(b.Connexion).Username!;

    private static void Lancer(string commande, string[] arguments, BaseFiche b)
    {
        var info = new ProcessStartInfo(commande) { RedirectStandardError = true, RedirectStandardOutput = true };
        foreach (var a in arguments) info.ArgumentList.Add(a);
        info.Environment["PGPASSWORD"] = new NpgsqlConnectionStringBuilder(b.Connexion).Password;
        using var p = Process.Start(info)!;
        var erreur = p.StandardError.ReadToEnd();
        p.WaitForExit();
        Assert.True(p.ExitCode == 0, $"{commande} : {erreur}");
    }
}
