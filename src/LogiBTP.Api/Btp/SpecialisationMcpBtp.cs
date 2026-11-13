using LogiBTP.Mcp.Web;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Module MCP spécialisé par le cœur (plans/mcp.md) : lot 5, branchement seul (nœud de gestion « agents », aucun outil
/// métier). Lot 6 : catalogue des outils de lecture (<see cref="SpecialisationMcp.Outils"/>), nœuds retenus par garde-fou
/// (TIERS, SALARIES, PAIE, COUTS, CRM_NOTES…), clés sensibles et contenus libres du BTP, dictionnaire des descriptions.
/// </summary>
public sealed class SpecialisationMcpBtp : SpecialisationMcp
{
    /// <summary>Nœud de droits des routes /api/mcp (gestion des délégations de l'utilisateur).</summary>
    public const string NoeudAgents = "agents";

    public override string Noeud => NoeudAgents;
}
