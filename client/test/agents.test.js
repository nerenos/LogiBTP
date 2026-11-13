import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { texte } from '@logibtp/socle/dictionnaire';
import { originesAgent, creeeParAgent, mentionAgentHtml, pastillePieceHtml } from '../src/app/agents/origines.js';
import { adresseCible } from '../src/app/pages/agents.js';
import { menus } from '../src/app/navigation/menus.js';
import { ROUTES } from '../src/app/pages/index.js';
import { urlProposition } from '../src/app/codes.js';

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
    for (const c of ['/agents/propositions', '/agents/propositions/:id', '/agents/journal', '/parametres/agents']) expect(chemins).toContain(c);
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
