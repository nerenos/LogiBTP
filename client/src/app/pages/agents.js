import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { ACTION_DROIT } from '@logibtp/socle';
import {
  PanneauDelegations, ParametresAgents, JournalAgents, FilePropositions, DetailProposition, ConsentementOAuth, ClientsOAuth, GestionRecettes,
} from '@logibtp/mcp/ui';
import { oublierRecettes } from '../agents/demander.js';
import { MODULE_FACULTATIF, CIBLE_PROPOSITION, URL_AUTORISATION_AGENT, urlProposition, urlDocument, urlFiche } from '../codes.js';
import { api } from '../api.js';

// Module MCP, lot 11 du cœur (plans/mcp.md) : pages qui montent les écrans du module (délégations, levées par profil,
// journal, file des propositions) ; la section « Agents » de Mon compte (`/compte#agents`) monte les délégations par
// `monterDelegations`. La page fournit les appels de l'API, l'origine de la société et la navigation.

/** Nœud de droits des routes /api/mcp (SpecialisationMcpBtp.NoeudAgents). */
export const NOEUD_AGENTS = 'agents';

/** Écrans des agents ouverts : module actif pour la société ; sinon message de la page. */
const moduleActif = (app) => app.moduleActif?.(MODULE_FACULTATIF.MCP) !== false;

const inactif = () => `<p class="aide">${texteHtml('agents_btp.module_inactif')}</p>`;

/** Gabarit commun des pages : titre et zone du composant. */
const gabarit = (cleIcone, cleTitre, aide = '') => `<div class="page-parametres page-agents"><div class="entete-page"><h1 class="page-titre">${iconeHtml(cleIcone)} ${texteHtml(cleTitre)}</h1></div>
  ${aide ? `<p class="aide">${texteHtml(aide)}</p>` : ''}<section data-zone></section></div>`;

/**
 * Délégations dans une zone (Mon compte › Agents : les miennes, création et révocation ; paramétrage : toutes, pour
 * l'administrateur). Rend le panneau monté.
 */
export function monterDelegations(app, zone, { toutes = false } = {}) {
  const panneau = new PanneauDelegations(zone, {
    toutes,
    origine: globalThis.location?.origin ?? '',
    peut: { creer: app.peut?.(NOEUD_AGENTS, ACTION_DROIT.CREER) !== false, revoquer: true },
    api: {
      liste: () => api.mcp.delegations(toutes),
      choix: () => api.mcp.choix(),
      creer: (d) => api.mcp.creerDelegation(d),
      revoquer: (code) => api.mcp.revoquer(code),
    },
    message: (m) => app.message(m, 'succes'),
    erreur: (e) => app.erreur(e),
  });
  panneau.charger();
  return panneau;
}

/** Adresse dans l'application de la cible d'une proposition (document ou fiche), sinon null. */
export function adresseCible(p) {
  if (!p?.cible_type || !p.cible_id) return null;
  if (p.cible_type === CIBLE_PROPOSITION.DOCUMENT) return urlDocument(p.cible_id);
  if (p.cible_type.startsWith(CIBLE_PROPOSITION.PREFIXE_FICHE)) return urlFiche(p.cible_type.slice(CIBLE_PROPOSITION.PREFIXE_FICHE.length), p.cible_id);
  return null;
}

/** Paramétrage des agents (administrateur) : levées par profil, toutes les délégations. */
export class PageParametresAgents extends PageBase {
  icone = icone('agents_btp_parametres');

  urlCourante() { return '/parametres/agents'; }

  async ouvrir() {
    const app = this.app;
    this.titre = texte('agents_btp.routes.parametres');
    this.conteneur.innerHTML = `<div class="page-parametres page-agents"><div class="entete-page"><h1 class="page-titre">${iconeHtml('agents_btp_parametres')} ${texteHtml('agents_btp.routes.parametres')}</h1></div>
      <p class="aide">${texteHtml('agents_btp.parametres.aide')}</p><section data-levees></section><section data-clients></section><section data-recettes></section><section data-delegations></section></div>`;
    if (!moduleActif(app)) { this.conteneur.querySelector('[data-levees]').innerHTML = inactif(); return; }
    if (!app.estAdmin()) { this.conteneur.querySelector('[data-levees]').innerHTML = `<p class="aide">${texteHtml('agents_btp.parametres.admin')}</p>`; return; }
    let profils = [];
    try { profils = (await api.droits.profils()).map((p) => ({ code: p.code, libelle: p.libelle })); } catch { /* profils des levées déjà enregistrées seulement */ }
    this.levees = new ParametresAgents(this.conteneur.querySelector('[data-levees]'), {
      profils,
      api: { parametres: () => api.mcp.parametres(), enregistrer: (profil, l) => api.mcp.enregistrerLevee(profil, l) },
      apresEcriture: () => app.message(texte('agents_btp.parametres.enregistre'), 'succes'),
      erreur: (e) => app.erreur(e),
    });
    await this.levees.charger();
    // Clients OAuth autorisés (lot 12) : liste blanche de la société, claude.ai et Claude Code pré-renseignés.
    this.clients = new ClientsOAuth(this.conteneur.querySelector('[data-clients]'), {
      api: { liste: () => api.mcp.clientsOAuth(), enregistrer: (l) => api.mcp.enregistrerClientsOAuth(l) },
      apresEcriture: () => app.message(texte('mcp.clients.enregistre'), 'succes'),
      erreur: (e) => app.erreur(e),
    });
    await this.clients.charger();
    // Recettes des agents (lot 13) : fournies par l'application et propres à l'entreprise, gérées par l'administrateur.
    this.recettes = new GestionRecettes(this.conteneur.querySelector('[data-recettes]'), {
      api: { liste: () => api.mcp.recettes(true), enregistrer: (code, r) => api.mcp.enregistrerRecette(code, r), supprimer: (code) => api.mcp.supprimerRecette(code) },
      apresEcriture: () => { oublierRecettes(); app.message(texte('mcp.recettes.enregistree'), 'succes'); },
      erreur: (e) => app.erreur(e),
    });
    await this.recettes.charger();
    this.delegations = monterDelegations(app, this.conteneur.querySelector('[data-delegations]'), { toutes: true });
  }
}

/** Journal des agents : le mien ; tout le journal pour l'administrateur. */
export class PageJournalAgents extends PageBase {
  icone = icone('agents_btp_journal');

  urlCourante() { return '/agents/journal'; }

  async ouvrir() {
    const app = this.app;
    this.titre = texte('agents_btp.routes.journal');
    this.conteneur.innerHTML = gabarit('agents_btp_journal', 'agents_btp.routes.journal', 'agents_btp.journal.aide');
    const zone = this.conteneur.querySelector('[data-zone]');
    if (!moduleActif(app)) { zone.innerHTML = inactif(); return; }
    this.journal = new JournalAgents(zone, {
      tous: app.estAdmin(),
      api: { journal: (f) => api.mcp.journal(f) },
      ouvrirProposition: (id, e) => app.naviguer(urlProposition(id), { nouvelleFenetre: Boolean(e?.ctrlKey || e?.shiftKey) }),
      erreur: (e) => app.erreur(e),
    });
    await this.journal.charger();
  }
}

/** File des propositions des agents : à valider, de mes agents, toutes (administrateur). */
export class PagePropositionsAgents extends PageBase {
  icone = icone('agents_btp_propositions');

  urlCourante() { return '/agents/propositions'; }

  async ouvrir() {
    const app = this.app;
    this.titre = texte('agents_btp.routes.propositions');
    this.conteneur.innerHTML = gabarit('agents_btp_propositions', 'agents_btp.routes.propositions', 'agents_btp.propositions.aide');
    const zone = this.conteneur.querySelector('[data-zone]');
    if (!moduleActif(app)) { zone.innerHTML = inactif(); return; }
    this.file = new FilePropositions(zone, {
      admin: app.estAdmin(),
      api: { liste: (f) => api.mcp.propositions(f) },
      ouvrir: (id, e) => app.naviguer(urlProposition(id), { nouvelleFenetre: Boolean(e?.ctrlKey || e?.shiftKey) }),
      erreur: (e) => app.erreur(e),
    });
    await this.file.charger();
  }
}

/** Proposition d'un agent (`/agents/propositions/:id`, adresse rendue à l'agent et à la notification) : détail et décisions. */
export class PagePropositionAgent extends PageBase {
  icone = icone('agents_btp_propositions');

  urlCourante() { return urlProposition(this.params.id); }

  async ouvrir() {
    const app = this.app;
    this.titre = texte('agents_btp.routes.proposition', { id: this.params.id });
    this.conteneur.innerHTML = `<div class="page-parametres page-agents"><div class="entete-page"><h1 class="page-titre">${iconeHtml('agents_btp_propositions')} ${texteHtml('agents_btp.routes.proposition', { id: this.params.id })}</h1>
      <div class="barre-outils"><div class="groupe-outils"><button type="button" data-file>${iconeHtml('agents_btp_propositions')} ${texteHtml('agents_btp.propositions.file')}</button></div></div></div>
      <section data-zone></section></div>`;
    this.conteneur.querySelector('[data-file]').addEventListener('click', () => app.naviguer('/agents/propositions'));
    const zone = this.conteneur.querySelector('[data-zone]');
    if (!moduleActif(app)) { zone.innerHTML = inactif(); return; }
    this.detail = new DetailProposition(zone, {
      id: this.params.id,
      // Décision contrôlée par le serveur (droit exigé, état) ; l'écran la propose à tout humain qui voit la proposition.
      peut: { decider: true },
      api: {
        lire: (id) => api.mcp.proposition(id),
        accepter: (id) => api.mcp.accepter(id),
        refuser: (id, motif) => api.mcp.refuser(id, motif),
        corriger: (id, contenu) => api.mcp.corriger(id, contenu),
      },
      adresseCible,
      naviguer: (url, e) => app.naviguer(url, { nouvelleFenetre: Boolean(e?.ctrlKey || e?.shiftKey) }),
      message: (m) => app.message(m, 'succes'),
      erreur: (e) => app.erreur(e),
    });
    await this.detail.charger();
  }
}

/**
 * Consentement OAuth d'un client distant (`/agents/autoriser?demande=…`, ou `?erreur=CODE`), lot 12 : page ouverte par la
 * demande d'autorisation du serveur ; la session de l'application est exigée (connexion puis retour ici). Autoriser crée
 * la délégation et renvoie le navigateur vers le client avec le code.
 */
export class PageAutorisationAgent extends PageBase {
  icone = icone('agents_btp_autoriser');

  urlCourante() {
    const p = new URLSearchParams(Object.entries({ demande: this.requete?.demande, erreur: this.requete?.erreur }).filter(([, v]) => v));
    return p.size ? `${URL_AUTORISATION_AGENT}?${p}` : URL_AUTORISATION_AGENT;
  }

  async ouvrir() {
    const app = this.app;
    this.titre = texte('agents_btp.routes.autoriser');
    this.conteneur.innerHTML = gabarit('agents_btp_autoriser', 'agents_btp.routes.autoriser');
    const zone = this.conteneur.querySelector('[data-zone]');
    if (!moduleActif(app)) { zone.innerHTML = inactif(); return; }
    this.consentement = new ConsentementOAuth(zone, {
      demande: this.requete?.demande ?? null,
      erreurDemande: this.requete?.erreur ?? null,
      api: {
        lire: (d) => api.mcp.demandeOAuth(d),
        accepter: (d, corps) => api.mcp.accepterOAuth(d, corps),
        refuser: (d) => api.mcp.refuserOAuth(d),
      },
      rediriger: (url) => globalThis.location.assign(url),
      erreur: (e) => app.erreur(e),
    });
    await this.consentement.charger();
  }
}
