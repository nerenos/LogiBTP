// Règles de la file des propositions d'agents (plans/mcp.md, lot 10 ; ANALYSE-MODULE-MCP.md § 10.1), répliquées dans
// dotnet/LogiBTP.Mcp/ReglesPropositions.cs (jeu partagé tests/cas/02_propositions.json).
//
// Une proposition est une action préparée par un agent et non exécutée ; un humain l'accepte (exécution sous sa propre
// identité), la corrige ou la refuse avec un motif. Un agent ne décide jamais d'une proposition.
import { ERREUR_AGENT, ajouterJours } from '@logibtp/socle';
import { ERREUR_MCP, ETAT_PROPOSITION, DECISION_PROPOSITION } from './codes.js';

/** Échéance d'une proposition par défaut (jours) et au plus. */
export const ECHEANCE_PROPOSITION = 7;
export const ECHEANCE_PROPOSITION_MAX = 30;

/** Échéance d'une proposition déposée `aujourdhui` (« AAAA-MM-JJ ») : `jours` borné de 1 à ECHEANCE_PROPOSITION_MAX (7 par défaut). */
export function echeanceProposition(aujourdhui, jours = null) {
  const j = Math.max(1, Math.min(jours ?? ECHEANCE_PROPOSITION, ECHEANCE_PROPOSITION_MAX));
  return ajouterJours(aujourdhui, j);
}

/** État affiché : une proposition en attente dont l'échéance (jour exclu) est atteinte est ECHUE. */
export function etatProposition(etat, echeance, aujourdhui) {
  return etat === ETAT_PROPOSITION.EN_ATTENTE && echeance && aujourdhui >= echeance ? ETAT_PROPOSITION.ECHUE : etat;
}

/**
 * Contrôle d'une décision sur une proposition `{ etat, echeance }` : codes d'erreur (vide : permise). Agent : toujours
 * AGENT_INTERDIT (seul) ; usurpation : MCP_USURPATION ; décision inconnue : MCP_PARAMETRE_INVALIDE ; proposition échue :
 * MCP_PROPOSITION_ECHUE, déjà traitée : MCP_PROPOSITION_CLOSE ; refus sans motif : MCP_MOTIF_REQUIS. Les droits de
 * l'humain sur l'action proposée sont contrôlés à l'exécution (serveur).
 */
export function controlerDecision(proposition, { decision, motif = null, agent = false, usurpation = false } = {}, aujourdhui) {
  if (agent) return [ERREUR_AGENT.AGENT_INTERDIT];
  const erreurs = [];
  if (usurpation) erreurs.push(ERREUR_MCP.MCP_USURPATION);
  if (!Object.values(DECISION_PROPOSITION).includes(decision)) erreurs.push(ERREUR_MCP.MCP_PARAMETRE_INVALIDE);
  const etat = etatProposition(proposition?.etat, proposition?.echeance, aujourdhui);
  if (etat === ETAT_PROPOSITION.ECHUE) erreurs.push(ERREUR_MCP.MCP_PROPOSITION_ECHUE);
  else if (etat !== ETAT_PROPOSITION.EN_ATTENTE) erreurs.push(ERREUR_MCP.MCP_PROPOSITION_CLOSE);
  if (decision === DECISION_PROPOSITION.REFUSER && !(motif ?? '').trim()) erreurs.push(ERREUR_MCP.MCP_MOTIF_REQUIS);
  return erreurs;
}
