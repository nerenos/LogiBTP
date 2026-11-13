using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Protocol;

namespace LogiBTP.Mcp.Web;

/// <summary>
/// Agent de la requête /mcp, établi par le jeton délégué : compte et profil du délégant, délégation active, client,
/// en-têtes repris par l'appel interne (Host de la requête, Authorization du jeton : jamais d'autre identité), origine de la
/// requête (« https://societe.exemple.fr » : adresses absolues rendues avec les résultats).
/// </summary>
public sealed record ContexteAgent(string Compte, string Profil, DelegationMcp Delegation, string Client, string Authorization, string Hote, string? Session,
    string Origine = "")
{
    public Utilisateur Utilisateur => new(Compte, Profil) { Agent = new AgentRequete(Delegation.MdeCode, Client) };
}

/// <summary>Résultat d'un appel d'outil : contenu rendu au client MCP (JSON), erreur, statut du journal.</summary>
public sealed record ResultatOutil(string Texte, bool Erreur, string Statut, string? Code = null);

/// <summary>
/// Point /mcp : ouverture du jeton délégué, catalogue des outils permis à la délégation (classement par
/// ReglesDelegation), exécution par <see cref="IAppelInterne"/>, quotas (garde-fou VOLUME), filtre des clés sensibles,
/// contenus libres balisés, journal de chaque appel (lecture comprise).
/// </summary>
public sealed class ServiceMcp(McpDbContext db, SpecialisationMcp specialisation, IAppelInterne appel, IServiceProvider services)
{
    /// <summary>Clé du contexte de l'agent dans HttpContext.Items.</summary>
    public const string CleContexte = "LogiBTP.Mcp.Contexte";

    private static readonly string[] Reservees = ["/api/mcp", "/api/auth", "/api/droits"];
    private const int IdentifiantsMax = 100;
    private const int TexteParametreMax = 80;

    /// <summary>
    /// Agent de la requête : Bearer d'un jeton délégué ouvert par le module Authentification (contrat
    /// <see cref="IJetonsDelegues"/>), délégation active du même compte ; null sinon (401). Premier usage daté.
    /// </summary>
    public async Task<ContexteAgent?> OuvrirAsync(HttpContext http, CancellationToken ct)
    {
        var entete = http.Request.Headers.Authorization.ToString();
        if (!entete.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return null;
        var secret = entete[7..].Trim();
        if (secret.Length == 0 || services.GetService(typeof(IJetonsDelegues)) is not IJetonsDelegues jetons) return null;
        var j = await jetons.OuvrirAsync(secret, ct);
        if (j is null) return null;
        var d = await LecturesMcp.ActiveAsync(db, j.Delegation, ct);
        if (d is null || d.MdeCompte != j.Compte) return null;
        if (d.MdePremierUsage is null)
        {
            var maintenant = DateTimeOffset.UtcNow;
            await db.Delegations.Where(x => x.MdeId == d.MdeId && x.MdePremierUsage == null)
                .ExecuteUpdateAsync(x => x.SetProperty(y => y.MdePremierUsage, maintenant), ct);
        }
        return new ContexteAgent(j.Compte, j.Profil, d, string.IsNullOrEmpty(j.Client) ? d.MdeClient : j.Client, "Bearer " + secret,
            http.Request.Host.Value ?? "", http.Request.Headers["Mcp-Session-Id"].FirstOrDefault(), Origine(http));
    }

    /// <summary>Origine de la requête MCP (schéma et hôte de la société), sans barre finale.</summary>
    public static string Origine(HttpContext http) => http.Request.Host.HasValue ? $"{http.Request.Scheme}://{http.Request.Host.Value}" : "";

    /// <summary>Adresse absolue : origine + chemin relatif (« /document/12 ») ; chemin déjà absolu ou origine inconnue : inchangé.</summary>
    public static string Absolue(string origine, string chemin) =>
        string.IsNullOrEmpty(origine) || Uri.TryCreate(chemin, UriKind.Absolute, out var u) && u.Scheme is "http" or "https"
            ? chemin : origine.TrimEnd('/') + (chemin.StartsWith('/') ? chemin : "/" + chemin);

    private sealed record Evaluation(IReadOnlyList<string> Actifs, LeveesProfil Levees, DroitsProfil Profil, PlafondDelegation Plafond, OptionsDelegation Options);

    /// <summary>
    /// Données du classement : garde-fous actifs (double accord), droits du profil sur les nœuds des outils (contrat
    /// IDroits, pour l'utilisateur humain : sans IDroits, aucun droit), plafond de la délégation, options de la spécialisation.
    /// </summary>
    private async Task<Evaluation> EvaluerAsync(ContexteAgent ctx, CancellationToken ct)
    {
        var levees = await LecturesMcp.LeveesAsync(db, ctx.Profil, ct);
        var actifs = ReglesDelegation.GardesFousActifs(levees.Levables, LecturesMcp.Liste(ctx.Delegation.MdeLeves));
        var lignes = new Dictionary<string, IReadOnlyDictionary<string, string>>();
        var total = false;
        if (services.GetService(typeof(IDroits)) is IDroits droits)
        {
            total = (await droits.ProfilsAsync(ct)).Any(p => p.Code == ctx.Profil && p.Total);
            var humain = new Utilisateur(ctx.Compte, ctx.Profil);
            foreach (var g in specialisation.Outils.GroupBy(o => o.Noeud))
            {
                var ligne = new Dictionary<string, string>();
                foreach (var a in g.Select(o => o.Action).Distinct())
                    if (await droits.PorteeAsync(humain, g.Key, a, ct) is { } p) ligne[a] = p;
                lignes[g.Key] = ligne;
            }
        }
        var catalogue = specialisation.Outils.GroupBy(o => o.Noeud)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<string>)g.Select(o => o.Action).Distinct().ToList());
        return new Evaluation(actifs, levees, new DroitsProfil(total, lignes), LecturesMcp.Plafond(ctx.Delegation),
            new OptionsDelegation(catalogue, specialisation.NoeudsRetenus, LecturesMcp.Interdits(specialisation, actifs)));
    }

    private static string Classer(OutilMcp o, Evaluation e)
    {
        if (o.Classe == ClasseOutil.Interdit || Reservees.Any(r => o.Route == r || o.Route.StartsWith(r + "/", StringComparison.OrdinalIgnoreCase)))
            return ClasseOutil.Interdit;
        return ReglesDelegation.ClasserOutil(new OutilAgent(o.Noeud, o.Action, o.Envoi), e.Profil, e.Plafond, e.Actifs, e.Options);
    }

    /// <summary>Outils exposés à l'agent : ceux du catalogue que la délégation permet (lecture ou brouillon), descriptions du dictionnaire.</summary>
    public async Task<IList<Tool>> OutilsAsync(ContexteAgent ctx, CancellationToken ct)
    {
        var e = await EvaluerAsync(ctx, ct);
        return specialisation.Outils
            .Select(o => (Outil: o, Classe: Classer(o, e)))
            .Where(x => x.Classe is ClasseOutil.Lecture or ClasseOutil.Brouillon)
            .Select(x => new Tool
            {
                Name = x.Outil.Nom,
                Description = specialisation.Texte(x.Outil.Description),
                InputSchema = x.Outil.Schema,
                Annotations = new ToolAnnotations { ReadOnlyHint = x.Classe == ClasseOutil.Lecture, DestructiveHint = false, OpenWorldHint = false },
            }).ToList();
    }

    /// <summary>Appel d'un outil : classement, quota, appel interne, filtre, compteur, journal.</summary>
    public async Task<ResultatOutil> AppelerAsync(ContexteAgent ctx, string nom, IReadOnlyDictionary<string, JsonElement>? arguments, CancellationToken ct)
    {
        var chrono = Stopwatch.StartNew();
        var args = (arguments ?? new Dictionary<string, JsonElement>()).ToDictionary(kv => kv.Key, kv => (JsonNode?)JsonNode.Parse(kv.Value.GetRawText()));
        var journal = new JournalAgent
        {
            AjoDate = DateTimeOffset.UtcNow, AjoDelegation = ctx.Delegation.MdeCode, AjoCompte = ctx.Compte, AjoClient = ctx.Client,
            AjoSession = ctx.Session, AjoOutil = nom.Length > 100 ? nom[..100] : nom,
        };
        var outil = specialisation.Outil(nom);
        ResultatOutil resultat;
        try
        {
            resultat = outil is null
                ? Refus(ErreurMcp.McpOutilInconnu, StatutAppelAgent.Refus, 404)
                : await ExecuterAsync(ctx, outil, args, journal, ct);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            resultat = Refus("ERREUR_INTERNE", StatutAppelAgent.Erreur, 500);
            journal.AjoErreur = ex.GetType().Name;
        }
        journal.AjoParametres = JsonSerializer.Serialize(Resume(args, outil));
        journal.AjoStatut = resultat.Statut;
        journal.AjoErreur ??= resultat.Code;
        journal.AjoDureeMs = (int)Math.Min(int.MaxValue, chrono.ElapsedMilliseconds);
        db.Journal.Add(journal);
        await db.SaveChangesAsync(CancellationToken.None);
        return resultat;
    }

    private static ResultatOutil Refus(string code, string statut, int http, JsonNode? details = null)
    {
        var o = new JsonObject { ["code"] = code, ["statut"] = http };
        if (details is not null) o["details"] = details;
        return new ResultatOutil(o.ToJsonString(), true, statut, code);
    }

    private async Task<ResultatOutil> ExecuterAsync(ContexteAgent ctx, OutilMcp outil, Dictionary<string, JsonNode?> args, JournalAgent journal, CancellationToken ct)
    {
        var e = await EvaluerAsync(ctx, ct);
        var classe = Classer(outil, e);
        journal.AjoClasse = classe;
        var gardes = new JsonObject { ["actifs"] = new JsonArray([.. e.Actifs.Select(g => (JsonNode?)g)]) };
        journal.AjoGardesFous = gardes.ToJsonString();
        // Propositions à un humain : file des propositions (lot 10) ; d'ici là, refusées comme un outil interdit.
        if (classe is not (ClasseOutil.Lecture or ClasseOutil.Brouillon)) return Refus(ErreurMcp.McpOutilInterdit, StatutAppelAgent.Refus, 403);

        // Garde-fou VOLUME : quota du jour épuisé → refus ; nombre demandé borné au quota accordé.
        var volume = e.Actifs.Contains(GardeFou.Volume);
        var jour = LecturesMcp.Aujourdhui;
        var deja = volume ? await db.Compteurs.AsNoTracking().Where(c => c.McoDelegation == ctx.Delegation.MdeCode && c.McoJour == jour)
            .Select(c => c.McoElements).FirstOrDefaultAsync(ct) : 0;
        if (volume)
        {
            var demandes = outil.ParametreLimite is { } p && args.TryGetValue(p, out var v) && v is JsonValue jv && jv.TryGetValue<int>(out var n) ? Math.Max(1, n)
                : outil.ParametreLimite is null ? 1 : e.Levees.Quotas.Appel ?? ReglesDelegation.QuotaAppel;
            var q = ReglesDelegation.AppliquerQuota(demandes, deja, e.Levees.Quotas);
            if (q.Erreur is not null)
            {
                gardes["quota"] = q.Erreur;
                journal.AjoGardesFous = gardes.ToJsonString();
                return Refus(q.Erreur, StatutAppelAgent.Quota, 429);
            }
            if (outil.ParametreLimite is { } limite) args[limite] = q.Accordes;
        }
        // Pagination bornée par l'outil (même garde-fou VOLUME levé).
        if (outil.ParametreLimite is { } pl && outil.LimiteMax is int max && args.TryGetValue(pl, out var lv) && lv is JsonValue lj && lj.TryGetValue<int>(out var ln) && ln > max)
            args[pl] = max;

        if (!Requete(outil, args, out var chemin, out var corps, out var manquant))
            return Refus(ErreurMcp.McpOutilParametre, StatutAppelAgent.Refus, 422, manquant);
        var reponse = await appel.EnvoyerAsync(new RequeteInterne(outil.Methode.ToUpperInvariant(), chemin, corps, ctx.Hote, ctx.Authorization), ct);
        journal.AjoRoutes = new JsonArray(new JsonObject { ["methode"] = outil.Methode.ToUpperInvariant(), ["route"] = outil.Route, ["statut"] = reponse.Statut }).ToJsonString();

        JsonNode? donnees;
        try { donnees = string.IsNullOrWhiteSpace(reponse.Corps) ? null : JsonNode.Parse(reponse.Corps); }
        catch (JsonException) { donnees = JsonValue.Create(reponse.Corps); }

        var sensibles = FiltreSensible.Cles(e.Actifs, specialisation.ClesSensibles, outil.ClesSensibles);
        var nonFiables = specialisation.ClesNonFiables.Concat(outil.ClesNonFiables).ToHashSet(StringComparer.Ordinal);
        var filtre = FiltreSensible.Filtrer(donnees, sensibles, nonFiables);
        if (filtre.ClesRetirees.Count > 0) gardes["cles_retirees"] = new JsonArray([.. filtre.ClesRetirees.Select(c => (JsonNode?)c)]);
        journal.AjoGardesFous = gardes.ToJsonString();

        if (reponse.Statut >= 400)
        {
            var code = (filtre.Reponse as JsonObject)?["code"]?.GetValue<string>() ?? $"HTTP_{reponse.Statut}";
            return Refus(code, reponse.Statut is 401 or 403 ? StatutAppelAgent.Refus : StatutAppelAgent.Erreur, reponse.Statut, filtre.Reponse);
        }

        // Éléments lus (lecture) ou écrits ; garde-fou VOLUME : liste tronquée au quota restant, compteur du jour.
        var resultat = filtre.Reponse;
        var liste = outil.CleListe is { } cl ? (resultat as JsonObject)?[cl] as JsonArray : resultat as JsonArray;
        var tronque = false;
        if (volume && liste is not null)
        {
            var q = ReglesDelegation.AppliquerQuota(liste.Count, deja, e.Levees.Quotas);
            while (liste.Count > q.Accordes) liste.RemoveAt(liste.Count - 1);
            tronque = q.Tronque;
            if (q.Alerte) gardes["alerte_quota"] = true;
            if (tronque) gardes["tronque"] = true;
            journal.AjoGardesFous = gardes.ToJsonString();
        }
        var elements = liste is not null ? liste.OfType<JsonNode>().ToList() : resultat is null ? [] : [resultat];
        // Adresse absolue de chaque élément (origine de la société) : l'humain relit et valide dans l'application.
        foreach (var o in elements.OfType<JsonObject>())
            if (specialisation.Adresse(outil, o) is { Length: > 0 } relative) o[SpecialisationMcp.CleAdresse] = Absolue(ctx.Origine, relative);
        var ids = new JsonArray([.. elements.Take(IdentifiantsMax)
            .Select(x => outil.CleIdentifiant is { } ci && x is JsonObject o && o[ci] is { } id ? id.DeepClone() : null).Where(x => x is not null)]);
        var trace = new JsonObject { ["type"] = outil.TypeElement, ["identifiants"] = ids, ["nombre"] = elements.Count };
        // Lecture (outil classé LECTURE, même par POST : listes) ou écriture.
        if (outil.Classe == ClasseOutil.Lecture || HttpMethods.IsGet(outil.Methode))
        {
            journal.AjoLus = trace.ToJsonString();
            journal.AjoNbLus = elements.Count;
        }
        else
        {
            trace["action"] = outil.Action;
            journal.AjoEcrits = trace.ToJsonString();
        }
        await db.Database.ExecuteSqlAsync($"""
            INSERT INTO mcp_compteur (mco_delegation, mco_jour, mco_appels, mco_elements) VALUES ({ctx.Delegation.MdeCode}, {jour}, 1, {journal.AjoNbLus})
            ON CONFLICT (mco_delegation, mco_jour) DO UPDATE SET mco_appels = mcp_compteur.mco_appels + 1, mco_elements = mcp_compteur.mco_elements + EXCLUDED.mco_elements
            """, ct);

        var enveloppe = new JsonObject { ["donnees"] = resultat?.DeepClone() };
        if (tronque) enveloppe["tronque"] = true;
        if (filtre.ClesRetirees.Count > 0) enveloppe["cles_retirees"] = new JsonArray([.. filtre.ClesRetirees.Select(c => (JsonNode?)c)]);
        return new ResultatOutil(enveloppe.ToJsonString(), false, StatutAppelAgent.Succes);
    }

    /// <summary>
    /// Chemin et corps de la route : « {nom} » remplacé par l'argument (échappé) ; autres arguments en paramètres de
    /// requête (GET, HEAD, DELETE) ou dans le corps JSON. Argument de route manquant : faux. Schéma qui déclare ses
    /// propriétés : les arguments non déclarés sont ignorés (un agent n'ajoute ni « definition » à une liste, ni
    /// « confidentiel » à une fiche).
    /// </summary>
    public static bool Requete(OutilMcp outil, IReadOnlyDictionary<string, JsonNode?> args, out string chemin, out string? corps, out JsonNode? manquant)
    {
        var declares = outil.Schema.ValueKind == JsonValueKind.Object && outil.Schema.TryGetProperty("properties", out var proprietes)
            && proprietes.ValueKind == JsonValueKind.Object ? proprietes.EnumerateObject().Select(p => p.Name).ToHashSet(StringComparer.Ordinal) : null;
        var restants = args.Where(kv => declares is null || declares.Contains(kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value);
        var sb = new StringBuilder();
        manquant = null;
        var route = outil.Route;
        for (var i = 0; i < route.Length; i++)
        {
            if (route[i] != '{') { sb.Append(route[i]); continue; }
            var fin = route.IndexOf('}', i);
            var nom = route[(i + 1)..fin].Split(':')[0];
            if (!restants.Remove(nom, out var v) || v is null || Texte(v) is not { Length: > 0 } t)
            {
                manquant = new JsonObject { ["parametre"] = nom };
                chemin = "";
                corps = null;
                return false;
            }
            sb.Append(Uri.EscapeDataString(t));
            i = fin;
        }
        var methode = outil.Methode.ToUpperInvariant();
        corps = null;
        if (methode is "GET" or "HEAD" or "DELETE")
        {
            var requete = string.Join("&", restants.Where(kv => kv.Value is not null)
                .Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(Texte(kv.Value!))}"));
            if (requete.Length > 0) sb.Append('?').Append(requete);
        }
        else
        {
            var o = new JsonObject();
            foreach (var (k, v) in restants) o[k] = v?.DeepClone();
            corps = o.ToJsonString();
        }
        chemin = sb.ToString();
        return true;
    }

    private static string Texte(JsonNode n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : n.ToJsonString();

    /// <summary>Résumé des paramètres pour le journal : valeurs des clés sensibles masquées, textes tronqués.</summary>
    private JsonObject Resume(Dictionary<string, JsonNode?> args, OutilMcp? outil)
    {
        var sensibles = specialisation.ClesSensibles.Values.SelectMany(x => x)
            .Concat(outil?.ClesSensibles.Values.SelectMany(x => x) ?? []).ToHashSet(StringComparer.Ordinal);
        var o = new JsonObject();
        foreach (var (k, v) in args)
        {
            o[k] = sensibles.Contains(k) ? "***"
                : v is JsonValue jv && jv.TryGetValue<string>(out var s) ? (s.Length > TexteParametreMax ? s[..TexteParametreMax] + "…" : s)
                : v is null ? null : JsonValue.Create(v.ToJsonString() is { Length: > TexteParametreMax } j ? j[..TexteParametreMax] + "…" : v.ToJsonString());
        }
        return o;
    }
}
