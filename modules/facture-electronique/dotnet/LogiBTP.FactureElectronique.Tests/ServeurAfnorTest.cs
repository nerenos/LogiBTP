using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using LogiBTP.FactureElectronique.Web.Connecteurs;
using LogiBTP.Socle.Testing;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Net.Http.Headers;

namespace LogiBTP.FactureElectronique.Tests;

/// <summary>Swaggers XP Z12-013 1.3.0 (artefacts/api) : énumérations et chemins, contrat des tests.</summary>
public static class Swaggers
{
    public static readonly JsonNode Flux = Charger("flow-service-1.3.0.json");
    public static readonly JsonNode Annuaire = Charger("directory-service-1.3.0.json");

    private static JsonNode Charger(string nom) =>
        JsonNode.Parse(File.ReadAllText(CasPartages.Chemin("modules", "facture-electronique", "artefacts", "api", nom)))!;

    /// <summary>Valeurs d'une énumération des composants (schéma <paramref name="schema"/>).</summary>
    public static string[] Enum(JsonNode swagger, string schema) =>
        [.. swagger["components"]!["schemas"]![schema]!["enum"]!.AsArray().Select(v => v!.GetValue<string>())];

    /// <summary>Le chemin d'une requête correspond-il à un chemin du swagger (paramètres {…} remplacés par une valeur) ?</summary>
    public static bool Chemin(JsonNode swagger, string methode, string chemin) =>
        swagger["paths"]!.AsObject().Any(p => p.Value![methode.ToLowerInvariant()] is not null
            && Regex.IsMatch(chemin, "^" + Regex.Replace(Regex.Escape(p.Key).Replace(@"\{", "{"), @"\{[^}]+}", "[^/]+") + "$"));
}

/// <summary>Requête reçue par le serveur de test (sans le jeton).</summary>
public sealed record RequeteRecue(string Methode, string Chemin, string? Requete, string? RequestId, string? Organisation, string? TypeContenu)
{
    public JsonNode? Corps { get; init; }
    public JsonNode? InfoFlux { get; init; }
    public string? TypeInfoFlux { get; init; }
    public string? TypeFichier { get; init; }
    public string? NomFichier { get; init; }
    public byte[]? Fichier { get; init; }
}

/// <summary>
/// PA XP Z12-013 de test sur 127.0.0.1 (port libre), adossée à une <see cref="PlateformeSimulee"/> : vérifie le jeton
/// Bearer, le Request-Id (UUID), le multipart (flowInfo en application/json, file), les énumérations lues dans les
/// swaggers, la recherche (where, limite) ; réponses JSON écrites avec les noms des swaggers. Erreurs forcées par
/// <see cref="Forcer"/>, délai par <see cref="Attente"/>.
/// </summary>
public sealed class ServeurAfnorTest : IAsyncDisposable
{
    public const string Jeton = "jeton-tres-secret-0123456789";

    private readonly WebApplication app;
    public PlateformeSimulee Plateforme { get; }
    public ConcurrentQueue<RequeteRecue> Requetes { get; } = new();
    public ConcurrentQueue<(int Statut, string Code, string Message)> Forcer { get; } = new();
    public TimeSpan Attente { get; set; }
    public string Adresse { get; }

    private ServeurAfnorTest(WebApplication app, PlateformeSimulee plateforme)
    {
        this.app = app;
        Plateforme = plateforme;
        Adresse = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();
    }

    public Uri AdresseFlux => new(Adresse + "/pa/flow-service");
    public Uri AdresseAnnuaire => new(Adresse + "/pa/directory-service/");

    public static async Task<ServeurAfnorTest> DemarrerAsync(PlateformeSimulee plateforme)
    {
        var b = WebApplication.CreateSlimBuilder();
        b.WebHost.UseUrls("http://127.0.0.1:0");
        b.Logging.ClearProviders();
        var app = b.Build();
        ServeurAfnorTest? serveur = null;
        app.Run(ctx => serveur!.TraiterAsync(ctx));
        await app.StartAsync();
        serveur = new ServeurAfnorTest(app, plateforme);
        return serveur;
    }

    public async ValueTask DisposeAsync()
    {
        await app.StopAsync();
        await app.DisposeAsync();
    }

    private async Task TraiterAsync(HttpContext ctx)
    {
        var r = ctx.Request;
        var recue = new RequeteRecue(r.Method, r.Path.Value!, r.QueryString.Value, r.Headers["Request-Id"].FirstOrDefault(),
            r.Headers["Organization-Id"].FirstOrDefault(), r.ContentType);
        try
        {
            if (r.Headers.Authorization.ToString() != "Bearer " + Jeton) { Requetes.Enqueue(recue); await Erreur(ctx, 401, "MISSING_TOKEN", null); return; }
            if (!Guid.TryParse(recue.RequestId, out _)) { Requetes.Enqueue(recue); await Erreur(ctx, 400, "MISSING_REQUIRED_FIELD", "Request-Id"); return; }
            if (Attente > TimeSpan.Zero) await Task.Delay(Attente, ctx.RequestAborted);
            if (Forcer.TryDequeue(out var f)) { Requetes.Enqueue(recue); await Erreur(ctx, f.Statut, f.Code, f.Message); return; }
            var chemin = recue.Chemin;
            if (chemin.StartsWith("/pa/flow-service/", StringComparison.Ordinal)) await FluxAsync(ctx, recue, chemin["/pa/flow-service".Length..]);
            else if (chemin.StartsWith("/pa/directory-service/", StringComparison.Ordinal)) await AnnuaireAsync(ctx, recue, chemin["/pa/directory-service".Length..]);
            else { Requetes.Enqueue(recue); await Erreur(ctx, 404, "MISSING_RESOURCE", chemin); }
        }
        catch (ExceptionConnecteur e)
        {
            await Erreur(ctx, e.StatutHttp ?? 500, e.StatutHttp == 404 ? "MISSING_RESOURCE" : "INTERNAL_ERROR", e.Message);
        }
        catch (ContratRompu e)
        {
            await Erreur(ctx, 400, "MISSING_REQUIRED_FIELD", e.Message);
        }
    }

    private sealed class ContratRompu(string message) : Exception(message);

    private static void Exiger(bool condition, string quoi)
    {
        if (!condition) throw new ContratRompu(quoi);
    }

    private static string? Enumere(JsonNode? valeur, JsonNode swagger, string schema, string quoi)
    {
        if (valeur is null) return null;
        var v = valeur.GetValue<string>();
        Exiger(Swaggers.Enum(swagger, schema).Contains(v), $"{quoi} {v} hors du swagger");
        return v;
    }

    // ---------------------------------------------------------------- Flow Service

    private async Task FluxAsync(HttpContext ctx, RequeteRecue recue, string chemin)
    {
        var sw = Swaggers.Flux;
        var m = ctx.Request.Method;
        if (m == "POST" && chemin == "/v1/flows")
        {
            recue = await LireMultipartAsync(ctx, recue);
            Requetes.Enqueue(recue);
            var i = recue.InfoFlux!.AsObject();
            Exiger(recue.TypeInfoFlux == "application/json", "flowInfo en application/json");
            Exiger(recue.Fichier is { Length: > 0 }, "file");
            Exiger(i.All(p => p.Key is "trackingId" or "name" or "processingRule" or "flowSyntax" or "flowProfile" or "sha256"), "propriété de FlowInfo inconnue");
            var nom = i["name"]?.GetValue<string>();
            Exiger(nom is { Length: > 0 and <= 255 }, "name");
            var suivi = i["trackingId"]?.GetValue<string>();
            Exiger(suivi is null || suivi.Length <= 64, "trackingId");
            var empreinte = i["sha256"]?.GetValue<string>();
            Exiger(empreinte is null || Regex.IsMatch(empreinte, "^[a-f0-9]{64}$"), "sha256");
            var flux = new FluxADeposer(recue.Fichier!, nom!, Enumere(i["flowSyntax"], sw, "FlowSyntax", "flowSyntax") ?? throw new ContratRompu("flowSyntax"))
            {
                Profil = Enumere(i["flowProfile"], sw, "FlowProfile", "flowProfile"),
                RegleTraitement = Enumere(i["processingRule"], sw, "ProcessingRule", "processingRule"),
                IdentifiantSuivi = suivi,
            };
            var d = Plateforme.Deposer(flux, empreinte);
            var o = new JsonObject { ["flowId"] = d.IdFlux, ["submittedAt"] = Date(d.DeposeLe), ["name"] = d.Nom, ["flowSyntax"] = d.Syntaxe };
            if (d.IdentifiantSuivi is not null) o["trackingId"] = d.IdentifiantSuivi;
            if (d.Profil is not null) o["flowProfile"] = d.Profil;
            if (d.RegleTraitement is not null) o["processingRule"] = d.RegleTraitement;
            o["sha256"] = d.Empreinte;
            await Json(ctx, 202, o);
            return;
        }
        var corps = m == "POST" ? await JsonNode.ParseAsync(ctx.Request.Body) : null;
        Requetes.Enqueue(recue with { Corps = corps });
        if (m == "POST" && chemin == "/v1/flows/search")
        {
            Exiger(ctx.Request.ContentType?.StartsWith("application/json", StringComparison.Ordinal) == true, "application/json");
            var o = corps!.AsObject();
            Exiger(o.All(p => p.Key is "limit" or "cursor" or "where"), "propriété de SearchFlowParams inconnue");
            var ou = o["where"]?.AsObject() ?? throw new ContratRompu("where");
            Exiger(ou.Count > 0, "au moins un filtre");
            Exiger(ou.All(p => p.Key is "updatedAfter" or "updatedBefore" or "processingRule" or "flowType" or "flowDirection" or "trackingId" or "ackStatus"),
                "propriété de SearchFlowFilters inconnue");
            var limite = o["limit"]?.GetValue<int>() ?? 25;
            Exiger(limite is >= 1 and <= 100, "limit");
            List<string> Liste(string cle, string schema) => ou[cle] is JsonArray a ? [.. a.Select(v => Enumere(v, sw, schema, cle)!)] : [];
            var c = new CriteresFlux
            {
                ModifieApres = ou["updatedAfter"] is { } apres ? DateTimeOffset.Parse(apres.GetValue<string>(), CultureInfo.InvariantCulture) : null,
                ModifieAvant = ou["updatedBefore"] is { } avant ? DateTimeOffset.Parse(avant.GetValue<string>(), CultureInfo.InvariantCulture) : null,
                Regles = Liste("processingRule", "ProcessingRule"), Types = Liste("flowType", "FlowType"), Sens = Liste("flowDirection", "FlowDirection"),
                IdentifiantSuivi = ou["trackingId"]?.GetValue<string>(), EtatAccuse = Enumere(ou["ackStatus"], sw, "FlowAckStatus", "ackStatus"),
            };
            var page = Plateforme.Rechercher(c, o["cursor"]?.GetValue<string>(), limite);
            var r = new JsonObject { ["limit"] = limite, ["filters"] = ou.DeepClone(), ["results"] = new JsonArray([.. page.Flux.Select(JsonFlux)]) };
            if (page.CurseurSuivant is not null) r["nextCursor"] = page.CurseurSuivant;
            await Json(ctx, 200, r);
            return;
        }
        if (m == "GET" && chemin.StartsWith("/v1/flows/", StringComparison.Ordinal))
        {
            var id = Uri.UnescapeDataString(chemin["/v1/flows/".Length..]);
            var docType = ctx.Request.Query["docType"].FirstOrDefault() ?? "Metadata";
            var docTypes = sw["paths"]!["/v1/flows/{flowId}"]!["get"]!["parameters"]!.AsArray()
                .First(p => p!["name"]!.GetValue<string>() == "docType")!["schema"]!["enum"]!.AsArray().Select(v => v!.GetValue<string>());
            Exiger(docTypes.Contains(docType), "docType");
            if (docType == "Metadata") { await Json(ctx, 200, JsonFlux(Plateforme.Lire(id))); return; }
            var f = Plateforme.Telecharger(id, docType);
            ctx.Response.StatusCode = 200;
            ctx.Response.ContentType = "application/octet-stream";
            ctx.Response.Headers.ContentDisposition = $"attachment;filename={f.Nom}";
            await ctx.Response.Body.WriteAsync(f.Contenu);
            return;
        }
        if (m == "POST" && chemin == "/v1/webhooks")
        {
            Exiger(corps?["callbackUrl"] is not null, "callbackUrl");
            await Json(ctx, 201, new JsonObject { ["webhookId"] = Guid.NewGuid().ToString(), ["signingKey"] = "c2lnbmF0dXJl", ["createdAt"] = Date(DateTimeOffset.UtcNow) });
            return;
        }
        if (m == "GET" && chemin == "/v1/healthcheck") { ctx.Response.StatusCode = 200; return; }
        await Erreur(ctx, 404, "MISSING_RESOURCE", chemin);
    }

    private static async Task<RequeteRecue> LireMultipartAsync(HttpContext ctx, RequeteRecue recue)
    {
        var type = MediaTypeHeaderValue.Parse(ctx.Request.ContentType);
        Exiger(type.MediaType == "multipart/form-data", "multipart/form-data");
        var lecteur = new MultipartReader(HeaderUtilities.RemoveQuotes(type.Boundary).Value!, ctx.Request.Body);
        while (await lecteur.ReadNextSectionAsync() is { } section)
        {
            var disposition = ContentDispositionHeaderValue.Parse(section.ContentDisposition);
            using var memoire = new MemoryStream();
            await section.Body.CopyToAsync(memoire);
            switch (HeaderUtilities.RemoveQuotes(disposition.Name).Value)
            {
                case "flowInfo":
                    recue = recue with { InfoFlux = JsonNode.Parse(memoire.ToArray()), TypeInfoFlux = MediaTypeHeaderValue.Parse(section.ContentType).MediaType.Value };
                    break;
                case "file":
                    recue = recue with { Fichier = memoire.ToArray(), TypeFichier = section.ContentType, NomFichier = HeaderUtilities.RemoveQuotes(disposition.FileName).Value };
                    break;
            }
        }
        Exiger(recue.InfoFlux is not null, "flowInfo");
        return recue;
    }

    private static JsonObject JsonFlux(Flux f)
    {
        var o = new JsonObject { ["flowId"] = f.IdFlux };
        if (f.IdentifiantSuivi is not null) o["trackingId"] = f.IdentifiantSuivi;
        o["name"] = f.Nom;
        o["processingRule"] = f.RegleTraitement;
        o["flowSyntax"] = f.Syntaxe;
        o["flowProfile"] = f.Profil;
        o["submittedAt"] = Date(f.DeposeLe);
        o["updatedAt"] = Date(f.ModifieLe);
        o["flowType"] = f.Type;
        o["processingRuleSource"] = f.OrigineRegle;
        o["flowDirection"] = f.Sens;
        var accuse = new JsonObject { ["status"] = f.Accuse.Etat };
        if (f.Accuse.Details.Count > 0)
            accuse["details"] = new JsonArray([.. f.Accuse.Details.Select(d => (JsonNode)new JsonObject
            {
                ["level"] = d.Niveau, ["item"] = d.Element, ["reasonCode"] = d.Motif, ["reasonMessage"] = d.Message,
            })]);
        o["acknowledgement"] = accuse;
        return o;
    }

    // ---------------------------------------------------------------- Directory Service

    private async Task AnnuaireAsync(HttpContext ctx, RequeteRecue recue, string chemin)
    {
        var a = Plateforme.Annuaire;
        var m = ctx.Request.Method;
        var corps = m == "POST" ? await JsonNode.ParseAsync(ctx.Request.Body) : null;
        Requetes.Enqueue(recue with { Corps = corps });
        JsonNode? resultat = null;
        Match x;
        if (m == "GET" && (x = Regex.Match(chemin, "^/v1/siren/code-insee:([0-9]{9})$")).Success) resultat = Unite(a.UniteLegale(x.Groups[1].Value));
        else if (m == "GET" && (x = Regex.Match(chemin, "^/v1/siret/code-insee:([0-9]{14})$")).Success) resultat = Etab(a.Etablissement(x.Groups[1].Value));
        else if (m == "GET" && (x = Regex.Match(chemin, "^/v1/routing-code/siret:([0-9]{14})/code:(.+)$")).Success)
            resultat = Routage(a.CodeRoutage(x.Groups[1].Value, Uri.UnescapeDataString(x.Groups[2].Value)));
        else if (m == "GET" && (x = Regex.Match(chemin, "^/v1/directory-line/code:(.+)$")).Success) resultat = Ligne(a.Ligne(Uri.UnescapeDataString(x.Groups[1].Value)));
        else if (m == "POST" && (x = Regex.Match(chemin, "^/v1/(siren|siret|routing-code|directory-line)/search$")).Success)
        {
            var o = corps!.AsObject();
            Exiger(o.All(p => p.Key is "filters" or "sorting" or "fields" or "include" or "limit" or "ignore"), "propriété de recherche inconnue");
            var filtres = o["filters"]!.AsObject().Select(p =>
                new FiltreAnnuaire(p.Key, p.Value!["value"]!.GetValue<string>(), Enumere(p.Value["op"], Swaggers.Annuaire, "containsOrStrictOrStartWithOperator", "op")!)).ToList();
            var r = new RechercheAnnuaire(filtres) { Limite = o["limit"]?.GetValue<int>(), Ignorer = o["ignore"]?.GetValue<int>() };
            (int, IEnumerable<JsonNode>) page = x.Groups[1].Value switch
            {
                "siren" => Page(a.RechercherUnitesLegales(r), Unite),
                "siret" => Page(a.RechercherEtablissements(r), Etab),
                "routing-code" => Page(a.RechercherCodesRoutage(r), Routage),
                _ => Page(a.RechercherLignes(r), Ligne),
            };
            resultat = new JsonObject { ["search"] = o.DeepClone(), ["totalNumberOfResults"] = page.Item1, ["results"] = new JsonArray([.. page.Item2]) };
        }
        if (resultat is null) { await Erreur(ctx, 404, "MISSING_RESOURCE", chemin); return; }
        await Json(ctx, 200, resultat);
    }

    private static (int, IEnumerable<JsonNode>) Page<T>(ResultatsAnnuaire<T> r, Func<T, JsonObject> json) => (r.Total, r.Resultats.Select(v => (JsonNode)json(v)));

    private static JsonObject Unite(UniteLegale u) => new()
    {
        ["siren"] = u.Siren, ["businessName"] = u.RaisonSociale, ["entityType"] = u.TypeEntite, ["administrativeStatus"] = u.EtatAdministratif,
    };

    private static JsonObject? JsonAdresse(AdresseAnnuaire? a) => a is null ? null : new()
    {
        ["addressLine1"] = a.Ligne1, ["postalCode"] = a.CodePostal, ["locality"] = a.Localite, ["countryCode"] = a.CodePays,
    };

    private static JsonObject Etab(Etablissement e)
    {
        var o = new JsonObject
        {
            ["siret"] = e.Siret, ["siren"] = e.Siren, ["name"] = e.Nom, ["facilityType"] = e.TypeEtablissement, ["administrativeStatus"] = e.EtatAdministratif,
            ["address"] = JsonAdresse(e.Adresse),
        };
        if (e.DonneesB2g is { } b) o["b2gAdditionalData"] = new JsonObject { ["pm"] = b.MoaPublic, ["managesPaymentStatus"] = b.GereStatutPaiement, ["managesLegalCommitmentCode"] = b.GereEngagement };
        if (e.UniteLegale is { } u) o["legalUnit"] = Unite(u);
        return o;
    }

    private static JsonObject Routage(CodeRoutage c) => new()
    {
        ["routingIdentifier"] = c.IdentifiantRoutage, ["siret"] = c.Siret, ["routingIdentifierType"] = c.TypeIdentifiant, ["routingCodeName"] = c.Nom,
        ["managesLegalCommitmentCode"] = c.GereEngagement, ["administrativeStatus"] = c.EtatAdministratif, ["address"] = JsonAdresse(c.Adresse),
    };

    private static JsonObject Ligne(LigneAnnuaire l)
    {
        var o = new JsonObject
        {
            ["addressingIdentifier"] = l.IdentifiantAdressage, ["platformType"] = l.TypePlateforme, ["directoryLineStatus"] = l.Etat, ["siren"] = l.Siren,
            ["siret"] = l.Siret, ["routingIdentifier"] = l.IdentifiantRoutage, ["addressingSuffix"] = l.Suffixe,
        };
        if (l.UniteLegale is { } u) o["legalUnit"] = Unite(u);
        if (l.Etablissement is { } e) o["facility"] = Etab(e with { UniteLegale = null });
        if (l.CodeRoutage is { } c) o["routingCode"] = Routage(c);
        return o;
    }

    // ---------------------------------------------------------------- réponses

    private static string Date(DateTimeOffset d) => d.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    private static async Task Json(HttpContext ctx, int statut, JsonNode corps)
    {
        ctx.Response.StatusCode = statut;
        ctx.Response.ContentType = "application/json";
        await ctx.Response.WriteAsync(corps.ToJsonString(new JsonSerializerOptions { WriteIndented = false }));
    }

    private static Task Erreur(HttpContext ctx, int statut, string code, string? message) =>
        Json(ctx, statut, new JsonObject { ["errorCode"] = code, ["errorMessage"] = message });
}

/// <summary>Jeton de test (contrat IFournisseurJeton du socle) : compte les demandes.</summary>
public sealed class JetonsTest(string jeton = ServeurAfnorTest.Jeton) : IFournisseurJeton
{
    public int Demandes;

    public Task<JetonAcces> JetonAsync(long connexion, CancellationToken ct)
    {
        Interlocked.Increment(ref Demandes);
        return Task.FromResult(new JetonAcces(jeton, "compte-pa", DateTimeOffset.UtcNow.AddHours(1)));
    }

    public Task<IReadOnlyList<ConnexionExterne>> ConnexionsAsync(CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<ConnexionExterne>>([new ConnexionExterne(1, "PA", "GENERIQUE", "ACTIVE")]);
}

/// <summary>Horloge réglable des tests.</summary>
public sealed class HorlogeTest(DateTimeOffset depart) : TimeProvider
{
    private DateTimeOffset maintenant = depart;
    public override DateTimeOffset GetUtcNow() => maintenant;
    public void Avancer(TimeSpan duree) => maintenant += duree;
}

/// <summary>Journal des tests : messages formatés.</summary>
public sealed class JournalTest : ILogger
{
    public ConcurrentQueue<string> Messages { get; } = new();
    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
    public bool IsEnabled(LogLevel logLevel) => true;
    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
        Messages.Enqueue(formatter(state, exception) + exception);
}
