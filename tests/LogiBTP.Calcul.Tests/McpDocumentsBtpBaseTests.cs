using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Api.Btp;
using LogiBTP.Bibliotheque.Web;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Mcp.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Donnees;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Outils d'écriture des devis contre les vraies routes du module Document (base LOGIBTP_TEST_PG où db/309 est chargé ;
/// plans/mcp.md, lot 7) : devis brouillon créé depuis un modèle et depuis un devis, lignes modifiées et recalculées par le
/// serveur, jamais validé par l'agent ; statut, numéro, indice et verrouillage inchangés par un PUT de l'agent ; historique
/// marqué AGENT avec la délégation. Serveur Kestrel local : module Document du cœur, bibliothèque, utilisateur posé par
/// une authentification simulée (agent par défaut, humain avec l'en-tête X-Essai-Humain), droits d'un plafond PREPARATION
/// (agent : tout sauf VALIDER). Pièces créées supprimées à la fin.
/// </summary>
public sealed class McpDocumentsBtpBaseTests : IAsyncLifetime
{
    private static readonly string? Connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");
    private const string Compte = "zzmcp_lot7";
    private const string Delegation = "DZZLOT7";
    private const string Client = "Essai MCP";
    private const string EnteteHumain = "X-Essai-Humain";
    private WebApplication? _app;
    private string _adresse = "";
    private readonly HttpClient _http = new();
    private readonly List<long> _crees = [];

    /// <summary>Droits d'essai : humain, tout ; agent, plafond PREPARATION (ni VALIDER, ni ses alias).</summary>
    private sealed class DroitsPreparation : IDroits
    {
        private static readonly string[] Retenues = [ActionsDroits.Valider, "APPROUVER", ActionsDroits.Deverrouiller, "DEVALIDER", ActionsDroits.Forcer];

        public Task<string?> PorteeAsync(Utilisateur u, string noeud, string action, CancellationToken ct) =>
            Task.FromResult(u.Agent is not null && Retenues.Contains(action) ? null : (string?)PorteesDroits.Tout);

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
        void Base(IServiceProvider sp, DbContextOptionsBuilder o) => o.ConfigurerBase(sp).UseSnakeCaseNamingConvention();
        b.Services.AddDbContext<LogiBtpContext>(Base);
        b.Services.AddSingleton<IDroits, DroitsPreparation>();
        b.Services.ConfigureHttpJsonOptions(o =>
        {
            o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
            o.SerializerOptions.NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowReadingFromString;
        });
        b.Services.AddModuleDocument<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp, LogiBtpContext, SpecialisationBtp>();
        b.Services.AddModuleBibliotheque<SpecialisationBibliothequeBtp>(Base);
        var app = b.Build();
        app.UseErreursMetier();
        app.Use(async (http, suite) =>
        {
            Utilisateur.Poser(http, http.Request.Headers.ContainsKey(EnteteHumain)
                ? new Utilisateur(Compte, Profils.Admin)
                : new Utilisateur(Compte, "SAISIE") { Agent = new AgentRequete(Delegation, Client) });
            await suite(http);
        });
        var api = app.MapGroup("/api");
        api.MapModuleDocument<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>();
        api.MapModuleBibliotheque();
        await app.StartAsync();
        _app = app;
        _adresse = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();
    }

    public async Task DisposeAsync()
    {
        _http.Dispose();
        if (_app is null) return;
        await using (var c = new NpgsqlConnection(Connexion))
        {
            await c.OpenAsync();
            foreach (var id in _crees.AsEnumerable().Reverse())
            {
                await using var k = new NpgsqlCommand("""
                    DELETE FROM document_lien WHERE lie_source_ent_id = @id OR lie_cible_ent_id = @id;
                    DELETE FROM document WHERE ent_id = @id;
                    """, c);
                k.Parameters.AddWithValue("id", id);
                try { await k.ExecuteNonQueryAsync(); } catch (PostgresException) { /* pièce liée à un compteur ou un suivi : laissée */ }
            }
        }
        await _app.StopAsync();
        await _app.DisposeAsync();
    }

    private async Task<ReponseInterne> EnvoyerAsync(string methode, string chemin, string? corps, bool humain = false)
    {
        using var m = new HttpRequestMessage(new HttpMethod(methode), _adresse + chemin);
        if (corps is not null) m.Content = new StringContent(corps, Encoding.UTF8, "application/json");
        if (humain) m.Headers.Add(EnteteHumain, "1");
        using var r = await _http.SendAsync(m);
        return new ReponseInterne((int)r.StatusCode, await r.Content.ReadAsStringAsync());
    }

    /// <summary>Appel d'un outil comme le point /mcp : arguments déclarés, routes bornées à l'outil, jeton de l'agent.</summary>
    private async Task<JsonObject> OutilAsync(string nom, string arguments, int statut = 200)
    {
        var outil = new SpecialisationMcpBtp().Outil(nom)!;
        var args = ServiceMcp.Declares(outil, JsonNode.Parse(arguments)!.AsObject().ToDictionary(kv => kv.Key, kv => kv.Value?.DeepClone()));
        var x = new ExecutionOutil(outil, args, [], (m, chemin, corps, _) => EnvoyerAsync(m, chemin, corps));
        var r = await outil.Execution!(x, default);
        Assert.True(r.Statut == statut, $"{nom} : HTTP {r.Statut} {r.Corps}");
        var o = JsonNode.Parse(r.Corps)!.AsObject();
        if (r.Statut == 200 && o["ent_id"]?.GetValue<long>() is long id && !_crees.Contains(id)) _crees.Add(id);
        return o;
    }

    private async Task<JsonNode> DocumentAsync(long id) => JsonNode.Parse((await EnvoyerAsync("GET", $"/api/documents/{id}", null)).Corps)!;

    private static async Task<T?> ScalaireAsync<T>(string sql, params (string Nom, object Valeur)[] p)
    {
        await using var c = new NpgsqlConnection(Connexion);
        await c.OpenAsync();
        await using var k = new NpgsqlCommand(sql, c);
        foreach (var (n, v) in p) k.Parameters.AddWithValue(n, v);
        return await k.ExecuteScalarAsync() is T t ? t : default;
    }

    [Fact]
    public async Task Devis_brouillon_cree_modifie_recalcule_jamais_valide_et_historique_agent()
    {
        if (Connexion is null) return;
        var element = await ScalaireAsync<long>("SELECT ele_id FROM element WHERE ele_actif AND ele_type = 'ARTICLE' AND COALESCE(ele_pv, 0) > 0 ORDER BY ele_id LIMIT 1");
        var ouvrage = await ScalaireAsync<long>("SELECT ele_id FROM element WHERE ele_actif AND ele_type = 'OUVRAGE' AND ele_composition IS NOT NULL ORDER BY ele_id LIMIT 1");
        var tiers = await ScalaireAsync<long>("SELECT per_id FROM personne WHERE per_niv_code <> 'PARTICULIER' ORDER BY per_id LIMIT 1");
        var autreTiers = await ScalaireAsync<long>("SELECT per_id FROM personne WHERE per_niv_code <> 'PARTICULIER' AND per_id <> @t ORDER BY per_id LIMIT 1", ("t", tiers));
        Assert.True(element > 0 && tiers > 0 && autreTiers > 0);

        // 1. Depuis un modèle de saisie : création avec contenu, recalculée par le serveur, brouillon.
        var cree = await OutilAsync("creer_devis", $$"""
            {"modele":"COMPLET","tiers_id":{{tiers}},"objet":"Essai agent lot 7",
             "operations":[{"op":"ajouter","element_id":{{element}},"quantite":3}{{(ouvrage > 0 ? $$""",{"op":"ajouter","element_id":{{ouvrage}},"quantite":2}""" : "")}}]}
            """);
        var id = cree["ent_id"]!.GetValue<long>();
        Assert.Equal(StatutsDocument.Brouillon, cree["statut"]!.GetValue<string>());
        Assert.False(cree["ent_verrouille"]!.GetValue<bool>());
        Assert.Equal("COMPLET", cree["ent_modele"]!.GetValue<string>());
        var ht = cree["ent_total_ht"]!.GetValue<decimal>();
        Assert.True(ht > 0);
        var lu = await DocumentAsync(id);
        Assert.Equal(ht, lu["document"]!["ent_total_ht"]!.GetValue<decimal>());
        var ligne = lu["lignes"]!.AsArray().First(l => l!["lig_art_id"]?.GetValue<long>() == element)!;
        Assert.Equal(3m, ligne["lig_qte"]!.GetValue<decimal>());
        var ligId = ligne["lig_id"]!.GetValue<long>();
        var montant = ligne["lig_montant_ht"]!.GetValue<decimal>();

        // 2. Lignes modifiées avec la version lue : quantité doublée, remise, désignation ; le serveur recalcule.
        var version = cree["ent_version"]!.GetValue<int>();
        var modifie = await OutilAsync("modifier_lignes", $$"""
            {"id":{{id}},"version":{{version}},"operations":[{"op":"quantite","lig_id":{{ligId}},"valeur":6},{"op":"designation","lig_id":{{ligId}},"valeur":"Béton essai"}]}
            """);
        Assert.Equal(version + 1, modifie["ent_version"]!.GetValue<int>());
        var apres = (await DocumentAsync(id))["lignes"]!.AsArray().First(l => l!["lig_id"]!.GetValue<long>() == ligId)!;
        Assert.Equal(6m, apres["lig_qte"]!.GetValue<decimal>());
        Assert.Equal(montant * 2, apres["lig_montant_ht"]!.GetValue<decimal>());
        Assert.True(modifie["ent_total_ht"]!.GetValue<decimal>() > ht);
        Assert.Equal(StatutsDocument.Brouillon, modifie["statut"]!.GetValue<string>());
        // Version dépassée : 409, rien d'enregistré ; verrou rendu (une nouvelle modification passe).
        var refus = await OutilAsync("modifier_lignes", $$"""{"id":{{id}},"version":{{version}},"operations":[{"op":"supprimer","lig_id":{{ligId}}}]}""", 409);
        Assert.Equal(ErreursMcpBtp.Version, refus["code"]!.GetValue<string>());
        Assert.Equal("null", (await EnvoyerAsync("GET", $"/api/documents/{id}/verrou", null)).Corps);

        // 3. Statut, verrouillage, numéro et indice : jamais changés par un PUT de l'agent (corps libre compris).
        var complet = await DocumentAsync(id);
        var e = complet["document"]!;
        var avant = (e["ent_std_id"]!.GetValue<int>(), e["ent_verrouille"]!.GetValue<bool>(), e["ent_numero"]?.GetValue<string>(), e["ent_indice"]!.GetValue<string>());
        var envoye = await ScalaireAsync<int>("SELECT std_id FROM statut_document WHERE std_tyd_id = @t AND std_code = 'ENVOYE'", ("t", e["ent_tyd_id"]!.GetValue<int>()));
        e["ent_std_id"] = envoye;
        e["ent_verrouille"] = true;
        e["ent_numero"] = "PIRATE-1";
        e["ent_indice"] = "Z";
        var put = await EnvoyerAsync("PUT", $"/api/documents/{id}", complet.ToJsonString());
        Assert.True(put.Statut == 200, put.Corps);
        var relu = (await DocumentAsync(id))["document"]!;
        Assert.Equal(avant, (relu["ent_std_id"]!.GetValue<int>(), relu["ent_verrouille"]!.GetValue<bool>(), relu["ent_numero"]?.GetValue<string>(), relu["ent_indice"]!.GetValue<string>()));
        // Validation par l'agent (plafond sans VALIDER) : refusée ; la pièce reste brouillon.
        var valider = await EnvoyerAsync("POST", $"/api/documents/{id}/valider", $$"""{"ent_version":{{relu["ent_version"]}}}""");
        Assert.Equal(403, valider.Statut);
        Assert.Equal(avant.Item1, (await DocumentAsync(id))["document"]!["ent_std_id"]!.GetValue<int>());

        // 4. Depuis un devis : copie (même tiers, objet changé) ; vers un autre tiers : contenu repris, tiers remplacé.
        var copie = await OutilAsync("creer_devis", $$"""{"source_id":{{id}},"objet":"Copie agent"}""");
        var copieId = copie["ent_id"]!.GetValue<long>();
        Assert.NotEqual(id, copieId);
        Assert.Equal(id, copie["copie_de"]!.GetValue<long>());
        Assert.Equal("Copie agent", copie["ent_objet"]!.GetValue<string>());
        Assert.Equal(StatutsDocument.Brouillon, copie["statut"]!.GetValue<string>());
        Assert.Equal(1L, await ScalaireAsync<long>("SELECT count(*) FROM document_lien WHERE lie_source_ent_id = @s AND lie_cible_ent_id = @c AND lie_type = 'COPIE'",
            ("s", id), ("c", copieId)));
        // Opérations d'une création depuis un devis : lignes désignées par leur identifiant dans le devis source.
        var inconnue = await OutilAsync("creer_devis", $$"""{"source_id":{{id}},"tiers_id":{{autreTiers}},"operations":[{"op":"remise","lig_id":0,"pourcentage":10}]}""", 422);
        Assert.Equal(ErreursMcpBtp.Ligne, inconnue["code"]!.GetValue<string>());
        var autreTiersDevis = await OutilAsync("creer_devis", $$"""{"source_id":{{id}},"tiers_id":{{autreTiers}},"operations":[{"op":"remise","lig_id":{{ligId}},"pourcentage":10}]}""");
        Assert.Equal(autreTiers, autreTiersDevis["ent_tiers_id"]!.GetValue<long>());
        Assert.Contains(autreTiersDevis["lignes"]!.AsArray(), l => l!["lig_coef_remise"]!.GetValue<decimal>() == 0.9m && l["lig_qte"]!.GetValue<decimal>() == 6m);
        var copieRemise = await OutilAsync("creer_devis", $$"""{"source_id":{{id}},"operations":[{"op":"remise","lig_id":{{ligId}},"pourcentage":10}]}""");
        Assert.Contains(copieRemise["lignes"]!.AsArray(), l => l!["lig_coef_remise"]!.GetValue<decimal>() == 0.9m);
        Assert.Equal(modifie["lignes"]!.AsArray().Count, autreTiersDevis["lignes"]!.AsArray().Count);
        Assert.Equal(StatutsDocument.Brouillon, autreTiersDevis["statut"]!.GetValue<string>());

        // 5. Historique : chaque écriture de l'agent marquée AGENT, avec la délégation et le client.
        foreach (var piece in new[] { id, copieId, autreTiersDevis["ent_id"]!.GetValue<long>() })
        {
            Assert.True(await ScalaireAsync<long>("SELECT count(*) FROM document_historique WHERE his_ent_id = @id", ("id", piece)) > 0);
            Assert.Equal(0L, await ScalaireAsync<long>("""
                SELECT count(*) FROM document_historique
                WHERE his_ent_id = @id AND (his_origine IS DISTINCT FROM 'AGENT' OR his_delegation IS DISTINCT FROM @d OR his_client IS DISTINCT FROM @c)
                """, ("id", piece), ("d", Delegation), ("c", Client)));
        }
        Assert.Equal(0L, await ScalaireAsync<long>("SELECT count(*) FROM document WHERE ent_id = ANY(@ids) AND ent_verrouille", ("ids", _crees.ToArray())));

        // 6. Transformation : devis validé par un humain → commande brouillon (jamais une facture).
        var aValider = (await DocumentAsync(id))["document"]!["ent_version"]!.GetValue<int>();
        var humain = await EnvoyerAsync("POST", $"/api/documents/{id}/valider", $$"""{"ent_version":{{aValider}}}""", humain: true);
        Assert.True(humain.Statut == 200, humain.Corps);
        // Validation humaine : sans origine d'agent.
        Assert.Null(await ScalaireAsync<string>("""
            SELECT his_origine FROM document_historique WHERE his_ent_id = @id AND his_action = 'VALIDATION' ORDER BY his_id DESC LIMIT 1
            """, ("id", id)));
        var commande = await OutilAsync("transformer", $$"""{"id":{{id}}}""");
        Assert.Equal(TypesDocument.VCommande, commande["type"]!.GetValue<string>());
        Assert.Equal(StatutsDocument.Brouillon, commande["statut"]!.GetValue<string>());
        Assert.False(commande["ent_verrouille"]!.GetValue<bool>());
        // Une commande n'est pas un devis : modifier_lignes la refuse.
        var pasDevis = await OutilAsync("modifier_lignes", $$"""{"id":{{commande["ent_id"]}},"operations":[]}""", 422);
        Assert.Equal(ErreursMcpBtp.TypeNonPermis, pasDevis["code"]!.GetValue<string>());
    }
}
