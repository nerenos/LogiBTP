// Module MCP, consentement OAuth (lot 12) : un client distant (connecteur claude.ai…) demande l'accès au nom de
// l'utilisateur connecté ; consentir = créer une délégation (modèle de plafond, échéance, garde-fous levables), puis le
// navigateur repart vers le client avec le code d'autorisation (ou le refus). Composant sans métier : l'application
// fournit les appels, la demande ou l'erreur lue dans l'adresse, et la redirection.
import { texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { formatDateHeure } from '@logibtp/socle/ui';
import { ERREUR_MCP } from '../src/codes.js';
import { choixEcran } from './modeles.js';
import { formulaireDelegationHtml, monterFormulaireDelegation } from './delegations.js';

/** Codes d'erreur de la demande dont l'écran a un message propre (`mcp.oauth.erreurs.<CODE>`) ; autres : message générique. */
export const ERREURS_CONSENTEMENT = Object.freeze([ERREUR_MCP.MCP_OAUTH_CLIENT, ERREUR_MCP.MCP_OAUTH_REDIRECTION, ERREUR_MCP.MCP_OAUTH_DEMANDE]);

/** Message d'une demande refusée avant tout retour au client (HTML). */
export function erreurConsentementHtml(code) {
  const cle = ERREURS_CONSENTEMENT.includes(code) ? `mcp.oauth.erreurs.${code}` : 'mcp.oauth.erreurs.autre';
  return `<p class="mcp-avertissement">${iconeHtml('mcp_avertissement')} ${texteHtml(cle)}</p><p class="aide">${texteHtml('mcp.oauth.erreurs.aide')}</p>`;
}

/**
 * Écran de consentement (HTML) : client demandeur, adresse de retour, échéance de la demande, champs de la délégation
 * (client imposé), boutons Autoriser et Refuser.
 */
export function consentementHtml(demande, choix) {
  return `<section class="mcp-consentement">
    <p class="mcp-client">${iconeHtml('mcp_client_oauth')} ${texteHtml('mcp.oauth.demande', { client: demande.client_nom })}</p>
    <p class="aide">${texteHtml('mcp.oauth.client_id', { client_id: demande.client_id })}</p>
    <p class="aide">${texteHtml('mcp.oauth.retour', { retour: demande.retour })}</p>
    <p class="aide">${texteHtml('mcp.oauth.expire', { date: formatDateHeure(demande.expire_le) })}</p>
    <p>${texteHtml('mcp.oauth.explication')}</p>
    <form data-formulaire class="mcp-formulaire">${formulaireDelegationHtml(choix, { client: null, libelle: demande.client_nom })}</form>
    <div class="barre-outils"><div class="groupe-outils">
      <button type="button" class="principal" data-autoriser>${iconeHtml('mcp_autoriser')} ${texteHtml('mcp.oauth.autoriser')}</button>
      <button type="button" data-refuser>${iconeHtml('mcp_refuser')} ${texteHtml('mcp.oauth.refuser')}</button>
    </div></div></section>`;
}

/**
 * Consentement OAuth. options : { demande (identifiant lu dans l'adresse), erreurDemande (code lu dans l'adresse), api: {
 * lire(demande), accepter(demande, corps), refuser(demande) } (promesses ; accepter et refuser rendent { redirection }),
 * rediriger(url) (navigation vers le client), erreur(e) }.
 */
export class ConsentementOAuth {
  #zone;
  #o;
  #formulaire = null;
  #occupe = false;

  constructor(zone, options = {}) {
    this.#zone = zone;
    this.#o = { api: {}, rediriger: (url) => globalThis.location?.assign(url), erreur: () => {}, ...options };
    this.#zone.addEventListener('click', (e) => this.#clic(e));
  }

  async charger() {
    if (this.#o.erreurDemande || !this.#o.demande) {
      this.#zone.innerHTML = erreurConsentementHtml(this.#o.erreurDemande ?? ERREUR_MCP.MCP_OAUTH_DEMANDE);
      return;
    }
    let demande;
    try {
      demande = await this.#o.api.lire(this.#o.demande);
    } catch (e) {
      this.#zone.innerHTML = erreurConsentementHtml(e?.code);
      return;
    }
    const choix = choixEcran(demande.choix);
    if (!choix.modeles.length) { this.#zone.innerHTML = `<p class="aide">${texteHtml('mcp.creation.aucun_modele')}</p>`; return; }
    this.#zone.innerHTML = consentementHtml(demande, choix);
    this.#formulaire = monterFormulaireDelegation(this.#zone.querySelector('[data-formulaire]'), choix);
  }

  #clic(e) {
    const b = e.target.closest('button');
    if (!b || this.#occupe) return;
    if (b.matches('[data-autoriser]')) this.#decider(() => this.#o.api.accepter(this.#o.demande, this.#formulaire.lire()));
    else if (b.matches('[data-refuser]')) this.#decider(() => this.#o.api.refuser(this.#o.demande));
  }

  async #decider(appel) {
    this.#occupe = true;
    try {
      const { redirection } = await appel();
      this.#zone.innerHTML = `<p class="aide">${texteHtml('mcp.oauth.retour_client')}</p>`;
      this.#o.rediriger(redirection);
    } catch (e) {
      this.#o.erreur(e);
      this.#occupe = false;
    }
  }
}
