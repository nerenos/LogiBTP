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
    // File des propositions (lot 10) : proposition déjà traitée, échue, refus sans motif, action sans exécuteur, contenu corrigé invalide.
    public const string McpPropositionClose = "MCP_PROPOSITION_CLOSE";
    public const string McpPropositionEchue = "MCP_PROPOSITION_ECHUE";
    public const string McpMotifRequis = "MCP_MOTIF_REQUIS";
    public const string McpExecuteurInconnu = "MCP_EXECUTEUR_INCONNU";
    public const string McpContenuInvalide = "MCP_CONTENU_INVALIDE";
    // Serveur d'autorisation OAuth 2.1 (lot 12) : demande inconnue, échue ou déjà décidée ; client hors liste blanche ou document
    // invalide ; adresse de retour absente du document du client ; code ou jeton de rafraîchissement rejoué (délégation révoquée).
    public const string McpOauthDemande = "MCP_OAUTH_DEMANDE";
    public const string McpOauthClient = "MCP_OAUTH_CLIENT";
    public const string McpOauthRedirection = "MCP_OAUTH_REDIRECTION";
    public const string McpOauthRejeu = "MCP_OAUTH_REJEU";
    // Recettes (lot 13).
    public const string McpRecetteCode = "MCP_RECETTE_CODE";
    public const string McpRecetteTexte = "MCP_RECETTE_TEXTE";
    public const string McpRecetteParametre = "MCP_RECETTE_PARAMETRE";
    public const string McpRecetteOutil = "MCP_RECETTE_OUTIL";
    public const string McpRecetteSortie = "MCP_RECETTE_SORTIE";
    public const string McpRecetteInconnue = "MCP_RECETTE_INCONNUE";
    public const string McpRecetteFournie = "MCP_RECETTE_FOURNIE";
}

/// <summary>Statut d'un appel d'outil au journal des agents (agent_journal.ajo_statut).</summary>
public static class StatutAppelAgent
{
    public const string Succes = "SUCCES";
    public const string Refus = "REFUS";
    public const string Quota = "QUOTA";
    public const string Erreur = "ERREUR";
}

/// <summary>État d'une proposition d'agent (mcp_proposition.mpr_etat) ; ECHUE : en attente au-delà de son échéance.</summary>
public static class EtatProposition
{
    public const string EnAttente = "EN_ATTENTE";
    public const string Acceptee = "ACCEPTEE";
    public const string Refusee = "REFUSEE";
    public const string Annulee = "ANNULEE";
    public const string Echue = "ECHUE";
}

/// <summary>Décision d'un humain sur une proposition : accepter (exécution sous son identité), corriger le contenu, refuser avec motif.</summary>
public static class DecisionProposition
{
    public const string Accepter = "ACCEPTER";
    public const string Corriger = "CORRIGER";
    public const string Refuser = "REFUSER";
}

/// <summary>Type d'un paramètre de recette (lot 13) : marché, chantier, pièce, période, texte.</summary>
public static class TypeParametreRecette
{
    public const string Marche = "MARCHE";
    public const string Chantier = "CHANTIER";
    public const string Document = "DOCUMENT";
    public const string Periode = "PERIODE";
    public const string Texte = "TEXTE";
}

/// <summary>Sortie attendue d'une recette : brouillon, proposition, rapport.</summary>
public static class SortieRecette
{
    public const string Brouillon = "BROUILLON";
    public const string Proposition = "PROPOSITION";
    public const string Rapport = "RAPPORT";
}
