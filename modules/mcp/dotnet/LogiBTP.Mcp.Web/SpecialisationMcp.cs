using System.Text.Json;
using LogiBTP.Socle;

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

    /// <summary>Clé du tableau des éléments dans la réponse (null : la réponse elle-même si c'est un tableau, sinon un élément).</summary>
    public string? CleListe { get; init; }

    /// <summary>Type des éléments lus ou écrits, pour le journal (« document », « fiche/chantier »…).</summary>
    public string? TypeElement { get; init; }

    /// <summary>Clé de l'identifiant d'un élément de la réponse, pour le journal (« ent_id »…).</summary>
    public string? CleIdentifiant { get; init; }
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

    /// <summary>Outil du catalogue par son nom (null : inconnu).</summary>
    public OutilMcp? Outil(string nom) => Outils.FirstOrDefault(o => o.Nom == nom);
}
