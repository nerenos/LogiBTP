using LogiBTP.Socle;

namespace LogiBTP.Mcp;

/// <summary>Proposition à contrôler : état enregistré et échéance (jour exclu).</summary>
public sealed record PropositionAControler(string? Etat, DateOnly? Echeance);

/// <summary>Décision saisie : ACCEPTER, CORRIGER ou REFUSER, motif, auteur agent ou en usurpation.</summary>
public sealed record DecisionSaisie(string? Decision, string? Motif = null, bool Agent = false, bool Usurpation = false);

/// <summary>
/// Règles de la file des propositions d'agents (plans/mcp.md, lot 10 ; ANALYSE-MODULE-MCP.md § 10.1), répliquées dans
/// modules/mcp/js/src/propositions.js (jeu partagé tests/cas/02_propositions.json). Un agent ne décide jamais d'une
/// proposition ; les droits de l'humain sur l'action proposée sont contrôlés à l'exécution.
/// </summary>
public static class ReglesPropositions
{
    /// <summary>Échéance d'une proposition par défaut (jours) et au plus.</summary>
    public const int EcheanceDefaut = 7;
    public const int EcheanceMax = 30;

    private static readonly string[] Decisions = [DecisionProposition.Accepter, DecisionProposition.Corriger, DecisionProposition.Refuser];

    /// <summary>Échéance d'une proposition déposée <paramref name="aujourdhui"/> : <paramref name="jours"/> borné de 1 à 30 (7 par défaut).</summary>
    public static DateOnly EcheanceProposition(DateOnly aujourdhui, int? jours = null) =>
        aujourdhui.AddDays(Math.Max(1, Math.Min(jours ?? EcheanceDefaut, EcheanceMax)));

    /// <summary>État affiché : une proposition en attente dont l'échéance (jour exclu) est atteinte est ECHUE.</summary>
    public static string? EtatProposition(string? etat, DateOnly? echeance, DateOnly aujourdhui) =>
        etat == Mcp.EtatProposition.EnAttente && echeance is { } e && aujourdhui >= e ? Mcp.EtatProposition.Echue : etat;

    /// <summary>Contrôle d'une décision : codes d'erreur (vide : permise), dans l'ordre du JS.</summary>
    public static IReadOnlyList<string> ControlerDecision(PropositionAControler proposition, DecisionSaisie d, DateOnly aujourdhui)
    {
        if (d.Agent) return [ErreursAgent.AgentInterdit];
        var erreurs = new List<string>();
        if (d.Usurpation) erreurs.Add(ErreurMcp.McpUsurpation);
        if (d.Decision is null || !Decisions.Contains(d.Decision)) erreurs.Add(ErreurMcp.McpParametreInvalide);
        var etat = EtatProposition(proposition.Etat, proposition.Echeance, aujourdhui);
        if (etat == Mcp.EtatProposition.Echue) erreurs.Add(ErreurMcp.McpPropositionEchue);
        else if (etat != Mcp.EtatProposition.EnAttente) erreurs.Add(ErreurMcp.McpPropositionClose);
        if (d.Decision == DecisionProposition.Refuser && string.IsNullOrWhiteSpace(d.Motif)) erreurs.Add(ErreurMcp.McpMotifRequis);
        return erreurs;
    }
}
