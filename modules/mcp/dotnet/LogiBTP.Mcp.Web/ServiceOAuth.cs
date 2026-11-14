using System.Security.Cryptography;
using System.Text.Json.Nodes;
using LogiBTP.Socle;
using LogiBTP.Socle.Donnees;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Mcp.Web;

/// <summary>Demande d'autorisation présentée à l'écran de consentement : client, hôte de retour, échéance, choix de délégation du profil.</summary>
public sealed record DemandeOAuth(string Demande, string ClientId, string ClientNom, string Retour, DateTimeOffset ExpireLe, ChoixDelegation Choix);

/// <summary>Décision de l'utilisateur : adresse du client vers laquelle le navigateur repart (code ou refus).</summary>
public sealed record DecisionOAuth(string Redirection);

/// <summary>Client de la liste blanche décrit.</summary>
public sealed record ClientOAuthDecrit(string ClientId, string Libelle, bool Actif, DateTimeOffset ModifieLe, string ModifiePar);

/// <summary>Client de la liste blanche saisi par l'administrateur.</summary>
public sealed record ClientOAuthSaisi(string? ClientId, string? Libelle, bool? Actif = true);

/// <summary>
/// Serveur d'autorisation OAuth 2.1 du point /mcp (plan MCP, lot 12 ; spécification MCP 2025-11-25, autorisation) :
/// métadonnées de la ressource protégée (RFC 9728) et du serveur (RFC 8414), demande d'autorisation (client de la liste
/// blanche décrit par son document CIMD, adresse de retour exacte, PKCE S256 obligatoire, ressource = /mcp de la
/// société, RFC 8707), consentement = création d'une délégation par l'utilisateur connecté, point de jeton (code à usage
/// unique ; jeton d'accès = jeton délégué court émis par <see cref="IJetonsDelegues"/> : même agent, même plafond, même
/// journal ; rafraîchissement rotatif à usage unique, rejeu → délégation révoquée). Jamais de flux implicite ni de mot
/// de passe ; clients publics seulement.
/// </summary>
public sealed class ServiceOAuth(McpDbContext db, SpecialisationMcp specialisation, IDocumentsClients documents, ServiceDelegations delegations,
    IServiceProvider services)
{
    /// <summary>Chemins des points du serveur d'autorisation (sous /api : routes publiques déclarées par l'application).</summary>
    public const string CheminAutorisation = "/api/mcp/oauth/authorize";
    public const string CheminJeton = "/api/mcp/oauth/token";

    /// <summary>Métadonnées de la ressource protégée (RFC 9728) : chemin à la racine, et suffixé du chemin de la ressource.</summary>
    public const string CheminMetadonneesRessource = "/.well-known/oauth-protected-resource";

    /// <summary>Métadonnées du serveur d'autorisation (RFC 8414 ; émetteur = origine de la société, sans chemin).</summary>
    public const string CheminMetadonneesServeur = "/.well-known/oauth-authorization-server";

    /// <summary>Compte noté comme auteur d'une révocation décidée par le serveur d'autorisation (rejeu d'un jeton).</summary>
    public const string RevoqueurOAuth = "oauth";

    /// <summary>Adresse des métadonnées de la ressource /mcp (en-tête WWW-Authenticate du 401).</summary>
    public static string AdresseMetadonnees(string origine) => origine.TrimEnd('/') + CheminMetadonneesRessource + Extensions.Chemin;

    /// <summary>Métadonnées de la ressource protégée /mcp de la société (RFC 9728).</summary>
    public static JsonObject MetadonneesRessource(string origine) => new()
    {
        ["resource"] = ReglesOAuth.Ressource(origine),
        ["authorization_servers"] = new JsonArray(origine.TrimEnd('/')),
        ["bearer_methods_supported"] = new JsonArray("header"),
        ["scopes_supported"] = new JsonArray(ReglesOAuth.Portee),
        ["resource_name"] = "LogiBTP",
    };

    /// <summary>Métadonnées du serveur d'autorisation de la société (RFC 8414), documents de client (CIMD) annoncés.</summary>
    public static JsonObject MetadonneesServeur(string origine)
    {
        var o = origine.TrimEnd('/');
        return new JsonObject
        {
            ["issuer"] = o,
            ["authorization_endpoint"] = o + CheminAutorisation,
            ["token_endpoint"] = o + CheminJeton,
            ["response_types_supported"] = new JsonArray("code"),
            ["response_modes_supported"] = new JsonArray("query"),
            ["grant_types_supported"] = new JsonArray("authorization_code", "refresh_token"),
            ["code_challenge_methods_supported"] = new JsonArray(ReglesOAuth.MethodePkce),
            ["token_endpoint_auth_methods_supported"] = new JsonArray("none"),
            ["scopes_supported"] = new JsonArray(ReglesOAuth.Portee),
            ["client_id_metadata_document_supported"] = true,
            ["authorization_response_iss_parameter_supported"] = true,
        };
    }

    private Task<bool> ClientAutoriseAsync(string clientId, CancellationToken ct) =>
        db.ClientsOAuth.AsNoTracking().AnyAsync(c => c.MclClientId == clientId && c.MclActif, ct);

    private static string? Unique(IQueryCollection q, string cle) => q.TryGetValue(cle, out var v) && v.Count == 1 ? v[0] : null;

    /// <summary>
    /// Demande d'autorisation (GET, navigation du navigateur, sans session exigée ici : le cookie de session n'est pas
    /// envoyé depuis le site du client). Client hors liste blanche, document invalide ou adresse de retour absente du
    /// document : page de consentement avec <c>?erreur=CODE</c> (jamais de redirection vers une adresse non vérifiée) ;
    /// ensuite, erreurs rendues au client (type de réponse, PKCE, ressource). Demande valable : enregistrée 10 minutes,
    /// page de consentement avec <c>?demande=…</c> (session exigée par l'application).
    /// </summary>
    public async Task<IResult> AutoriserAsync(HttpContext http, CancellationToken ct)
    {
        var consentement = specialisation.AdresseConsentement;
        if (consentement is null) return Results.NotFound();
        var q = http.Request.Query;
        var origine = ServiceMcp.Origine(http);
        IResult Page(string cle, string valeur) => Results.Redirect(ReglesOAuth.Redirection(consentement, [new(cle, valeur)]));

        var clientId = Unique(q, "client_id");
        if (!ReglesOAuth.ClientIdValide(clientId) || !await ClientAutoriseAsync(clientId!, ct)) return Page("erreur", ErreurMcp.McpOauthClient);
        var document = await documents.LireAsync(clientId!, ct);
        if (ReglesOAuth.ControlerDocument(clientId!, document) is not null) return Page("erreur", ErreurMcp.McpOauthClient);
        var redirection = Unique(q, "redirect_uri");
        if (!ReglesOAuth.RedirectionPermise(redirection, document!.Redirections) || redirection!.Length > 2000) return Page("erreur", ErreurMcp.McpOauthRedirection);

        var etat = Unique(q, "state");
        IResult Retour(string erreur, string description) => Results.Redirect(ReglesOAuth.Redirection(redirection,
            [new("error", erreur), new("error_description", description), new("state", etat), new("iss", origine)]));
        if (etat is { Length: > 2000 }) return Retour(ErreurOAuth.RequeteInvalide, "state trop long");
        if (Unique(q, "response_type") != "code") return Retour(ErreurOAuth.ReponseNonPrise, "response_type=code seul accepté");
        var defi = Unique(q, "code_challenge");
        if (Unique(q, "code_challenge_method") != ReglesOAuth.MethodePkce || !ReglesOAuth.DefiValide(defi))
            return Retour(ErreurOAuth.RequeteInvalide, "PKCE S256 obligatoire");
        var attendue = ReglesOAuth.Ressource(origine);
        var ressource = Unique(q, "resource");
        if (q.ContainsKey("resource") && !ReglesOAuth.RessourceEgale(ressource, attendue)) return Retour(ErreurOAuth.CibleInvalide, "Ressource d'une autre adresse");

        var maintenant = DateTimeOffset.UtcNow;
        // Ménage : demandes et codes échus depuis plus d'un jour, jetons de rafraîchissement échus depuis plus d'un jour.
        var ancien = maintenant.AddDays(-1);
        await db.AutorisationsOAuth.Where(a => a.MauExpireLe < ancien && (a.MauCodeExpireLe == null || a.MauCodeExpireLe < ancien)).ExecuteDeleteAsync(ct);
        await db.RafraichissementsOAuth.Where(r => r.MraExpireLe < ancien).ExecuteDeleteAsync(ct);

        var a = new AutorisationOAuthMcp
        {
            MauDemande = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32)),
            MauClientId = clientId!,
            MauClientNom = Nom(document, clientId!),
            MauRedirection = redirection,
            MauEtatClient = etat,
            MauDefi = defi!,
            MauRessource = attendue,
            MauPortee = Unique(q, "scope") is { } p ? p[..Math.Min(p.Length, 500)] : null,
            MauCreeLe = maintenant,
            MauExpireLe = maintenant.AddMinutes(ReglesOAuth.MinutesDemande),
        };
        db.AutorisationsOAuth.Add(a);
        await db.SaveChangesAsync(ct);
        return Page("demande", a.MauDemande);
    }

    /// <summary>Nom affiché du client : celui de son document (100 caractères), sinon l'hôte de son adresse.</summary>
    private static string Nom(DocumentClient d, string clientId)
    {
        var n = string.IsNullOrWhiteSpace(d.Nom) ? new Uri(clientId).Host : d.Nom.Trim();
        return n[..Math.Min(n.Length, 100)];
    }

    /// <summary>Demande en attente (ni échue, ni décidée), suivie par EF ; 422 MCP_OAUTH_DEMANDE sinon.</summary>
    private async Task<AutorisationOAuthMcp> EnAttenteAsync(string demande, CancellationToken ct)
    {
        var a = await db.AutorisationsOAuth.FirstOrDefaultAsync(x => x.MauDemande == demande, ct);
        if (a is null || a.MauDecideeLe is not null || a.MauExpireLe <= DateTimeOffset.UtcNow)
            throw ExceptionMetier.Invalide(ErreurMcp.McpOauthDemande, "Demande d'autorisation inconnue, échue ou déjà traitée");
        return a;
    }

    /// <summary>Demande présentée à l'écran de consentement (humain connecté, jamais un agent ni une usurpation).</summary>
    public async Task<DemandeOAuth> DemandeAsync(string demande, Utilisateur u, CancellationToken ct)
    {
        ServiceDelegations.ExigerHumain(u);
        var a = await EnAttenteAsync(demande, ct);
        var retour = new Uri(a.MauRedirection).GetLeftPart(UriPartial.Authority);
        return new DemandeOAuth(a.MauDemande, a.MauClientId, a.MauClientNom, retour, a.MauExpireLe, await delegations.ChoixAsync(u, ct));
    }

    /// <summary>
    /// Consentement : délégation créée par l'utilisateur connecté (mêmes contrôles que l'écran : modèle permis, échéance,
    /// garde-fous levables ; client = nom du client OAuth), code d'autorisation (5 minutes, usage unique, empreinte seule) ;
    /// rend l'adresse de retour du client avec <c>code</c>, <c>state</c> et <c>iss</c>.
    /// </summary>
    public async Task<DecisionOAuth> AccepterAsync(string demande, DelegationDemandee saisie, Utilisateur u, CancellationToken ct)
    {
        ServiceDelegations.ExigerHumain(u);
        var a = await EnAttenteAsync(demande, ct);
        if (!await ClientAutoriseAsync(a.MauClientId, ct)) throw ExceptionMetier.Invalide(ErreurMcp.McpOauthClient, "Client OAuth non autorisé");
        var d = await delegations.PreparerAsync(saisie with
        {
            Client = a.MauClientNom,
            Libelle = string.IsNullOrWhiteSpace(saisie.Libelle) ? a.MauClientNom : saisie.Libelle,
        }, u, ct);
        d.MdeClientOauth = a.MauClientId;
        var code = ReglesOAuth.Nouveau(ReglesOAuth.PrefixeCode);
        var maintenant = DateTimeOffset.UtcNow;
        await db.Unite().ExecuterAsync(async jeton =>
        {
            db.Delegations.Add(d);
            a.MauDecideeLe = maintenant;
            a.MauDecideePar = u.Code;
            a.MauDelegation = d.MdeCode;
            a.MauCodeEmpreinte = ReglesOAuth.Empreinte(code);
            a.MauCodeExpireLe = maintenant.AddMinutes(ReglesOAuth.MinutesCode);
            await db.SaveChangesAsync(jeton);
        }, ct);
        return new DecisionOAuth(ReglesOAuth.Redirection(a.MauRedirection,
            [new("code", code), new("state", a.MauEtatClient), new("iss", ServiceMcp.Origine(Http))]));
    }

    /// <summary>Refus de l'utilisateur : demande close, retour au client avec <c>error=access_denied</c>.</summary>
    public async Task<DecisionOAuth> RefuserAsync(string demande, Utilisateur u, CancellationToken ct)
    {
        ServiceDelegations.ExigerHumain(u);
        var a = await EnAttenteAsync(demande, ct);
        a.MauDecideeLe = DateTimeOffset.UtcNow;
        a.MauDecideePar = u.Code;
        a.MauRefusee = true;
        await db.SaveChangesAsync(ct);
        return new DecisionOAuth(ReglesOAuth.Redirection(a.MauRedirection,
            [new("error", ErreurOAuth.AccesRefuse), new("error_description", "Autorisation refusée par l'utilisateur"), new("state", a.MauEtatClient),
                new("iss", ServiceMcp.Origine(Http))]));
    }

    private HttpContext Http => (services.GetService(typeof(IHttpContextAccessor)) as IHttpContextAccessor)?.HttpContext
        ?? throw new InvalidOperationException("MCP : requête HTTP absente");

    private static IResult Erreur(string erreur, string description, int statut = StatusCodes.Status400BadRequest) =>
        Results.Json(new JsonObject { ["error"] = erreur, ["error_description"] = description }, statusCode: statut);

    /// <summary>
    /// Point de jeton (POST application/x-www-form-urlencoded, client public : <c>client_id</c> sans secret).
    /// <c>authorization_code</c> : code à usage unique (rejoué : délégation révoquée), même client, même adresse de retour,
    /// PKCE S256, ressource de la société ; <c>refresh_token</c> : jeton rotatif à usage unique (rejoué : délégation
    /// révoquée, MCP_OAUTH_REJEU au journal). Rend un jeton délégué de 15 minutes et un nouveau jeton de rafraîchissement.
    /// </summary>
    public async Task<IResult> JetonAsync(HttpContext http, CancellationToken ct)
    {
        http.Response.Headers.CacheControl = "no-store";
        http.Response.Headers.Pragma = "no-cache";
        if (!http.Request.HasFormContentType) return Erreur(ErreurOAuth.RequeteInvalide, "Corps application/x-www-form-urlencoded attendu");
        var f = await http.Request.ReadFormAsync(ct);
        string? F(string cle) => f.TryGetValue(cle, out var v) && v.Count == 1 ? v[0] : null;
        if (f.ContainsKey("client_secret") || http.Request.Headers.Authorization.Count > 0)
            return Erreur(ErreurOAuth.ClientInvalide, "Client public seulement (aucun secret)", StatusCodes.Status401Unauthorized);
        var clientId = F("client_id");
        if (string.IsNullOrEmpty(clientId)) return Erreur(ErreurOAuth.RequeteInvalide, "client_id manquant");
        var attendue = ReglesOAuth.Ressource(ServiceMcp.Origine(http));
        if (f.ContainsKey("resource") && !ReglesOAuth.RessourceEgale(F("resource"), attendue)) return Erreur(ErreurOAuth.CibleInvalide, "Ressource d'une autre adresse");
        return F("grant_type") switch
        {
            "authorization_code" => await CodeAsync(F("code"), clientId, F("redirect_uri"), F("code_verifier"), attendue, ct),
            "refresh_token" => await RafraichirAsync(F("refresh_token"), clientId, attendue, ct),
            null => Erreur(ErreurOAuth.RequeteInvalide, "grant_type manquant"),
            _ => Erreur(ErreurOAuth.OctroiNonPris, "Octrois acceptés : authorization_code, refresh_token"),
        };
    }

    private async Task<IResult> CodeAsync(string? code, string clientId, string? redirection, string? verificateur, string attendue, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(code)) return Erreur(ErreurOAuth.RequeteInvalide, "code manquant");
        var empreinte = ReglesOAuth.Empreinte(code);
        var a = await db.AutorisationsOAuth.AsNoTracking().FirstOrDefaultAsync(x => x.MauCodeEmpreinte == empreinte, ct);
        if (a is null || a.MauDelegation is null) return Erreur(ErreurOAuth.OctroiInvalide, "Code inconnu");
        if (a.MauCodeUtiliseLe is not null) return await RejeuAsync(a.MauDelegation, ct);
        if (a.MauCodeExpireLe is not { } fin || fin <= DateTimeOffset.UtcNow) return Erreur(ErreurOAuth.OctroiInvalide, "Code échu");
        if (!string.Equals(a.MauClientId, clientId, StringComparison.Ordinal)) return Erreur(ErreurOAuth.OctroiInvalide, "Code d'un autre client");
        if (!string.Equals(a.MauRedirection, redirection, StringComparison.Ordinal)) return Erreur(ErreurOAuth.OctroiInvalide, "redirect_uri différente de la demande");
        if (!ReglesOAuth.PkceValide(verificateur, a.MauDefi)) return Erreur(ErreurOAuth.OctroiInvalide, "code_verifier invalide");
        if (!ReglesOAuth.RessourceEgale(a.MauRessource, attendue)) return Erreur(ErreurOAuth.CibleInvalide, "Code d'une autre ressource");
        if (!await ClientAutoriseAsync(clientId, ct)) return Erreur(ErreurOAuth.ClientNonAutorise, "Client OAuth non autorisé");
        var maintenant = DateTimeOffset.UtcNow;
        // Usage unique, même entre deux requêtes simultanées : seule la première marque le code.
        var marques = await db.AutorisationsOAuth.Where(x => x.MauId == a.MauId && x.MauCodeUtiliseLe == null)
            .ExecuteUpdateAsync(x => x.SetProperty(y => y.MauCodeUtiliseLe, maintenant), ct);
        if (marques == 0) return await RejeuAsync(a.MauDelegation, ct);
        return await EmettreAsync(a.MauDelegation, clientId, a.MauRessource, ct);
    }

    private async Task<IResult> RafraichirAsync(string? jeton, string clientId, string attendue, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(jeton)) return Erreur(ErreurOAuth.RequeteInvalide, "refresh_token manquant");
        var empreinte = ReglesOAuth.Empreinte(jeton);
        var r = await db.RafraichissementsOAuth.AsNoTracking().FirstOrDefaultAsync(x => x.MraEmpreinte == empreinte, ct);
        if (r is null) return Erreur(ErreurOAuth.OctroiInvalide, "Jeton de rafraîchissement inconnu");
        if (!string.Equals(r.MraClientId, clientId, StringComparison.Ordinal)) return Erreur(ErreurOAuth.OctroiInvalide, "Jeton d'un autre client");
        if (r.MraUtiliseLe is not null || r.MraRevoqueLe is not null) return await RejeuAsync(r.MraDelegation, ct);
        var maintenant = DateTimeOffset.UtcNow;
        if (r.MraExpireLe <= maintenant) return Erreur(ErreurOAuth.OctroiInvalide, "Jeton de rafraîchissement échu");
        if (!ReglesOAuth.RessourceEgale(r.MraRessource, attendue)) return Erreur(ErreurOAuth.CibleInvalide, "Jeton d'une autre ressource");
        if (!await ClientAutoriseAsync(clientId, ct)) return Erreur(ErreurOAuth.ClientNonAutorise, "Client OAuth non autorisé");
        var marques = await db.RafraichissementsOAuth.Where(x => x.MraId == r.MraId && x.MraUtiliseLe == null && x.MraRevoqueLe == null)
            .ExecuteUpdateAsync(x => x.SetProperty(y => y.MraUtiliseLe, maintenant), ct);
        if (marques == 0) return await RejeuAsync(r.MraDelegation, ct);
        return await EmettreAsync(r.MraDelegation, clientId, r.MraRessource, ct);
    }

    /// <summary>
    /// Code ou jeton de rafraîchissement rejoué (vol présumé, RFC 9700 § 4.14) : la délégation est révoquée avec tous ses
    /// jetons (accès, rafraîchissement) et ses propositions en attente ; refus au journal des agents.
    /// </summary>
    private async Task<IResult> RejeuAsync(string code, CancellationToken ct)
    {
        var d = await db.Delegations.FirstOrDefaultAsync(x => x.MdeCode == code, ct);
        if (d is not null)
        {
            await delegations.RevoquerAsync(d, RevoqueurOAuth, "Jeton OAuth rejoué", ct);
            db.Journal.Add(new JournalAgent
            {
                AjoDate = DateTimeOffset.UtcNow, AjoDelegation = d.MdeCode, AjoCompte = d.MdeCompte, AjoClient = d.MdeClient, AjoOutil = "oauth",
                AjoClasse = ClasseOutil.Interdit, AjoStatut = StatutAppelAgent.Refus, AjoErreur = ErreurMcp.McpOauthRejeu,
            });
            await db.SaveChangesAsync(ct);
        }
        return Erreur(ErreurOAuth.OctroiInvalide, "Jeton déjà utilisé : délégation révoquée");
    }

    /// <summary>
    /// Jetons d'une délégation active : accès = jeton délégué du module Authentification (15 minutes, borné à la fin de la
    /// délégation ; compte inutilisable : refus), rafraîchissement rotatif jusqu'à la fin de la délégation.
    /// </summary>
    private async Task<IResult> EmettreAsync(string code, string clientId, string ressource, CancellationToken ct)
    {
        var d = await LecturesMcp.ActiveAsync(db, code, ct);
        if (d is null) return Erreur(ErreurOAuth.OctroiInvalide, "Délégation révoquée ou échue");
        if (services.GetService(typeof(IJetonsDelegues)) is not IJetonsDelegues jetons) return Erreur(ErreurOAuth.ErreurServeur, "Jetons délégués indisponibles", 500);
        var maintenant = DateTimeOffset.UtcNow;
        var finDelegation = new DateTimeOffset(d.MdeEcheance.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
        var echeance = ReglesOAuth.EcheanceAcces(maintenant, finDelegation);
        var rafraichissement = ReglesOAuth.Nouveau(ReglesOAuth.PrefixeRafraichissement);
        string acces;
        try
        {
            acces = await db.Unite().ExecuterAsync(async jeton =>
            {
                var secret = await jetons.EmettreAsync(d.MdeCompte, d.MdeCode, d.MdeClient, echeance.UtcDateTime, jeton);
                db.RafraichissementsOAuth.Add(new RafraichissementOAuthMcp
                {
                    MraEmpreinte = ReglesOAuth.Empreinte(rafraichissement), MraDelegation = d.MdeCode, MraClientId = clientId, MraRessource = ressource,
                    MraCreeLe = maintenant, MraExpireLe = finDelegation,
                });
                await db.SaveChangesAsync(jeton);
                return secret;
            }, ct);
        }
        catch (ExceptionMetier)
        {
            // Compte du délégant inutilisable (désactivé, expiré, mot de passe provisoire…) : aucun jeton.
            return Erreur(ErreurOAuth.OctroiInvalide, "Compte du délégant inutilisable");
        }
        return Results.Json(new JsonObject
        {
            ["access_token"] = acces,
            ["token_type"] = "Bearer",
            ["expires_in"] = (int)Math.Max(1, (echeance - maintenant).TotalSeconds),
            ["refresh_token"] = rafraichissement,
            ["scope"] = ReglesOAuth.Portee,
        });
    }

    /// <summary>Liste blanche des clients OAuth de la société (administrateur).</summary>
    public async Task<IReadOnlyList<ClientOAuthDecrit>> ClientsAsync(Utilisateur u, CancellationToken ct)
    {
        ServiceDelegations.ExigerHumain(u);
        u.ExigerAdmin();
        return (await db.ClientsOAuth.AsNoTracking().OrderBy(c => c.MclLibelle).ThenBy(c => c.MclClientId).ToListAsync(ct))
            .Select(c => new ClientOAuthDecrit(c.MclClientId, c.MclLibelle, c.MclActif, c.MclModifieLe, c.MclModifiePar)).ToList();
    }

    /// <summary>Contrôle de la liste saisie : adresses de document valides (https, chemin), libellés de 100 caractères au plus.</summary>
    public static IReadOnlyList<string> ControlerClients(IReadOnlyList<ClientOAuthSaisi> liste) =>
        liste.Any(c => !ReglesOAuth.ClientIdValide(c.ClientId?.Trim()) || (c.Libelle?.Trim().Length ?? 0) > 100) ? [ErreurMcp.McpOauthClient] : [];

    /// <summary>Remplace la liste blanche (administrateur) : clients retirés supprimés, autres créés ou modifiés.</summary>
    public async Task<IReadOnlyList<ClientOAuthDecrit>> EnregistrerClientsAsync(IReadOnlyList<ClientOAuthSaisi> liste, Utilisateur u, CancellationToken ct)
    {
        ServiceDelegations.ExigerHumain(u);
        u.ExigerAdmin();
        if (ControlerClients(liste) is { Count: > 0 } e) throw ExceptionMetier.Invalide(e[0], "Adresse de document de client invalide");
        var saisis = liste.GroupBy(c => c.ClientId!.Trim(), StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.Last());
        var existants = await db.ClientsOAuth.ToListAsync(ct);
        var maintenant = DateTimeOffset.UtcNow;
        foreach (var c in existants.Where(c => !saisis.ContainsKey(c.MclClientId))) db.ClientsOAuth.Remove(c);
        foreach (var (id, s) in saisis)
        {
            var c = existants.FirstOrDefault(x => x.MclClientId == id);
            if (c is null) db.ClientsOAuth.Add(c = new ClientOAuthMcp { MclClientId = id });
            var libelle = (s.Libelle ?? "").Trim();
            var actif = s.Actif ?? true;
            if (c.MclLibelle == libelle && c.MclActif == actif && c.MclModifiePar != "") continue;
            c.MclLibelle = libelle;
            c.MclActif = actif;
            c.MclModifieLe = maintenant;
            c.MclModifiePar = u.Code;
        }
        await db.SaveChangesAsync(ct);
        return await ClientsAsync(u, ct);
    }
}
