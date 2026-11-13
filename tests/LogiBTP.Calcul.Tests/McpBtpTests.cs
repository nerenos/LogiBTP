using System.Text.Json.Nodes;
using LogiBTP.Api.Btp;
using LogiBTP.Domaine;
using LogiBTP.Droits.Web;
using LogiBTP.Mcp;
using LogiBTP.Mcp.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Testing;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;
using DroitsAgent = LogiBTP.Droits.DroitsProfil;
using DroitsMcp = LogiBTP.Mcp.DroitsProfil;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Module MCP spécialisé par le cœur (plans/mcp.md, lot 6) : outils de lecture, nœuds retenus et clés sensibles par
/// garde-fou, liste blanche exacte, contrôles par identité refusés à un agent, désignation d'un tiers.
/// </summary>
public class McpBtpTests
{
    private static readonly SpecialisationMcpBtp Specialisation = new();

    /// <summary>Garde-fous du BTP : nœuds retenus attendus (ANALYSE-MODULE-MCP.md § 5.2).</summary>
    public static TheoryData<string, string[]> Retenus => new()
    {
        { GardeFou.Tiers, ["annuaire", "fiches/personne", "fiches/individu"] },
        { GardeFou.Salaries, ["fiches/salarie", "ressources"] },
        { GardeFou.Paie, ["pointage", "pointage/repas"] },
        { GardeFou.CrmNotes, ["crm"] },
        { GardeFou.Couts, ["rentabilite/couts"] },
    };

    private static Dictionary<string, string> Tout(params string[] actions) => actions.ToDictionary(a => a, _ => PorteesDroits.Tout);

    /// <summary>Plafond tel que PlafondMcp le construit : interdits de la spécialisation et nœuds retenus des garde-fous actifs.</summary>
    private static PlafondAgent Plafond(params string[] actifs) =>
        new("D1", ModelePlafond.Preparation, new Dictionary<string, IReadOnlyList<string>>(), PorteesDroits.Tout, actifs, [],
            LecturesMcp.Interdits(Specialisation, actifs));

    [Theory]
    [MemberData(nameof(Retenus))]
    public void Chaque_garde_fou_retire_ses_noeuds(string garde, string[] noeuds)
    {
        var profil = new DroitsAgent(false, noeuds.ToDictionary(n => n, n => (IReadOnlyDictionary<string, string>)Tout(ActionsDroits.Consulter, ActionsDroits.Modifier)));
        foreach (var n in noeuds)
        {
            // Actif : ni lecture ni écriture (droits de l'agent, module Droits) ; levé : droits du délégant dans le plafond.
            Assert.False(AgentsDroits.Autorise(profil, Plafond(garde), n, ActionsDroits.Consulter));
            Assert.False(AgentsDroits.Autorise(profil, Plafond(garde), n, ActionsDroits.Modifier));
            Assert.True(AgentsDroits.Autorise(profil, Plafond(), n, ActionsDroits.Consulter));
            // Outil sur ce nœud : retiré du catalogue de l'agent (ReglesDelegation, point /mcp).
            var mcp = new DroitsMcp(false, profil.Lignes);
            var options = new OptionsDelegation(null, Specialisation.NoeudsRetenus, Specialisation.Interdits);
            var plafond = new PlafondDelegation(ModelePlafond.Lecture);
            Assert.Equal(ClasseOutil.Interdit, ReglesDelegation.ClasserOutil(new OutilAgent(n, ActionsDroits.Consulter), mcp, plafond, [garde], options));
            Assert.Equal(ClasseOutil.Lecture, ReglesDelegation.ClasserOutil(new OutilAgent(n, ActionsDroits.Consulter), mcp, plafond, [], options));
        }
    }

    [Theory]
    [InlineData(GardeFou.Tiers)]
    [InlineData(GardeFou.Salaries)]
    [InlineData(GardeFou.Paie)]
    [InlineData(GardeFou.Couts)]
    public void Chaque_garde_fou_retire_ses_champs(string garde)
    {
        var cles = Specialisation.ClesSensibles[garde];
        Assert.NotEmpty(cles);
        var ligne = new JsonObject { ["per_code"] = "T000001", ["sal_code"] = "S01", ["lig_pv"] = 10 };
        foreach (var c in cles) ligne[c] = "x";
        var reponse = new JsonObject { ["document"] = ligne.DeepClone(), ["lignes"] = new JsonArray(ligne.DeepClone()) };

        var actif = FiltreSensible.Filtrer(reponse, FiltreSensible.Cles([garde], Specialisation.ClesSensibles), new HashSet<string>());
        var texte = actif.Reponse!.ToJsonString();
        foreach (var c in cles) Assert.DoesNotContain($"\"{c}\"", texte);
        Assert.Equal(cles.Distinct().Order(StringComparer.Ordinal), actif.ClesRetirees);
        // Désignation et prix de vente gardés.
        Assert.Contains("\"per_code\"", texte);
        Assert.Contains("\"sal_code\"", texte);
        Assert.Contains("\"lig_pv\"", texte);

        var leve = FiltreSensible.Filtrer(reponse, FiltreSensible.Cles([], Specialisation.ClesSensibles), new HashSet<string>());
        Assert.Empty(leve.ClesRetirees);
    }

    [Fact]
    public void Couts_retires_de_la_bibliotheque_et_du_stock_par_l_outil()
    {
        var bib = Specialisation.Outil("rechercher_bibliotheque")!;
        var element = JsonNode.Parse("""[{"id":1,"code":"GC1","pa":12.5,"pr":14,"pv":20,"pv_net":19,"coef_fg":1.1,"coef_benef":1.3}]""");
        var f = FiltreSensible.Filtrer(element, FiltreSensible.Cles([GardeFou.Couts], Specialisation.ClesSensibles, bib.ClesSensibles), new HashSet<string>());
        Assert.Equal(["coef_benef", "coef_fg", "pa", "pr"], f.ClesRetirees);
        Assert.Equal(20, f.Reponse![0]!["pv"]!.GetValue<int>());

        var stock = Specialisation.Outil("lire_stock")!;
        var etat = JsonNode.Parse("""{"lieu":3,"valeur":100,"lignes":[{"ele_id":1,"quantite":4,"valeur_unitaire":25,"valeur":100}]}""");
        var g = FiltreSensible.Filtrer(etat, FiltreSensible.Cles([GardeFou.Couts], Specialisation.ClesSensibles, stock.ClesSensibles), new HashSet<string>());
        Assert.DoesNotContain("valeur", g.Reponse!.ToJsonString());
        Assert.Equal(4, g.Reponse!["lignes"]![0]!["quantite"]!.GetValue<int>());
        Assert.Empty(FiltreSensible.Filtrer(etat, FiltreSensible.Cles([], Specialisation.ClesSensibles, stock.ClesSensibles), new HashSet<string>()).ClesRetirees);
    }

    /// <summary>Les clés sensibles sont des noms de colonnes réels (DDL des modules et du cœur), sauf celles propres à un outil.</summary>
    [Fact]
    public void Cles_sensibles_sont_des_colonnes_du_ddl()
    {
        var sql = string.Join('\n', Directory.GetFiles(CasPartages.Chemin("db"), "*.sql")
            .Concat(Directory.GetDirectories(CasPartages.Chemin("modules")).SelectMany(m => Directory.Exists(Path.Combine(m, "db")) ? Directory.GetFiles(Path.Combine(m, "db"), "*.sql") : []))
            .Select(File.ReadAllText));
        foreach (var c in Specialisation.ClesSensibles.Values.SelectMany(x => x).Distinct())
            Assert.True(System.Text.RegularExpressions.Regex.IsMatch(sql, $@"\b{c}\b"), $"Colonne {c} absente du DDL");
    }

    [Fact]
    public void Outils_de_lecture_declares_dans_les_droits_avec_description_et_parametres()
    {
        Assert.Equal(["rechercher", "lire_document", "lire_marche", "lire_chantier", "rechercher_bibliotheque", "lire_stock", "lister_modeles", "designer_tiers"],
            Specialisation.Outils.Select(o => o.Nom));
        var routes = new SpecialisationDroitsBtp().Routes;
        foreach (var o in Specialisation.Outils)
        {
            Assert.Equal(ClasseOutil.Lecture, o.Classe);
            Assert.Equal(ActionsDroits.Consulter, o.Action);
            // Gabarit de l'endpoint (fiches : « {type} » à la place du type fixé par l'outil).
            var gabarit = System.Text.RegularExpressions.Regex.Replace(o.Route, "^/api/fiches/[a-z_]+/", "/api/fiches/{type}/");
            Assert.NotNull(RoutesDroits.Trouver(routes, gabarit));
            Assert.NotEqual(o.Description, Specialisation.Texte(o.Description));
            // Paramètres de la route déclarés par le schéma (les autres arguments sont ignorés par le module).
            var proprietes = o.Schema.GetProperty("properties");
            foreach (System.Text.RegularExpressions.Match m in System.Text.RegularExpressions.Regex.Matches(o.Route, @"\{(\w+)\}"))
                Assert.True(proprietes.TryGetProperty(m.Groups[1].Value, out _), $"{o.Nom} : {m.Groups[1].Value}");
            Assert.False(proprietes.TryGetProperty("definition", out _));
            Assert.False(proprietes.TryGetProperty("confidentiel", out _));
        }
        Assert.Equal(SpecialisationMcpBtp.TaillePageMax, Specialisation.Outil("rechercher")!.LimiteMax);
        Assert.Equal(ModulesFacultatifs.Mcp, Specialisation.Module);
    }

    [Fact]
    public void Liste_blanche_exacte_les_routes_de_masquage_ne_sont_jamais_couvertes()
    {
        // Outils de lecture : aucune route d'écriture à ouvrir ; un outil d'écriture sur une fiche ne couvre pas ses voisines.
        var plafond = Plafond() with { RoutesEcriture = [new("POST", "/api/fiches/{type}/{id}"), new("POST", "/api/documents")] };
        Assert.True(AgentsDroits.RoutePermise(plafond, "POST", "/api/fiches/{type}/{id:long}"));
        Assert.False(AgentsDroits.RoutePermise(plafond, "POST", "/api/fiches/{type}/{id}/confidentiel"));
        Assert.False(AgentsDroits.RoutePermise(plafond, "POST", "/api/fiches/{type}/{id}/secret"));
        Assert.False(AgentsDroits.RoutePermise(plafond, "POST", "/api/documents/{id:long}/valider"));
        Assert.False(AgentsDroits.RoutePermise(plafond, "POST", "/api/cas-test"));
    }

    [Fact]
    public void Adresses_des_resultats()
    {
        Assert.Equal("/document/42", SpecialisationMcpBtp.AdresseElement("V_DEVIS", "42"));
        Assert.Equal("/fiche/chantier/7", SpecialisationMcpBtp.AdresseElement(TypesFiche.Chantier, "7"));
        Assert.Equal("/fiche/salarie/3", SpecialisationMcpBtp.AdresseElement("interim", "3"));
        Assert.Null(SpecialisationMcpBtp.AdresseElement("pointage", "3"));
        var doc = Specialisation.Outil("lire_document")!;
        Assert.Equal("/document/12", Specialisation.Adresse(doc, new JsonObject { ["document"] = new JsonObject { ["ent_id"] = 12 } }));
        Assert.Equal("/fiche/personne/5", Specialisation.Adresse(Specialisation.Outil("designer_tiers")!, new JsonObject { ["per_id"] = 5 }));
        Assert.Equal("/fiche/marche/9", Specialisation.Adresse(Specialisation.Outil("lire_marche")!, new JsonObject { ["id"] = "9" }));
        Assert.Equal("https://demo.exemple.fr/document/12", ServiceMcp.Absolue("https://demo.exemple.fr", AdressesApp.UrlDocument(12)));
    }

    private static readonly Utilisateur AgentAdmin = new("admin", Profils.Admin) { Agent = new AgentRequete("D1", "Claude") };

    /// <summary>Droits d'essai : tout ou rien.</summary>
    private sealed class DroitsEssai(bool tout) : IDroits
    {
        public Task<string?> PorteeAsync(Utilisateur u, string noeud, string action, CancellationToken ct) => Task.FromResult(tout ? PorteesDroits.Tout : null);
        public Task<IReadOnlyList<ProfilDroits>> ProfilsAsync(CancellationToken ct) => Task.FromResult<IReadOnlyList<ProfilDroits>>([]);
    }

    [Fact]
    public async Task Controles_par_identite_refuses_a_un_agent()
    {
        var acces = new HttpContextAccessor();
        // Agent au compte d'un administrateur, sans droits (plafond) : refusé avant toute lecture en base.
        Assert.False(await new SpecialisationStockBtp(acces).PeutGererAsync(null!, AgentAdmin, default));
        var execution = new SpecialisationExecutionBtp(acces);
        Assert.False(await execution.PeutValiderAsync(null!, null!, null, AgentAdmin, default));
        Assert.False(await execution.PeutControlerAsync(null!, null!, AgentAdmin, default));
        await Assert.ThrowsAsync<ExceptionMetier>(() => DelegationsControle.EnregistrerAsync(null!, 1, [], AgentAdmin, default));
        // Humain administrateur : inchangé.
        Assert.True(await new SpecialisationStockBtp(acces).PeutGererAsync(null!, new Utilisateur("admin", Profils.Admin), default));
        Assert.True(await execution.PeutValiderAsync(null!, null!, null, new Utilisateur("admin", Profils.Admin), default));

        // Plafond qui couvre l'action : l'identité reprend la main ; qui ne la couvre pas : refus.
        Assert.True(await AgentsBtp.CouvertAsync(AgentAdmin, "stock", ActionsDroits.Modifier,
            new ServiceCollection().AddSingleton<IDroits>(new DroitsEssai(true)).BuildServiceProvider(), default));
        Assert.False(await AgentsBtp.CouvertAsync(AgentAdmin, "stock", ActionsDroits.Modifier,
            new ServiceCollection().AddSingleton<IDroits>(new DroitsEssai(false)).BuildServiceProvider(), default));
        Assert.False(await AgentsBtp.CouvertAsync(AgentAdmin, "stock", ActionsDroits.Modifier, null, default));
        Assert.True(await AgentsBtp.CouvertAsync(new Utilisateur("x", "SAISIE"), "stock", ActionsDroits.Modifier, null, default));
    }

    [Fact]
    public void Particulier_designe_par_son_code_seul()
    {
        Assert.Equal(new TiersDesigne(4, "T4", null, null, true), DesignationTiersBtp.Designer(4, "T4", "Dupont Jean", "Lyon", false));
        Assert.Equal(new TiersDesigne(5, "T5", "SCI Dupont", "Lyon", false), DesignationTiersBtp.Designer(5, "T5", "SCI Dupont", "Lyon", true));
    }

    /// <summary>Base LOGIBTP_TEST_PG : recherche d'un tiers ; particulier introuvable par son nom, trouvé par son code exact. Transaction annulée.</summary>
    [Fact]
    public async Task Designation_des_tiers_en_base()
    {
        var connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");
        if (string.IsNullOrEmpty(connexion)) return;
        await using var c = new NpgsqlConnection(connexion);
        await c.OpenAsync();
        await using var tx = await c.BeginTransactionAsync();
        async Task<long> Personne(string code, string raison, string niveau)
        {
            await using var k = new NpgsqlCommand("INSERT INTO personne (per_code, per_niv_code, per_raison_sociale) VALUES (@c, @n, @r) RETURNING per_id", c, tx);
            k.Parameters.AddWithValue("c", code); k.Parameters.AddWithValue("n", niveau); k.Parameters.AddWithValue("r", raison);
            return (long)(await k.ExecuteScalarAsync())!;
        }
        var morale = await Personne("ZZMCP01", "ZZ Métallerie Essai", "SOCIETE");
        var particulier = await Personne("ZZMCP02", "Zzdupont Jeanne", "PARTICULIER");
        await using (var k = new NpgsqlCommand("""
            WITH c AS (INSERT INTO coordonnee (coo_nature, coo_ligne1, coo_code_postal, coo_ville) VALUES ('ADRESSE', '1 rue A', '69100', 'Villeurbanne') RETURNING coo_id)
            INSERT INTO usage_coordonnee (uco_coo_id, uco_per_id, uco_principal) SELECT coo_id, @p, TRUE FROM c
            """, c, tx))
        {
            k.Parameters.AddWithValue("p", morale);
            await k.ExecuteNonQueryAsync();
        }
        var options = new DbContextOptionsBuilder<LogiBtpContext>().UseNpgsql(c).UseSnakeCaseNamingConvention().Options;
        await using var db = new LogiBtpContext(options);
        await db.Database.UseTransactionAsync(tx);

        var m = Assert.Single(await DesignationTiersBtp.RechercherAsync(db, "zz metallerie", null, null, null, default));
        Assert.Equal(new TiersDesigne(morale, "ZZMCP01", "ZZ Métallerie Essai", "Villeurbanne", false), m);
        Assert.Empty(await DesignationTiersBtp.RechercherAsync(db, "Zzdupont", null, null, null, default));
        Assert.Equal(new TiersDesigne(particulier, "ZZMCP02", null, null, true),
            Assert.Single(await DesignationTiersBtp.RechercherAsync(db, "zzmcp02", null, null, null, default)));
        Assert.Equal(new TiersDesigne(particulier, "ZZMCP02", null, null, true),
            Assert.Single(await DesignationTiersBtp.RechercherAsync(db, null, particulier, null, null, default)));
        Assert.Empty(await DesignationTiersBtp.RechercherAsync(db, " ", null, null, null, default));
        await tx.RollbackAsync();
    }
}
