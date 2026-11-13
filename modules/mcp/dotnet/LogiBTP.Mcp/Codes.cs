namespace LogiBTP.Mcp;

// Codes du module MCP, répliqués dans modules/mcp/js/src/codes.js (parité vérifiée par CodesTests).
// Les codes communs aux modules (GardeFou, ModelePlafond, OrigineEcriture, ErreursAgent) sont dans le socle.

/// <summary>Classement d'un outil d'agent : lecture, écriture directe d'un brouillon, proposition à un humain, interdit.</summary>
public static class ClasseOutil
{
    public const string Lecture = "LECTURE";
    public const string Brouillon = "BROUILLON";
    public const string Proposition = "PROPOSITION";
    public const string Interdit = "INTERDIT";
}

/// <summary>Erreurs du contrôle d'une délégation et des quotas.</summary>
public static class ErreurMcp
{
    public const string McpModeleInconnu = "MCP_MODELE_INCONNU";
    public const string McpModeleNonPermis = "MCP_MODELE_NON_PERMIS";
    public const string McpAdminCommeMoi = "MCP_ADMIN_COMME_MOI";
    public const string McpEcheance = "MCP_ECHEANCE";
    public const string McpGardeFouNonLevable = "MCP_GARDE_FOU_NON_LEVABLE";
    public const string McpQuotaJour = "MCP_QUOTA_JOUR";
    // Point /mcp, outils et gestion (lot 5).
    public const string McpJetonRequis = "MCP_JETON_REQUIS";
    public const string McpDelegationInconnue = "MCP_DELEGATION_INCONNUE";
    public const string McpOutilInconnu = "MCP_OUTIL_INCONNU";
    public const string McpOutilInterdit = "MCP_OUTIL_INTERDIT";
    public const string McpOutilParametre = "MCP_OUTIL_PARAMETRE";
    public const string McpUsurpation = "MCP_USURPATION";
    public const string McpParametreInvalide = "MCP_PARAMETRE_INVALIDE";
    // Module désactivé pour la société (lot 6) : point /mcp refusé, jetons délégués sans plafond.
    public const string McpModuleInactif = "MCP_MODULE_INACTIF";
    // Outil composé (lot 7) : appel d'une route que l'outil n'a pas déclarée (liste blanche exacte de l'outil).
    public const string McpRouteNonDeclaree = "MCP_ROUTE_NON_DECLAREE";
}

/// <summary>Statut d'un appel d'outil au journal des agents (agent_journal.ajo_statut).</summary>
public static class StatutAppelAgent
{
    public const string Succes = "SUCCES";
    public const string Refus = "REFUS";
    public const string Quota = "QUOTA";
    public const string Erreur = "ERREUR";
}
