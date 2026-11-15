import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { texte } from '@logibtp/socle/dictionnaire';
import { originesAgent, creeeParAgent, mentionAgentHtml, pastillePieceHtml } from '../src/app/agents/origines.js';
import { adresseCible } from '../src/app/pages/agents.js';
import { peutDemanderAgent, etatDemandeAgent, TYPE_RECETTE_FICHE } from '../src/app/agents/demander.js';
import { menus } from '../src/app/navigation/menus.js';
import { ROUTES } from '../src/app/pages/index.js';
import { urlProposition, URL_AUTORISATION_AGENT } from '../src/app/codes.js';

// Module MCP, lot 11 du cœur : pastille 🤖 des pièces écrites par un agent, pages et menu des agents.
describe('origine des écritures d\'une pièce', () => {
  const h = (his_id, his_action, his_origine = null, his_client = null) => ({ his_id, his_action, his_utilisateur: 'marie', his_origine, his_delegation: his_origine ? 'DAA' : null, his_client });
  it('lignes écrites par un agent, par identifiant de l\'historique', () => {
    const m = originesAgent([h(1, 'CREATION', 'AGENT', 'Claude Code'), h(2, 'MODIFICATION')]);
    expect([...m.keys()]).toEqual([1]);
    expect(m.get(1)).toEqual({ client: 'Claude Code', delegation: 'DAA' });
    expect(mentionAgentHtml(m.get(1))).toContain(texte('agents_btp.origine.via', { client: 'Claude Code' }));
    expect(mentionAgentHtml(undefined)).toBe('');
  });
  it('pastille tant qu\'aucun humain n\'a écrit après la création par l\'agent', () => {
    expect(creeeParAgent([h(2, 'MODIFICATION', 'AGENT', 'c'), h(1, 'CREATION', 'AGENT', 'Claude Code')])).toEqual({ client: 'Claude Code', utilisateur: 'marie' });
    expect(creeeParAgent([h(1, 'CREATION', 'AGENT', 'c'), h(2, 'MODIFICATION')])).toBeNull();
    expect(creeeParAgent([h(1, 'CREATION'), h(2, 'MODIFICATION', 'AGENT', 'c')])).toBeNull();
    expect(creeeParAgent([])).toBeNull();
    expect(pastillePieceHtml(null)).toBe('');
    expect(pastillePieceHtml({ client: 'Claude Code', utilisateur: 'marie' })).toContain(texte('agents_btp.origine.piece', { client: 'Claude Code', utilisateur: 'marie' }));
  });
  it('affiche la mention dans l\'historique et la pastille dans l\'entête de la pièce', () => {
    const lire = (f) => readFileSync(new URL(`../src/app/${f}`, import.meta.url), 'utf8');
    expect(lire('documents/tracabilite.js')).toContain('mentionAgentHtml(agents.get(');
    expect(lire('pages/document.js')).toContain('pastillePieceHtml(creation)');
  });
});

describe('pages et menu des agents', () => {
  it('cible d\'une proposition : pièce ou fiche', () => {
    expect(adresseCible({ cible_type: 'document', cible_id: '42' })).toBe('/document/42');
    expect(adresseCible({ cible_type: 'fiche/personne', cible_id: '7' })).toBe('/fiche/personne/7');
    expect(adresseCible({ cible_type: 'autre', cible_id: '1' })).toBeNull();
    expect(adresseCible({})).toBeNull();
  });
  it('routes des pages, adresse d\'une proposition rendue par le serveur', () => {
    const chemins = ROUTES.map((r) => r.chemin);
    for (const c of ['/agents/propositions', '/agents/propositions/:id', '/agents/journal', '/parametres/agents', URL_AUTORISATION_AGENT]) expect(chemins).toContain(c);
    expect(urlProposition(5)).toBe('/agents/propositions/5');
  });
  const app = (actif, acces = () => true) => ({ moduleActif: (m) => (m === 'mcp' ? actif : true), typeActif: () => true, acces, preferences: { get: () => null }, fenetres: { liste: () => [], sessionPrecedente: () => null }, estAdmin: () => true, peutGererThemes: () => true, routeur: {} });
  it('menu Agents IA : seulement si le module est actif ; propositions sans le nœud « agents »', () => {
    expect(menus(app(false)).map((m) => m.code)).not.toContain('agents');
    const m = menus(app(true)).find((x) => x.code === 'agents');
    expect(m.elements().filter((e) => e.url).map((e) => e.url)).toEqual(['/agents/propositions', '/agents/journal', '/compte#agents', '/parametres/agents']);
    const sans = menus(app(true, (n) => n !== 'agents' && !n.startsWith('administration'))).find((x) => x.code === 'agents');
    expect(sans.elements().filter((e) => e.url).map((e) => e.url)).toEqual(['/agents/propositions']);
  });
});

describe('consentement OAuth (lot 12)', () => {
  it('page /agents/autoriser alignée sur AdressesApp.UrlAutorisationAgent du serveur', () => {
    expect(URL_AUTORISATION_AGENT).toBe('/agents/autoriser');
    const cs = readFileSync(new URL('../../src/LogiBTP.Domaine/Codes.cs', import.meta.url), 'utf8');
    expect(cs).toContain(`UrlAutorisationAgent = "${URL_AUTORISATION_AGENT}"`);
  });
  it('page de consentement : demande ou erreur lues dans l\'adresse, liste blanche montée au paramétrage', () => {
    const source = readFileSync(new URL('../src/app/pages/agents.js', import.meta.url), 'utf8');
    expect(source).toContain('new ConsentementOAuth(');
    expect(source).toContain('new ClientsOAuth(');
    expect(source).toContain('this.requete?.demande');
  });
});

describe('« Demander à l\'agent » (lot 13)', () => {
  const recettes = [
    { code: 'oe', active: true, parametres: [{ nom: 'marche', type: 'MARCHE' }] },
    { code: 'controle', active: true, parametres: [{ nom: 'devis', type: 'DOCUMENT' }] },
  ];
  it('bouton présent seulement si le module est actif et l\'utilisateur a une délégation ou le droit « agents »', () => {
    const base = { moduleActif: true, droitAgents: false, delegation: true, recettes, type: 'MARCHE' };
    expect(peutDemanderAgent(base)).toBe(true);
    expect(peutDemanderAgent({ ...base, delegation: false, droitAgents: true })).toBe(true);
    expect(peutDemanderAgent({ ...base, delegation: false })).toBe(false);
    expect(peutDemanderAgent({ ...base, moduleActif: false })).toBe(false);
    // Aucune recette pour le type de l'élément, ou recettes non lues (refus, module inactif côté serveur) : bouton masqué.
    expect(peutDemanderAgent({ ...base, type: 'CHANTIER' })).toBe(false);
    expect(peutDemanderAgent({ ...base, recettes: null })).toBe(false);
  });
  it('état lu une fois par minute, rien demandé au serveur si le module est inactif', async () => {
    const app = (actif, droit) => ({ moduleActif: () => actif, peut: () => droit });
    expect(await etatDemandeAgent(app(false, true), 'MARCHE')).toEqual({ visible: false, recettes: [] });
    expect(TYPE_RECETTE_FICHE).toEqual({ marche: 'MARCHE', chantier: 'CHANTIER' });
  });
  it('bouton monté sur les fiches marché et chantier et sur les pièces, sans action directe', () => {
    const lire = (f) => readFileSync(new URL(`../src/app/${f}`, import.meta.url), 'utf8');
    expect(lire('pages/fiche.js')).toContain('actionDemanderAgent(app, agent');
    expect(lire('pages/document.js')).toContain('data-action="agent"');
    expect(lire('pages/document.js')).toContain('demanderPourElement(this.app');
    expect(lire('pages/agents.js')).toContain('new GestionRecettes(');
    expect(lire('agents/demander.js')).not.toMatch(/api\.mcp\.(enregistrerRecette|supprimerRecette)|appel\('(POST|PUT|DELETE)/);
  });
});
