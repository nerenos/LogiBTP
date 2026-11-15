// Bouton « 🤖 Demander à l'agent » (module MCP, lot 13 ; ANALYSE-MODULE-MCP.md § 10.4) sur les fiches marché et chantier
// et sur les pièces : choix d'une recette du type de l'élément, prompt prérempli avec son identifiant, copié dans le
// presse-papiers (aucun client n'a d'adresse de nouvelle conversation préremplie documentée : copie seule). Jamais
// d'action directe : l'agent agit ensuite sous sa délégation.
import { ACTION_DROIT } from '@logibtp/socle';
import { texte, icone } from '@logibtp/socle/dictionnaire';
import { TYPE_PARAMETRE_RECETTE } from '@logibtp/mcp';
import { demanderAgent, modeles } from '@logibtp/mcp/ui';
import { MODULE_FACULTATIF, TYPE_FICHE } from '../codes.js';
import { api } from '../api.js';

/** Nœud de droits des écrans des agents (SpecialisationMcpBtp.NoeudAgents). */
const NOEUD_AGENTS = 'agents';

/** Type de paramètre de recette d'une fiche (marché, chantier) ; pièce : DOCUMENT. */
export const TYPE_RECETTE_FICHE = Object.freeze({ [TYPE_FICHE.MARCHE]: TYPE_PARAMETRE_RECETTE.MARCHE, [TYPE_FICHE.CHANTIER]: TYPE_PARAMETRE_RECETTE.CHANTIER });

/** Durée de conservation des recettes lues (ms) : un bouton par fiche ou pièce ouverte, sans requête à chaque fois. */
export const DUREE_CACHE = 60_000;

/**
 * Bouton visible : module MCP actif pour la société, utilisateur qui a une délégation active ou le droit « agents », et
 * au moins une recette active pour le type de l'élément (`recettes` nul : non encore lues, le bouton reste masqué).
 */
export function peutDemanderAgent({ moduleActif, droitAgents, delegation, recettes, type }) {
  return Boolean(moduleActif && (droitAgents || delegation) && recettes && modeles.recettesPourType(recettes, type).length);
}

let cache = null;

/** Oublie les recettes lues (après leur modification par l'administrateur). */
export function oublierRecettes() { cache = null; }

/** Recettes actives et délégation active de l'utilisateur, lues au plus une fois par minute (null : module inactif ou refus). */
export function lireRecettes(app, maintenant = Date.now()) {
  if (app.moduleActif?.(MODULE_FACULTATIF.MCP) === false) return Promise.resolve(null);
  if (!cache || maintenant - cache.quand > DUREE_CACHE) cache = { quand: maintenant, lues: api.mcp.recettes().catch(() => null) };
  return cache.lues;
}

/** État du bouton pour un élément de type `type` (TYPE_PARAMETRE_RECETTE) : { visible, recettes }. */
export async function etatDemandeAgent(app, type) {
  const moduleActif = app.moduleActif?.(MODULE_FACULTATIF.MCP) !== false;
  const lues = moduleActif ? await lireRecettes(app) : null;
  const recettes = lues?.recettes ?? null;
  const visible = peutDemanderAgent({
    moduleActif, droitAgents: app.peut?.(NOEUD_AGENTS, ACTION_DROIT.CONSULTER) === true, delegation: Boolean(lues?.delegation), recettes, type,
  });
  return { visible, recettes: recettes ?? [] };
}

/** Fenêtre « Demander à l'agent » pour un élément : identifiant en référence, libellé affiché. */
export function demanderPourElement(app, { recettes, type, id, libelle }) {
  return demanderAgent({
    recettes, type, reference: String(id ?? ''), element: libelle || String(id ?? ''),
    message: (t) => app.message(t, 'succes'), erreur: (e) => app.erreur(e),
  });
}

/** Action d'hôte d'une fiche (marché, chantier) : bouton 🤖 de la barre de la fiche. */
export function actionDemanderAgent(app, etat, { type, fiche }) {
  return {
    icone: icone('mcp_agent'), libelle: texte('mcp.demande.bouton'), titre: texte('mcp.demande.bouton_aide'), visible: etat.visible,
    action: () => demanderPourElement(app, {
      recettes: etat.recettes, type, id: fiche()?.id, libelle: [fiche()?.valeur?.('code'), fiche()?.valeur?.('libelle')].filter(Boolean).join(' '),
    }),
  };
}
