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
}
