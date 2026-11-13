using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Api.Btp;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Mcp.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Donnees;
using LogiBTP.Socle.Web;
using LogiBTP.Stock;
using LogiBTP.Stock.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Ordres d'exécution filtrés et demandes d'appro ventilées contre les vraies routes (base LOGIBTP_TEST_PG ; plans/mcp.md,
/// lot 9) : commande d'un marché avec une ligne de métallerie (nature portée par le service FAB_METAL) et une ligne de pose ;
/// aperçu puis ordre d'exécution brouillon limité à la métallerie ; ordre validé par un humain → demande d'appro brouillon
/// dans l'unité de stock (kg → ml) ; ventilation proposée (stock du dépôt, réappro sous le mini), sans écriture. Données
/// d'essai créées puis supprimées (codes suffixés).
/// </summary>
public sealed class McpExecutionBtpBaseTests : IAsyncLifetime
{
    private static readonly string? Connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");
    private const string Compte = "zzmcp_lot9";
    private const string EnteteHumain = "X-Essai-Humain";
    /// <summary>Profil d'un humain sans le droit VALIDER (en-tête humain de cette valeur).</summary>
    private const string ProfilSansValider = "SANS_VALIDER";
    private readonly string _suffixe = Guid.NewGuid().ToString("N")[..6].ToUpperInvariant();
    private WebApplication? _app;
    private string _adresse = "";
    private readonly HttpClient _http = new();
    private readonly List<long> _documents = [];
    private long _element, _depot, _chantier, _marche, _nature, _fournisseur;

    private sealed class DroitsPreparation : IDroits
    {
        private static readonly string[] Retenues = [ActionsDroits.Valider, "APPROUVER", ActionsDroits.Deverrouiller, "DEVALIDER", ActionsDroits.Forcer];

        /// <summary>Agent, ou humain du profil <see cref="ProfilSansValider"/> (lot 10) : pas de validation.</summary>
        public Task<string?> PorteeAsync(Utilisateur u, string noeud, string action, CancellationToken ct) =>
            Task.FromResult((u.Agent is not null || u.Profil == ProfilSansValider) && Retenues.Contains(action) ? null : (string?)PorteesDroits.Tout);

        public Task<IReadOnlyList<ProfilDroits>> ProfilsAsync(CancellationToken ct) => Task.FromResult<IReadOnlyList<ProfilDroits>>([]);
    }

    public async Task InitializeAsync()
    {
        if (Connexion is null) return;
        var b = WebApplication.CreateSlimBuilder();
        b.WebHost.UseUrls("http://127.0.0.1:0");
        b.Logging.ClearProviders();
        b.Services.AddSingleton(new SocieteCourante(null, "Essai", Connexion));
        b.Services.AddUniteEcriture();
        b.Services.AddHttpContextAccessor();
        void Base(IServiceProvider sp, DbContextOptionsBuilder o) => o.ConfigurerBase(sp).UseSnakeCaseNamingConvention();
        b.Services.AddDbContext<LogiBtpContext>(Base);
        b.Services.AddSingleton<IDroits, DroitsPreparation>();
        b.Services.ConfigureHttpJsonOptions(o =>
        {
            o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
            o.SerializerOptions.NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowReadingFromString;
        });
        b.Services.AddModuleDocument<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp, LogiBtpContext, SpecialisationBtp>();
        b.Services.AddModuleStock<SpecialisationStockBtp>(Base);
        // Lot 10 : file des propositions (exécuteurs du cœur).
        b.Services.AddModuleMcp<SpecialisationMcpBtp>(Base);
        var app = b.Build();
        SpecialisationBtp.Http ??= app.Services.GetRequiredService<IHttpContextAccessor>();
        app.UseErreursMetier();
        app.Use(async (http, suite) =>
        {
            Utilisateur.Poser(http, http.Request.Headers.ContainsKey(EnteteHumain)
                ? new Utilisateur(Compte, http.Request.Headers[EnteteHumain] == ProfilSansValider ? ProfilSansValider : Profils.Admin)
                : new Utilisateur(Compte, "SAISIE") { Agent = new AgentRequete("DZZLOT9", "Essai MCP") });
            await suite(http);
        });
        var api = app.MapGroup("/api");
        api.MapModuleDocument<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>();
        api.MapMcpExecution();
        api.MapVentilationDemandes();
        api.MapModuleMcp();
        await app.StartAsync();
        _app = app;
        _adresse = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();

        // Données d'essai : nature portée par FAB_METAL, article géré en stock (ml, conversion kg par le poids), dépôt avec 100 ml
        // (mini 80, maxi 150), fournisseur principal, chantier et marché.
        _nature = await ScalaireAsync<int>("""
            INSERT INTO nature_element (nat_code, nat_libelle, nat_rgn_code, nat_srv_id)
            VALUES (@c, 'Essai métallerie', 'MATERIAUX', (SELECT srv_id FROM service WHERE srv_code = 'FAB_METAL')) RETURNING nat_id
            """, ("c", "ZZM" + _suffixe));
        _element = await ScalaireAsync<long>("""
            INSERT INTO element (ele_bib_id, ele_code, ele_type, ele_libelle_html, ele_gestion, ele_unt_stock, ele_unites, ele_poids, ele_nat_id, ele_pa)
            VALUES ((SELECT min(bib_id) FROM bibliotheque), @c, 'ARTICLE', 'Tube acier essai', 'STOCK', 'ml', '[{"unite":"kg","formule":"1 / {{poids}}"}]'::jsonb, 2, @n, 4)
            RETURNING ele_id
            """, ("c", "ZZT" + _suffixe), ("n", (int)_nature));
        _fournisseur = await ScalaireAsync<long>("SELECT per_id FROM personne WHERE per_casquettes ? 'FOURNISSEUR' ORDER BY per_id LIMIT 1");
        await ExecuterAsync("""
            INSERT INTO tarif_fournisseur (tfo_ele_id, tfo_tiers_id, tfo_fournisseur, tfo_unt_code, tfo_prix, tfo_principal) VALUES (@e, @f, 'Essai', 'ml', 4, TRUE)
            """, ("e", _element), ("f", _fournisseur));
        _depot = await ScalaireAsync<int>("INSERT INTO chantier (cha_code, cha_libelle, cha_depot) VALUES (@c, 'Dépôt essai lot 9', TRUE) RETURNING cha_id", ("c", "ZZD" + _suffixe));
        await ExecuterAsync("INSERT INTO stk_comptage (cpt_ele_id, cpt_lieu_id, cpt_date, cpt_quantite) VALUES (@e, @l, date_trunc('minute', now()) - interval '1 day', 100)",
            ("e", _element), ("l", _depot));
        await ExecuterAsync("INSERT INTO stk_seuil (sse_ele_id, sse_lieu_id, sse_mini, sse_maxi) VALUES (@e, @l, 80, 150)", ("e", _element), ("l", _depot));
        _chantier = await ScalaireAsync<int>("INSERT INTO chantier (cha_code, cha_libelle) VALUES (@c, 'Chantier essai lot 9') RETURNING cha_id", ("c", "ZZC" + _suffixe));
        _marche = await ScalaireAsync<int>("INSERT INTO marche (mar_code, mar_libelle, mar_cha_id) VALUES (@c, 'Marché essai lot 9', @ch) RETURNING mar_id",
            ("c", "ZZM" + _suffixe), ("ch", (int)_chantier));
    }

    public async Task DisposeAsync()
    {
        _http.Dispose();
        if (_app is null) return;
        await EssayerAsync("DELETE FROM agent_journal WHERE ajo_compte = @c; DELETE FROM mcp_proposition WHERE mpr_compte = @c", ("c", Compte));
        foreach (var id in _documents.AsEnumerable().Reverse())
            await EssayerAsync("""
                DELETE FROM document_ligne_lien WHERE lil_source_lig_id IN (SELECT lig_id FROM document_ligne WHERE lig_ent_id = @id)
                    OR lil_cible_lig_id IN (SELECT lig_id FROM document_ligne WHERE lig_ent_id = @id);
                DELETE FROM document_lien WHERE lie_source_ent_id = @id OR lie_cible_ent_id = @id;
                DELETE FROM document WHERE ent_id = @id;
                """, ("id", id));
        await EssayerAsync("DELETE FROM stk_seuil WHERE sse_ele_id = @e; DELETE FROM stk_comptage WHERE cpt_ele_id = @e; DELETE FROM tarif_fournisseur WHERE tfo_ele_id = @e",
            ("e", _element));
        await EssayerAsync("DELETE FROM marche WHERE mar_id = @m", ("m", (int)_marche));
        await EssayerAsync("DELETE FROM chantier WHERE cha_id = ANY(@c)", ("c", new[] { (int)_chantier, (int)_depot }));
        await EssayerAsync("DELETE FROM element WHERE ele_id = @e", ("e", _element));
        await EssayerAsync("DELETE FROM nature_element WHERE nat_id = @n", ("n", (int)_nature));
        await _app.StopAsync();
        await _app.DisposeAsync();
    }

    private static async Task EssayerAsync(string sql, params (string Nom, object Valeur)[] p)
    {
        try { await ExecuterAsync(sql, p); } catch (PostgresException) { /* donnée liée ailleurs : laissée */ }
    }

    private static async Task ExecuterAsync(string sql, params (string Nom, object Valeur)[] p)
    {
        await using var c = new NpgsqlConnection(Connexion);
        await c.OpenAsync();
        await using var k = new NpgsqlCommand(sql, c);
        foreach (var (n, v) in p) k.Parameters.AddWithValue(n, v);
        await k.ExecuteNonQueryAsync();
    }

    private static async Task<T> ScalaireAsync<T>(string sql, params (string Nom, object Valeur)[] p)
    {
        await using var c = new NpgsqlConnection(Connexion);
        await c.OpenAsync();
        await using var k = new NpgsqlCommand(sql, c);
        foreach (var (n, v) in p) k.Parameters.AddWithValue(n, v);
        return (T)Convert.ChangeType((await k.ExecuteScalarAsync())!, typeof(T), System.Globalization.CultureInfo.InvariantCulture);
    }

    private async Task<ReponseInterne> EnvoyerAsync(string methode, string chemin, string? corps, bool humain = false, string? profil = null)
    {
        using var m = new HttpRequestMessage(new HttpMethod(methode), _adresse + chemin);
        if (corps is not null) m.Content = new StringContent(corps, Encoding.UTF8, "application/json");
        if (humain) m.Headers.Add(EnteteHumain, profil ?? "1");
        using var r = await _http.SendAsync(m);
        return new ReponseInterne((int)r.StatusCode, await r.Content.ReadAsStringAsync());
    }

    private async Task<JsonObject> OutilAsync(string nom, string arguments, int statut = 200)
    {
        var outil = new SpecialisationMcpBtp().Outil(nom)!;
        var args = ServiceMcp.Declares(outil, JsonNode.Parse(arguments)!.AsObject().ToDictionary(kv => kv.Key, kv => kv.Value?.DeepClone()));
        ReponseInterne r;
        if (outil.Execution is { } execution)
            r = await execution(new ExecutionOutil(outil, args, [], (m, chemin, corps, _) => EnvoyerAsync(m, chemin, corps)), default);
        else
        {
            Assert.True(ServiceMcp.Requete(outil, args, out var chemin, out var corps, out var manquant), manquant?.ToJsonString());
            r = await EnvoyerAsync(outil.Methode, chemin, corps);
        }
        Assert.True(r.Statut == statut, $"{nom} : HTTP {r.Statut} {r.Corps}");
        return JsonNode.Parse(r.Corps)!.AsObject();
    }

    private async Task<JsonObject> DocumentAsync(long id) => JsonNode.Parse((await EnvoyerAsync("GET", $"/api/documents/{id}", null, humain: true)).Corps)!.AsObject();

    private async Task ValiderAsync(long id)
    {
        var version = (await DocumentAsync(id))["document"]!["ent_version"]!.GetValue<int>();
        var r = await EnvoyerAsync("POST", $"/api/documents/{id}/valider", $$"""{"ent_version":{{version}}}""", humain: true);
        Assert.True(r.Statut == 200, $"validation {id} : {r.Corps}");
        Assert.True((await DocumentAsync(id))["document"]!["ent_verrouille"]!.GetValue<bool>(), $"pièce {id} non verrouillée");
    }

    /// <summary>Commande client validée du marché : « Métallerie » (100 kg de tube, nature FAB_METAL) et « Pose » (10 h, nature MO_POSE).</summary>
    private async Task<long> CommandeAsync()
    {
        var tyd = await ScalaireAsync<int>("SELECT tyd_id FROM type_document WHERE tyd_code = @c", ("c", TypesDocument.VCommande));
        var tiers = await ScalaireAsync<long>("SELECT per_id FROM personne WHERE per_niv_code <> 'PARTICULIER' ORDER BY per_id LIMIT 1");
        var tva = await ScalaireAsync<int>("SELECT ttv_id FROM taux_tva WHERE ttv_categorie = 'N' AND ttv_actif ORDER BY ttv_defaut DESC, ttv_taux DESC LIMIT 1");
        var pose = await ScalaireAsync<int>("SELECT nat_id FROM nature_element WHERE nat_code = 'MO_POSE'");
        var contenu = new DocumentCompletBtp
        {
            Document = new DocumentBtp
            {
                EntTydId = tyd, EntTiersId = tiers, EntObjet = "Essai lot 9", EntDate = DateOnly.FromDateTime(DateTime.Today),
                EntNumFormat = JsonDocument.Parse("""{"separateur":".","niveaux":[{"style":"1"}]}"""), EntProprietes = JsonDocument.Parse("{}"),
                EntEtiquettes = JsonDocument.Parse("[]"),
            },
            Lignes =
            [
                new() { LigId = -1, LigOrdre = 1, LigTylId = TL.Titre, LigLibelleHtml = "Métallerie", LigTypePrix = "V" },
                new()
                {
                    LigId = -2, LigParentId = -1, LigOrdre = 1, LigTylId = TL.Element, LigArtId = _element, LigCode = "ZZT" + _suffixe, LigLibelleHtml = "Tube acier essai",
                    LigQte = 100, LigUntCode = "kg", LigPa = 2, LigNatId = (int)_nature, LigTvaId = tva, LigTypePrix = "V",
                },
                new() { LigId = -3, LigOrdre = 2, LigTylId = TL.Titre, LigLibelleHtml = "Pose", LigTypePrix = "V" },
                new()
                {
                    LigId = -4, LigParentId = -3, LigOrdre = 1, LigTylId = TL.Element, LigLibelleHtml = "Pose essai", LigQte = 10, LigUntCode = "h", LigPa = 40,
                    LigNatId = pose, LigTvaId = tva, LigTypePrix = "V",
                },
                new() { LigId = -5, LigOrdre = 3, LigTylId = TL.Tva, LigLibelleHtml = "TVA", LigTypePrix = "V" },
            ],
        };
        var corps = new JsonObject
        {
            ["creation"] = new JsonObject { ["ent_tyd_id"] = tyd, ["ent_tiers_id"] = tiers, ["ent_objet"] = "Essai lot 9" },
            ["contenu"] = JsonSerializer.SerializeToNode(contenu, OperationsLignesBtp.Json),
        };
        var r = await EnvoyerAsync("POST", "/api/documents/avec-contenu", corps.ToJsonString(), humain: true);
        Assert.True(r.Statut is 200 or 201, r.Corps);
        var id = JsonNode.Parse(r.Corps)!["document"]!["document"]!["ent_id"]!.GetValue<long>();
        _documents.Add(id);
        await ExecuterAsync("UPDATE document SET ent_marche_id = @m, ent_chantier_id = @c WHERE ent_id = @id", ("m", (int)_marche), ("c", (int)_chantier), ("id", id));
        await ValiderAsync(id);
        return id;
    }

    [Fact]
    public async Task Ordre_limite_a_la_metallerie_demande_en_unite_de_stock_et_ventilation_avec_reappro()
    {
        if (Connexion is null) return;
        var commande = await CommandeAsync();
        var lignes = (await DocumentAsync(commande))["lignes"]!.AsArray();
        var tube = lignes.First(l => l!["lig_art_id"]?.GetValue<long>() == _element)!["lig_id"]!.GetValue<long>();
        var pose = lignes.First(l => l!["lig_unt_code"]?.GetValue<string>() == "h")!["lig_id"]!.GetValue<long>();

        // 1. Sans critère : refusé. Aperçu : métallerie retenue (service porteur), pose écartée (autre service) ; rien de créé.
        var vide = await OutilAsync("preparer_ordre_execution", $$"""{"marche_id":{{_marche}}}""", 422);
        Assert.Equal(ErreursMcpBtp.FiltreVide, vide["code"]!.GetValue<string>());
        var apercu = await OutilAsync("preparer_ordre_execution", $$"""{"marche_id":{{_marche}},"service":"FAB_METAL","apercu":true}""");
        var selection = apercu["selection"]!.AsArray().Single()!["lignes"]!.AsArray().ToDictionary(l => l!["lig_id"]!.GetValue<long>());
        Assert.Equal(MotifsLigneOrdre.Service, selection[tube]!["motif"]!.GetValue<string>());
        Assert.True(selection[tube]!["retenue"]!.GetValue<bool>());
        Assert.Equal(MotifsLigneOrdre.AutreService, selection[pose]!["motif"]!.GetValue<string>());
        Assert.Empty(apercu["ordres"]!.AsArray());
        Assert.Equal(0L, await ScalaireAsync<long>("SELECT count(*) FROM document_lien WHERE lie_source_ent_id = @c", ("c", commande)));

        // 2. Ordre d'exécution brouillon par la transformation, limité à la métallerie.
        var cree = await OutilAsync("preparer_ordre_execution", $$"""{"marche_id":{{_marche}},"service":"FAB_METAL"}""");
        var ordre = cree["ordres"]!.AsArray().Single()!.AsObject();
        var oe = ordre["ent_id"]!.GetValue<long>();
        _documents.Add(oe);
        Assert.Equal(TypesDocument.EOe, ordre["type"]!.GetValue<string>());
        Assert.Equal(StatutsDocument.Brouillon, ordre["statut"]!.GetValue<string>());
        Assert.False(ordre["ent_verrouille"]!.GetValue<bool>());
        Assert.Equal(1L, await ScalaireAsync<long>("SELECT count(*) FROM document_ligne WHERE lig_ent_id = @o AND lig_art_id = @e", ("o", oe), ("e", _element)));
        Assert.Equal(0L, await ScalaireAsync<long>("SELECT count(*) FROM document_ligne WHERE lig_ent_id = @o AND lig_unt_code = 'h'", ("o", oe)));
        Assert.Equal((long)_chantier, await ScalaireAsync<long>("SELECT ent_chantier_id FROM document WHERE ent_id = @o", ("o", oe)));
        // Reste : la métallerie n'a plus rien à transformer, la pose garde le sien.
        var apres = await OutilAsync("preparer_ordre_execution", $$"""{"marche_id":{{_marche}},"service":"FAB_METAL","apercu":true}""");
        Assert.Equal(MotifsLigneOrdre.SansReste, apres["selection"]!.AsArray().Single()!["lignes"]!.AsArray()
            .First(l => l!["lig_id"]!.GetValue<long>() == tube)!["motif"]!.GetValue<string>());

        // 3. Demande d'appro depuis l'ordre validé par l'humain : brouillon, 100 kg → 50 ml (unité de stock).
        var nonValide = await OutilAsync("preparer_demandes_appro", $$"""{"id":{{oe}}}""", 422);
        Assert.NotNull(nonValide["code"]);
        await ValiderAsync(oe);
        var demande = await OutilAsync("preparer_demandes_appro", $$"""{"id":{{oe}}}""");
        var dap = demande["ent_id"]!.GetValue<long>();
        _documents.Add(dap);
        Assert.Equal(TypesDocument.EDap, demande["type"]!.GetValue<string>());
        Assert.Equal(StatutsDocument.Brouillon, demande["statut"]!.GetValue<string>());
        Assert.Single(demande["unites_converties"]!.AsArray());
        var ligneDap = (await DocumentAsync(dap))["lignes"]!.AsArray().First(l => l!["lig_art_id"]?.GetValue<long>() == _element)!;
        Assert.Equal("ml", ligneDap["lig_unt_code"]!.GetValue<string>());
        Assert.Equal(50m, ligneDap["lig_qte"]!.GetValue<decimal>());
        Assert.False((await DocumentAsync(dap))["document"]!["ent_verrouille"]!.GetValue<bool>());

        // 4. Ventilation proposée : 50 ml pris au dépôt (100 → 50, sous le mini 80) ; réappro au maxi (100 ml), rien d'écrit.
        var ventilation = await OutilAsync("proposer_ventilation", $$"""{"id":{{dap}}}""");
        Assert.False(ventilation["ecriture"]!.GetValue<bool>());
        var besoin = ventilation["besoins"]!.AsArray().Single()!;
        Assert.Equal(50m, besoin["quantite"]!.GetValue<decimal>());
        Assert.Equal(50m, besoin["stock"]!.GetValue<decimal>());
        Assert.Equal(0m, besoin["achat"]!.GetValue<decimal>());
        Assert.Equal(_depot, besoin["parts"]!.AsArray().Single()!["depot_id"]!.GetValue<long>());
        var reappro = ventilation["reappros"]!.AsArray().Single(r => r!["depot_id"]!.GetValue<long>() == _depot)!;
        var ligneReappro = reappro["fournisseurs"]!.AsArray().SelectMany(f => f!["lignes"]!.AsArray()).Single(l => l!["ele_id"]!.GetValue<long>() == _element)!;
        Assert.Equal(MotifReappro.MiniFranchi, ligneReappro["motif"]!.GetValue<string>());
        Assert.Equal(100m, ligneReappro["quantite"]!.GetValue<decimal>());
        Assert.Equal(_fournisseur, reappro["fournisseurs"]!.AsArray().Single()!["fournisseur_id"]!.GetValue<long>());
        // Aucune pièce créée : ni suite de la demande, ni réservation, demande de stock ou commande du dépôt.
        Assert.Equal(0L, await ScalaireAsync<long>("SELECT count(*) FROM document_lien WHERE lie_source_ent_id = @d", ("d", dap)));
        Assert.Equal(0L, await ScalaireAsync<long>("SELECT count(*) FROM document WHERE @l IN (ent_stk_origine_id, ent_stk_destination_id, ent_chantier_id)",
            ("l", (int)_depot)));
        // Une pièce qui n'est pas une demande d'appro : refusée.
        var pasDemande = await OutilAsync("proposer_ventilation", $$"""{"id":{{oe}}}""", 422);
        Assert.Equal(ErreursMcpBtp.TypeNonPermis, pasDemande["code"]!.GetValue<string>());
    }

    /// <summary>
    /// Outil de proposition appelé avec le jeton de l'agent (lectures seules), puis proposition enregistrée comme le fait
    /// ServiceMcp au dépôt (le point /mcp lui-même est éprouvé par PointMcpTests du module).
    /// </summary>
    private async Task<(JsonObject Reponse, long Proposition)> ProposerAsync(string nom, string arguments)
    {
        var outil = new SpecialisationMcpBtp().Outil(nom)!;
        var args = ServiceMcp.Declares(outil, JsonNode.Parse(arguments)!.AsObject().ToDictionary(kv => kv.Key, kv => kv.Value?.DeepClone()));
        var x = new ExecutionOutil(outil, args, [], (m, chemin, corps, _) => EnvoyerAsync(m, chemin, corps), lectureSeule: outil.Classe == LogiBTP.Mcp.ClasseOutil.Proposition);
        var r = await outil.Execution!(x, default);
        Assert.True(r.Statut == 200, $"{nom} : HTTP {r.Statut} {r.Corps}");
        var p = x.Proposition ?? throw new InvalidOperationException("Aucune proposition déposée");
        Assert.NotNull(new SpecialisationMcpBtp().Executeur(p.Action));
        using var scope = _app!.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<McpDbContext>();
        var proposition = new PropositionMcp
        {
            MprDelegation = "DZZLOT9", MprCompte = Compte, MprClient = "Essai MCP", MprOutil = nom, MprAction = p.Action, MprNoeud = p.Noeud, MprDroit = p.Droit,
            MprLibelle = p.Libelle, MprCibleType = p.CibleType, MprCibleId = p.CibleId, MprContenu = p.Contenu!.ToJsonString(),
            MprAvertissements = (p.Avertissements ?? []).ToJsonString(), MprEcheance = LogiBTP.Mcp.ReglesPropositions.EcheanceProposition(LecturesMcp.Aujourdhui, p.Jours),
            MprCreeLe = DateTimeOffset.UtcNow,
        };
        db.Propositions.Add(proposition);
        await db.SaveChangesAsync();
        return (JsonNode.Parse(r.Corps)!.AsObject(), proposition.MprId);
    }

    private async Task<JsonObject> AccepterAsync(long proposition, int statut, string? profil = null)
    {
        var r = await EnvoyerAsync("POST", $"/api/mcp/propositions/{proposition}/accepter", null, humain: true, profil: profil);
        Assert.True(r.Statut == statut, $"acceptation {proposition} : HTTP {r.Statut} {r.Corps}");
        return JsonNode.Parse(r.Corps)!.AsObject();
    }

    [Fact]
    public async Task Validation_et_ventilation_proposees_puis_acceptees_par_un_humain()
    {
        if (Connexion is null) return;
        var commande = await CommandeAsync();
        var oe = (await OutilAsync("preparer_ordre_execution", $$"""{"marche_id":{{_marche}},"service":"FAB_METAL"}"""))["ordres"]!.AsArray().Single()!["ent_id"]!.GetValue<long>();
        _documents.Add(oe);
        await ValiderAsync(oe);
        var dap = (await OutilAsync("preparer_demandes_appro", $$"""{"id":{{oe}}}"""))["ent_id"]!.GetValue<long>();
        _documents.Add(dap);

        // 1. Validation proposée par l'agent : rien de validé ; l'agent ne peut ni valider ni accepter.
        var (_, validation) = await ProposerAsync("proposer_validation", $$"""{"id":{{dap}},"commentaire":"Demande prête"}""");
        Assert.False((await DocumentAsync(dap))["document"]!["ent_verrouille"]!.GetValue<bool>());
        var agent = await EnvoyerAsync("POST", $"/api/mcp/propositions/{validation}/accepter", null);
        Assert.Equal(403, agent.Statut);
        Assert.Contains(ErreursAgent.AgentInterdit, agent.Corps);
        // Humain sans le droit VALIDER du type : refusé, la pièce reste en brouillon, la proposition en attente.
        var refus = await AccepterAsync(validation, 403, ProfilSansValider);
        Assert.Equal("ACCES_REFUSE", refus["code"]!.GetValue<string>());
        Assert.False((await DocumentAsync(dap))["document"]!["ent_verrouille"]!.GetValue<bool>());
        // Humain avec le droit : validation existante sous son identité (historique humain, pas d'origine AGENT), au journal.
        var acceptee = await AccepterAsync(validation, 200);
        Assert.Equal(LogiBTP.Mcp.EtatProposition.Acceptee, acceptee["etat"]!.GetValue<string>());
        Assert.True((await DocumentAsync(dap))["document"]!["ent_verrouille"]!.GetValue<bool>());
        Assert.Equal(1L, await ScalaireAsync<long>("""
            SELECT count(*) FROM document_historique WHERE his_ent_id = @d AND his_action = 'VALIDATION' AND his_utilisateur = @u AND his_origine IS DISTINCT FROM 'AGENT'
            """, ("d", dap), ("u", Compte)));
        Assert.Equal(1L, await ScalaireAsync<long>("""
            SELECT count(*) FROM agent_journal WHERE ajo_proposition = @p AND ajo_humain = @u AND ajo_statut = 'SUCCES' AND ajo_classe = 'PROPOSITION'
            """, ("p", validation), ("u", Compte)));
        Assert.Equal(1L, await ScalaireAsync<long>("SELECT count(*) FROM agent_journal WHERE ajo_proposition = @p AND ajo_statut = 'REFUS'", ("p", validation)));

        // 2. Ventilation déposée : rien de créé tant qu'un humain n'accepte pas.
        var (ventilation, appliquer) = await ProposerAsync("proposer_ventilation", $$"""{"id":{{dap}},"deposer":true}""");
        Assert.Equal(50m, ventilation["besoins"]!.AsArray().Single()!["stock"]!.GetValue<decimal>());
        Assert.Equal(0L, await ScalaireAsync<long>("SELECT count(*) FROM document_lien WHERE lie_source_ent_id = @d", ("d", dap)));
        var resultat = (await AccepterAsync(appliquer, 200))["resultat"]!.AsObject();
        foreach (var id in resultat["identifiants"]!.AsArray()) _documents.Add(id!.GetValue<long>());
        // Réservation au dépôt (transformation de la demande, 50 ml), brouillon ; réappro au fournisseur, livrée au dépôt, brouillon.
        var reservation = resultat["reservations"]!.AsArray().Single()!["ent_id"]!.GetValue<long>();
        Assert.Equal(TypesDocument.SReservation, await TypesDocumentBtpCodeAsync(reservation));
        Assert.Equal((long)_depot, await ScalaireAsync<long>("SELECT ent_stk_origine_id FROM document WHERE ent_id = @r", ("r", reservation)));
        Assert.False(await ScalaireAsync<bool>("SELECT ent_verrouille FROM document WHERE ent_id = @r", ("r", reservation)));
        Assert.Equal(50m, await ScalaireAsync<decimal>("SELECT lig_qte FROM document_ligne WHERE lig_ent_id = @r AND lig_art_id = @e", ("r", reservation), ("e", _element)));
        Assert.Equal(1L, await ScalaireAsync<long>("SELECT count(*) FROM document_lien WHERE lie_source_ent_id = @d AND lie_cible_ent_id = @r", ("d", dap), ("r", reservation)));
        var reappro = resultat["reappros"]!.AsArray().Single()!["ent_id"]!.GetValue<long>();
        Assert.Equal(TypesDocument.ACommande, await TypesDocumentBtpCodeAsync(reappro));
        Assert.Equal(_fournisseur, await ScalaireAsync<long>("SELECT ent_tiers_id FROM document WHERE ent_id = @c", ("c", reappro)));
        Assert.Equal((long)_depot, await ScalaireAsync<long>("SELECT ent_stk_destination_id FROM document WHERE ent_id = @c", ("c", reappro)));
        Assert.False(await ScalaireAsync<bool>("SELECT ent_verrouille FROM document WHERE ent_id = @c", ("c", reappro)));
        Assert.Empty(resultat["commandes"]!.AsArray());
        Assert.Empty(resultat["demandes_stock"]!.AsArray());
        // Créées par l'humain (historique de création à son nom), écrites au journal avec la proposition.
        Assert.Equal(0L, await ScalaireAsync<long>("SELECT count(*) FROM document_historique WHERE his_ent_id = ANY(@d) AND his_origine = 'AGENT'",
            ("d", new[] { reservation, reappro })));
        Assert.Equal(1L, await ScalaireAsync<long>("SELECT count(*) FROM agent_journal WHERE ajo_proposition = @p AND ajo_humain = @u AND ajo_ecrits ->> 'nombre' = '2'",
            ("p", appliquer), ("u", Compte)));
        // Acceptée une seule fois.
        Assert.Equal(LogiBTP.Mcp.ErreurMcp.McpPropositionClose, (await AccepterAsync(appliquer, 409))["code"]!.GetValue<string>());
        _ = commande;
    }

    private static Task<string> TypesDocumentBtpCodeAsync(long id) =>
        ScalaireAsync<string>("SELECT t.tyd_code FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE d.ent_id = @id", ("id", id));
}
