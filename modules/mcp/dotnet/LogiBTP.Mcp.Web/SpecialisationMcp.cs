using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Http;

namespace LogiBTP.Mcp.Web;

/// <summary>
/// Outil d'agent déclaré par la spécialisation (jamais saisi en base : R9). Chaque outil appelle une route /api existante
/// avec le jeton délégué de l'agent (pipeline complet : droits, unité d'écriture, contrôles).
/// </summary>
/// <param name="Nom">Nom de l'outil exposé au client MCP (minuscules, chiffres, « _ »).</param>
/// <param name="Description">Clé du dictionnaire de la description (texte constant relu, <see cref="SpecialisationMcp.Texte"/>).</param>
/// <param name="Schema">Schéma JSON des arguments (objet « type: object »).</param>
/// <param name="Methode">Méthode HTTP de la route.</param>
/// <param name="Route">Gabarit de la route /api ; « {nom} » est remplacé par l'argument de même nom ; les autres arguments
/// vont en paramètres de requête (GET, DELETE) ou dans le corps JSON.</param>
/// <param name="Noeud">Nœud de droits de l'action exigée.</param>
/// <param name="Action">Action exigée (ActionsDroits).</param>
/// <param name="Classe">Classement déclaré (<see cref="ClasseOutil"/> : LECTURE, BROUILLON, PROPOSITION).</param>
public sealed record OutilMcp(string Nom, string Description, JsonElement Schema, string Methode, string Route, string Noeud, string Action, string Classe)
{
    /// <summary>Effet externe (courriel, envoi) : retenu par le garde-fou ENVOI.</summary>
    public bool Envoi { get; init; }

    /// <summary>Clés retirées des réponses par garde-fou actif (en plus de celles de la spécialisation).</summary>
    public IReadOnlyDictionary<string, IReadOnlyList<string>> ClesSensibles { get; init; } = new Dictionary<string, IReadOnlyList<string>>();

    /// <summary>Clés dont la valeur est un contenu libre (texte d'un tiers, d'un PDF…) : balisée <c>contenu_non_fiable</c>.</summary>
    public IReadOnlyList<string> ClesNonFiables { get; init; } = [];

    /// <summary>Argument du nombre d'éléments demandés (garde-fou VOLUME : borné au quota accordé) ; null : un élément.</summary>
    public string? ParametreLimite { get; init; }

    /// <summary>Plafond du nombre d'éléments par appel (pagination), appliqué à <see cref="ParametreLimite"/> même sans garde-fou VOLUME.</summary>
    public int? LimiteMax { get; init; }

    /// <summary>Clé du tableau des éléments dans la réponse (null : la réponse elle-même si c'est un tableau, sinon un élément).</summary>
    public string? CleListe { get; init; }

    /// <summary>Type des éléments lus ou écrits, pour le journal (« document », « fiche/chantier »…).</summary>
    public string? TypeElement { get; init; }

    /// <summary>Clé de l'identifiant d'un élément de la réponse, pour le journal (« ent_id »…).</summary>
    public string? CleIdentifiant { get; init; }

    /// <summary>
    /// Outil composé : routes appelées en plus de <see cref="Route"/> par <see cref="Execution"/> (lecture ou écriture).
    /// Les écritures entrent dans la liste blanche du plafond ; toute autre route est refusée à l'exécution
    /// (<see cref="ErreurMcp.McpRouteNonDeclaree"/>).
    /// </summary>
    public IReadOnlyList<RouteOutil> Routes { get; init; } = [];

    /// <summary>
    /// Exécution composée (plusieurs appels internes : verrou, lecture, enregistrement…) à la place de l'appel unique de
    /// <see cref="Route"/> ; la réponse rendue suit le même chemin (filtre des clés sensibles, adresse, journal). Null :
    /// appel unique.
    /// </summary>
    public Func<ExecutionOutil, CancellationToken, Task<ReponseInterne>>? Execution { get; init; }

    /// <summary>Routes que l'outil peut appeler : <see cref="Route"/> puis <see cref="Routes"/>.</summary>
    public IEnumerable<RouteOutil> ToutesRoutes => Routes.Prepend(new RouteOutil(Methode, Route));
}

/// <summary>Route appelée par un outil composé : méthode HTTP et gabarit /api (« {nom} » : un segment quelconque).</summary>
public sealed record RouteOutil(string Methode, string Route)
{
    /// <summary>Le chemin (sans sa requête) suit le gabarit, segment par segment (paramètre : segment non vide).</summary>
    public bool Couvre(string methode, string chemin)
    {
        if (!string.Equals(Methode, methode, StringComparison.OrdinalIgnoreCase)) return false;
        var c = chemin.Split('?', 2)[0].Trim('/').Split('/');
        var g = Route.Trim('/').Split('/');
        if (c.Length != g.Length) return false;
        for (var i = 0; i < g.Length; i++)
        {
            if (g[i].StartsWith('{') ? c[i].Length == 0 : !string.Equals(g[i], c[i], StringComparison.OrdinalIgnoreCase)) return false;
        }
        return true;
    }
}

/// <summary>Appel d'une route non déclarée par un outil composé (refus 403 <see cref="ErreurMcp.McpRouteNonDeclaree"/>).</summary>
public sealed class RouteNonDeclareeException(string methode, string chemin) : Exception($"Route non déclarée par l'outil : {methode} {chemin}")
{
    public string Methode { get; } = methode;
    public string Chemin { get; } = chemin;
}

/// <summary>
/// Contexte d'exécution d'un outil composé : arguments déclarés par le schéma, garde-fous actifs de la délégation, appel
/// interne borné aux routes déclarées par l'outil (même jeton délégué, même hôte), appels tracés pour le journal.
/// </summary>
public sealed class ExecutionOutil(OutilMcp outil, IReadOnlyDictionary<string, JsonNode?> arguments, IReadOnlyList<string> gardesFous,
    Func<string, string, string?, CancellationToken, Task<ReponseInterne>> envoyer, bool lectureSeule = false)
{
    private readonly List<JsonObject> appels = [];

    /// <summary>
    /// Outil de proposition (classe PROPOSITION) : seules les lectures (GET) sont permises, l'action elle-même n'étant
    /// exécutée qu'à l'acceptation par un humain (<see cref="Proposer"/>).
    /// </summary>
    public bool LectureSeule { get; } = lectureSeule;

    /// <summary>Proposition déposée par l'outil (null : aucune) ; enregistrée par le module après le contrôle du plafond.</summary>
    public PropositionPreparee? Proposition { get; private set; }

    /// <summary>Dépose une proposition (une par appel) : action d'un exécuteur déclaré, nœud et droit exigés de l'humain, contenu.</summary>
    public void Proposer(PropositionPreparee proposition)
    {
        if (Proposition is not null) throw new InvalidOperationException("MCP : une seule proposition par appel d'outil");
        Proposition = proposition;
    }

    public OutilMcp Outil { get; } = outil;

    /// <summary>Arguments de l'appel, limités aux propriétés déclarées par le schéma de l'outil.</summary>
    public IReadOnlyDictionary<string, JsonNode?> Arguments { get; } = arguments;

    /// <summary>Garde-fous actifs de la délégation (COUTS, TIERS…).</summary>
    public IReadOnlyList<string> GardesFous { get; } = gardesFous;

    /// <summary>Appels faits (méthode, gabarit, statut), pour le journal.</summary>
    public IReadOnlyList<JsonObject> Appels => appels;

    /// <summary>Appel interne d'une route déclarée par l'outil ; toute autre route : <see cref="RouteNonDeclareeException"/>.</summary>
    public async Task<ReponseInterne> EnvoyerAsync(string methode, string chemin, JsonNode? corps, CancellationToken ct)
    {
        var route = Outil.ToutesRoutes.FirstOrDefault(r => r.Couvre(methode, chemin)) ?? throw new RouteNonDeclareeException(methode, chemin);
        if (LectureSeule && !HttpMethods.IsGet(methode) && !HttpMethods.IsHead(methode)) throw new RouteNonDeclareeException(methode, chemin);
        var reponse = await envoyer(methode.ToUpperInvariant(), chemin, corps?.ToJsonString(), ct);
        appels.Add(new JsonObject { ["methode"] = route.Methode.ToUpperInvariant(), ["route"] = route.Route, ["statut"] = reponse.Statut });
        return reponse;
    }
}

/// <summary>
/// Proposition préparée par un outil (lot 10, ANALYSE-MODULE-MCP.md § 10.1) : action = code d'un exécuteur déclaré par la
/// spécialisation ; nœud et droit exigés de l'humain qui accepte (contrôlés aussi au dépôt : l'agent ne propose que ce que
/// son délégant pourrait faire) ; effet externe (garde-fou ENVOI) ; libellé ; cible (type, identifiant) ; contenu (écarts,
/// corrigeable par l'humain) ; avertissements ; échéance en jours (7 par défaut, 30 au plus).
/// </summary>
public sealed record PropositionPreparee(string Action, string Noeud, string Droit, string Libelle, JsonNode? Contenu,
    string? CibleType = null, string? CibleId = null, JsonArray? Avertissements = null, bool Envoi = false, int? Jours = null);

/// <summary>
/// Exécuteur d'une proposition acceptée, déclaré par la spécialisation : appelle le service de la route existante sous
/// l'identité de l'humain (sa session, ses droits, ses limites de montant ; jamais le jeton de l'agent), dans la
/// transaction ouverte par le module ; rend un résumé (« identifiants » des éléments écrits, pour le journal).
/// </summary>
/// <param name="Action">Code de l'action proposée (« valider_piece »…).</param>
/// <param name="Executer">Exécution sous l'identité de l'humain.</param>
public sealed record ExecuteurProposition(string Action, Func<ExecutionProposition, CancellationToken, Task<JsonObject>> Executer)
{
    /// <summary>Contrôle d'un contenu corrigé par l'humain : codes d'erreur (vide : accepté) ; null : tout contenu objet.</summary>
    public Func<JsonNode?, IReadOnlyList<string>>? Controler { get; init; }

    /// <summary>Type des éléments écrits, pour le journal (« document »…).</summary>
    public string? TypeElement { get; init; }
}

/// <summary>
/// Contexte de l'exécution d'une proposition acceptée : proposition (cible, contenu éventuellement corrigé), humain qui
/// accepte (utilisateur de la requête), services et requête HTTP de l'acceptation (portée de la société).
/// </summary>
public sealed class ExecutionProposition(PropositionMcp proposition, JsonObject contenu, Utilisateur humain, HttpContext http)
{
    public long Id => proposition.MprId;
    public string Action => proposition.MprAction;
    public string? CibleType => proposition.MprCibleType;
    public string? CibleId => proposition.MprCibleId;

    /// <summary>Contenu de la proposition (corrigé par l'humain s'il l'a fait).</summary>
    public JsonObject Contenu { get; } = contenu;

    /// <summary>Humain qui accepte : l'exécution se fait sous son identité, jamais sous celle de l'agent.</summary>
    public Utilisateur Humain { get; } = humain;

    public HttpContext Http { get; } = http;
    public IServiceProvider Services => http.RequestServices;
}

/// <summary>
/// Spécialisation du module MCP (méthode patron) : l'application fournit le catalogue d'outils, les nœuds retenus par
/// garde-fou, les interdits supplémentaires, les clés sensibles et les contenus libres. Le module ne connaît ni les
/// documents, ni les tiers, ni les chantiers.
/// </summary>
public abstract class SpecialisationMcp
{
    /// <summary>Nœud de droits des routes de gestion /api/mcp (interdit à tout agent, quel que soit le plafond).</summary>
    public virtual string Noeud => "agents";

    /// <summary>Code du module facultatif de l'application qui active le point /mcp par société (null : toujours actif).</summary>
    public virtual string? Module => null;

    /// <summary>Clé de l'adresse absolue ajoutée à chaque élément d'une réponse (<see cref="Adresse"/>).</summary>
    public const string CleAdresse = "adresse";

    /// <summary>
    /// Adresse relative (« /document/12 ») d'un élément de la réponse d'un outil, rendue absolue par le module (origine de la
    /// requête MCP : société du sous-domaine) ; null : pas d'adresse.
    /// </summary>
    public virtual string? Adresse(OutilMcp outil, JsonObject element) => null;

    /// <summary>Catalogue des outils (constant ; vide par défaut).</summary>
    public virtual IReadOnlyList<OutilMcp> Outils => [];

    /// <summary>Nœuds retenus par garde-fou actif (garde-fou → préfixes de nœuds) : l'agent n'y a aucune action.</summary>
    public virtual IReadOnlyDictionary<string, IReadOnlyList<string>> NoeudsRetenus => new Dictionary<string, IReadOnlyList<string>>();

    /// <summary>Interdits supplémentaires (codes d'action ou préfixes de nœuds), jamais levables.</summary>
    public virtual IReadOnlyList<string> Interdits => [];

    /// <summary>Clés retirées des réponses de tous les outils par garde-fou actif (garde-fou → clés JSON).</summary>
    public virtual IReadOnlyDictionary<string, IReadOnlyList<string>> ClesSensibles => new Dictionary<string, IReadOnlyList<string>>();

    /// <summary>Clés de contenu libre de toutes les réponses (balisées <c>contenu_non_fiable</c>).</summary>
    public virtual IReadOnlyList<string> ClesNonFiables => [];

    /// <summary>Dictionnaire des descriptions d'outils (module Personnalisation) ; null : la clé est rendue telle quelle.</summary>
    public virtual Dictionnaire? Textes => null;

    /// <summary>Texte d'une clé du dictionnaire (la clé elle-même si elle manque).</summary>
    public string Texte(string cle) => Textes?.Texte(cle, defaut: cle) ?? cle;

    /// <summary>Exécuteurs des propositions acceptées (lot 10 ; vide par défaut : aucune proposition possible).</summary>
    public virtual IReadOnlyList<ExecuteurProposition> Executeurs => [];

    /// <summary>Exécuteur d'une action proposée (null : inconnu).</summary>
    public ExecuteurProposition? Executeur(string action) => Executeurs.FirstOrDefault(x => x.Action == action);

    /// <summary>Adresse relative de l'écran d'une proposition (« /agents/propositions/12 »), rendue absolue à l'agent ; null : aucune.</summary>
    public virtual string? AdresseProposition(long id) => null;

    /// <summary>Outil du catalogue par son nom (null : inconnu).</summary>
    public OutilMcp? Outil(string nom) => Outils.FirstOrDefault(o => o.Nom == nom);
}
