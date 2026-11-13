import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { texte, texteHtml, existe, icone } from '@logibtp/socle/dictionnaire';
import { GARDE_FOU, MODELE_PLAFOND, PORTEE_DROIT } from '@logibtp/socle';
import { CLASSE_OUTIL, STATUT_APPEL_AGENT, ETAT_PROPOSITION, ERREUR_MCP } from '../src/index.js';
import {
  delegationsHtml, secretHtml, journalHtml, propositionsHtml, propositionHtml, ecartsHtml, VUES_PROPOSITIONS,
  leveeDuProfil, controlerLevee, corpsLevee, modeles,
  formulaireDelegationHtml, consentementHtml, erreurConsentementHtml, ERREURS_CONSENTEMENT, clientsOAuthHtml,
} from '../ui/index.js';

const dossier = new URL('../ui/', import.meta.url);
const sources = readdirSync(dossier).filter((f) => f.endsWith('.js')).map((f) => [f, readFileSync(new URL(f, dossier), 'utf8')]);

describe('textes, icônes et conventions des écrans', () => {
  it('toute clé de texte statique existe dans le dictionnaire', () => {
    for (const [f, s] of sources) {
      for (const m of s.matchAll(/\b(?:texte|texteHtml)\('([a-z_.]+)'/g)) expect(existe(m[1]), `${f} : ${m[1]}`).toBe(true);
    }
  });
  it('toute icône utilisée existe', () => {
    for (const [f, s] of sources) {
      for (const m of s.matchAll(/iconeHtml\('([a-z_]+)'/g)) expect(icone(m[1]), `${f} : ${m[1]}`).not.toBe('');
    }
  });
  it('les textes composés par code existent pour chaque code', () => {
    for (const m of Object.values(MODELE_PLAFOND)) for (const p of ['modeles', 'modeles_aide']) expect(existe(`mcp.${p}.${m}`), m).toBe(true);
    for (const g of Object.values(GARDE_FOU)) for (const p of ['gardes_fous', 'gardes_fous_aide']) expect(existe(`mcp.${p}.${g}`), g).toBe(true);
    for (const p of Object.values(PORTEE_DROIT)) expect(existe(`mcp.portees.${p}`)).toBe(true);
    for (const c of Object.values(CLASSE_OUTIL)) expect(existe(`mcp.classes.${c}`)).toBe(true);
    for (const s of Object.values(STATUT_APPEL_AGENT)) expect(existe(`mcp.statuts.${s}`)).toBe(true);
    for (const e of Object.values(ETAT_PROPOSITION)) expect(existe(`mcp.etats.${e}`)).toBe(true);
    for (const v of Object.values(VUES_PROPOSITIONS)) expect(existe(`mcp.propositions.vues.${v}`)).toBe(true);
    for (const c of modeles.COLONNES_JOURNAL) expect(existe(`mcp.journal.colonnes.${c}`), c).toBe(true);
    for (const c of ['compte', 'agent', 'element', 'du', 'au']) expect(existe(`mcp.journal.filtres.${c}`)).toBe(true);
    for (const c of ['secret', 'url', 'commande', 'json']) expect(existe(`mcp.secret.${c}`)).toBe(true);
    for (const c of ['jours_max', 'quota_appel', 'quota_jour', 'alerte']) expect(existe(`mcp.parametres.${c}`)).toBe(true);
    for (const c of ['titre', 'titre_toutes']) expect(existe(`mcp.delegations.${c}`)).toBe(true);
    for (const c of ['titre', 'titre_tous']) expect(existe(`mcp.journal.${c}`)).toBe(true);
    for (const c of ['gardes_fous_aide', 'aucun_levable']) expect(existe(`mcp.creation.${c}`)).toBe(true);
  });
  it('aucune fenêtre, liste, touche ni code de modèle en dur', () => {
    for (const [f, s] of sources) {
      expect(s, f).not.toMatch(/\b(?:window\.)?(?:confirm|alert|prompt)\(/);
      expect(s, f).not.toMatch(/<select|createElement\('select'\)/);
      expect(s, f).not.toMatch(/e\.key\s*===/);
      expect(s, f).not.toMatch(/'(?:LECTURE|PREPARATION|COMME_MOI|SUR_MESURE|EN_ATTENTE|ACCEPTEE)'/);
      expect(s, f).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i);
    }
  });
});

describe('configuration du client et saisie d\'une délégation', () => {
  it('adresse /mcp de la société et configuration de Claude Code avec l\'en-tête Authorization', () => {
    expect(modeles.adresseMcp('https://demo.exemple.fr/')).toBe('https://demo.exemple.fr/mcp');
    const c = modeles.configurationClaudeCode({ origine: 'https://demo.exemple.fr', secret: 'lbtp_agent_x' });
    expect(c.url).toBe('https://demo.exemple.fr/mcp');
    expect(c.commande).toBe('claude mcp add --transport http logibtp https://demo.exemple.fr/mcp --header "Authorization: Bearer lbtp_agent_x"');
    expect(JSON.parse(c.json)).toEqual({ mcpServers: { logibtp: { type: 'http', url: 'https://demo.exemple.fr/mcp', headers: { Authorization: 'Bearer lbtp_agent_x' } } } });
  });
  it('choix de l\'écran : sur-mesure écarté, levables bornés aux garde-fous', () => {
    const c = modeles.choixEcran({ modeles: ['LECTURE', 'SUR_MESURE', 'PREPARATION'], gardes_fous: ['TIERS', 'VOLUME'], levables: ['TIERS', 'INCONNU'], echeance_defaut: 20, echeance_max: 20, portees: [] });
    expect(c.modeles).toEqual(['LECTURE', 'PREPARATION']);
    expect(c.levables).toEqual(['TIERS']);
    expect(c.echeance_max).toBe(20);
  });
  it('corps de création : jours entiers, levés uniques, textes vides en null', () => {
    expect(modeles.corpsDelegation({ libelle: '  ', modele: 'LECTURE', jours: '12', leves: ['TIERS', 'TIERS'], client: ' Claude Code ', portee: '' }))
      .toEqual({ libelle: null, modele: 'LECTURE', jours: 12, leves: ['TIERS'], client: 'Claude Code', portee: null });
    expect(modeles.corpsDelegation({ modele: 'LECTURE', jours: '' }).jours).toBeNull();
  });
  it('délégations : actives d\'abord, bouton de révocation seulement si actives et permis', () => {
    const liste = [
      { code: 'D1', compte: 'marie', libelle: 'Ancienne', modele: 'LECTURE', client: 'claude.ai', leves: [], echeance: '2026-10-01', cree_le: '2026-09-01', active: false, revoquee_le: '2026-09-15T10:00:00Z', revoquee_par: 'marie' },
      { code: 'D2', compte: 'marie', libelle: 'Devis', modele: 'PREPARATION', client: 'Claude Code', leves: ['TIERS'], echeance: '2026-12-13', cree_le: '2026-11-13', active: true },
    ];
    expect(modeles.trierDelegations(liste).map((d) => d.code)).toEqual(['D2', 'D1']);
    const html = delegationsHtml(liste, { peut: { revoquer: true } });
    expect(html.match(/data-revoquer=/g)).toHaveLength(1);
    expect(html).toContain('data-revoquer="D2"');
    expect(html).toContain(texte('mcp.gardes_fous.TIERS'));
    expect(html).not.toContain(texte('mcp.delegations.compte'));
    expect(delegationsHtml(liste, { toutes: true })).toContain(texte('mcp.delegations.compte'));
    expect(delegationsHtml([], {})).toContain(texte('mcp.delegations.aucune'));
  });
  it('fenêtre du secret : secret, adresse, commande et fichier, chacun copiable', () => {
    const c = modeles.configurationClaudeCode({ origine: 'https://demo.exemple.fr', secret: 'lbtp_agent_<x>' });
    const html = secretHtml(c, 'lbtp_agent_<x>');
    expect(html.match(/data-copier=/g)).toHaveLength(4);
    expect(html).toContain('lbtp_agent_&lt;x&gt;');
    expect(html).not.toContain('lbtp_agent_<x>');
  });
});

describe('paramétrage des levées par profil', () => {
  const parametres = { gardes_fous: ['TIERS', 'VOLUME'], modeles: ['LECTURE', 'PREPARATION'], profils: [{ profil: 'CHEF', levables: ['TIERS'], modeles: ['LECTURE'], jours_max: 30 }] };
  it('levée d\'un profil sans ligne : rien de levable, tous les modèles', () => {
    expect(leveeDuProfil(parametres, 'CHEF')).toMatchObject({ levables: ['TIERS'], modeles: ['LECTURE'], jours_max: 30 });
    expect(leveeDuProfil(parametres, 'COMPTA')).toMatchObject({ levables: [], modeles: null, jours_max: null });
  });
  it('contrôle comme le serveur : échéance 1..90, quotas positifs, alerte 1..100', () => {
    expect(controlerLevee({ jours_max: 90, quota_appel: 1, quota_jour: null, alerte: 100 })).toEqual([]);
    expect(controlerLevee({ jours_max: 91, quota_appel: 0, quota_jour: 2.5, alerte: 101 })).toEqual(['jours_max', 'quota_appel', 'quota_jour', 'alerte']);
  });
  it('corps : tous les modèles cochés = aucune restriction (null)', () => {
    expect(corpsLevee({ levables: [], modeles: ['PREPARATION', 'LECTURE'] }, ['LECTURE', 'PREPARATION']).modeles).toBeNull();
    expect(corpsLevee({ levables: [], modeles: ['LECTURE'] }, ['LECTURE', 'PREPARATION']).modeles).toEqual(['LECTURE']);
  });
});

describe('journal des agents', () => {
  const lignes = [
    { id: 3, date: '2026-11-13T09:00:00Z', compte: 'marie', client: 'Claude Code', delegation: 'DAA', outil: 'creer_devis', classe: 'BROUILLON', statut: 'SUCCES', ecrits: { type: 'document', identifiants: [42], nombre: 1, action: 'CREER' }, duree_ms: 120 },
    { id: 2, date: '2026-11-12T09:00:00Z', compte: 'paul', client: 'claude.ai', delegation: 'DBB', outil: 'rechercher', classe: 'LECTURE', statut: 'SUCCES', lus: { type: 'liste', identifiants: [7, 8], nombre: 2 }, nb_lus: 2, duree_ms: 30 },
    { id: 1, date: '2026-11-10T09:00:00Z', compte: 'marie', client: 'Claude Code', delegation: 'DAA', outil: 'valider_piece', classe: 'PROPOSITION', statut: 'REFUS', proposition: 5, humain: 'chef', erreur: 'ACCES_REFUSE' },
  ];
  it('filtres : compte, agent (client ou délégation), élément, période', () => {
    expect(modeles.filtrerJournal(lignes, { compte: 'mar' }).map((l) => l.id)).toEqual([3, 1]);
    expect(modeles.filtrerJournal(lignes, { agent: 'claude.ai' }).map((l) => l.id)).toEqual([2]);
    expect(modeles.filtrerJournal(lignes, { agent: 'dbb' }).map((l) => l.id)).toEqual([2]);
    expect(modeles.filtrerJournal(lignes, { element: '42' }).map((l) => l.id)).toEqual([3]);
    expect(modeles.filtrerJournal(lignes, { element: 'liste' }).map((l) => l.id)).toEqual([2]);
    expect(modeles.filtrerJournal(lignes, { du: '2026-11-11', au: '2026-11-12' }).map((l) => l.id)).toEqual([2]);
  });
  it('export CSV : en-têtes de l\'écran, éléments lisibles, guillemets doublés', () => {
    const csv = modeles.lignesCsvJournal([{ ...lignes[0], erreur: 'dit "non"' }], { date: 'Date' });
    expect(csv).toHaveLength(2);
    expect(csv[0].startsWith('"Date";"compte"')).toBe(true);
    expect(csv[1]).toContain('"document 42"');
    expect(csv[1]).toContain('"dit ""non"""');
  });
  it('tableau : proposition liée, décision de l\'humain, compte seulement pour l\'administrateur', () => {
    const html = journalHtml(lignes, { tous: true });
    expect(html).toContain('data-proposition="5"');
    expect(html).toContain(texte('mcp.journal.humain', { humain: 'chef' }));
    expect(html).toContain(texte('mcp.statuts.REFUS'));
    expect(journalHtml(lignes)).not.toContain(texte('mcp.journal.colonnes.compte'));
  });
});

describe('file des propositions', () => {
  const p = {
    id: 9, libelle: 'Valider le devis D-12', action: 'valider_piece', compte: 'marie', client: 'Claude Code', noeud: 'documents/V/V_DEVIS', droit: 'VALIDER',
    cible_type: 'document', cible_id: '42', contenu: { ent_version: 3, lignes: [{ id: 1, quantite: 2 }] }, avertissements: ['Marge faible', { code: 'X', message: 'Tiers provisoire' }],
    echeance: '2026-11-20', etat: 'EN_ATTENTE', cree_le: '2026-11-13T08:00:00Z',
  };
  it('contenu aplati et écarts avant / après d\'une correction', () => {
    expect(modeles.aplatir(p.contenu)).toEqual([{ chemin: 'ent_version', valeur: '3' }, { chemin: 'lignes[0].id', valeur: '1' }, { chemin: 'lignes[0].quantite', valeur: '2' }]);
    expect(modeles.ecartsContenu(p.contenu, { ent_version: 3, lignes: [{ id: 1, quantite: 5 }], note: 'x' }))
      .toEqual([{ chemin: 'lignes[0].quantite', avant: '2', apres: '5' }, { chemin: 'note', avant: null, apres: 'x' }]);
    expect(modeles.lireContenu('{"a":1}')).toEqual({ contenu: { a: 1 } });
    expect(modeles.lireContenu('[1]').erreur).toBe(true);
    expect(modeles.lireContenu('{').erreur).toBe(true);
    const html = ecartsHtml([{ chemin: 'note', avant: null, apres: '<b>' }]);
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain(texte('mcp.propositions.absent'));
  });
  it('détail : avertissements, cible, décisions seulement en attente et permises', () => {
    const html = propositionHtml(p, { peut: { decider: true }, jour: '2026-11-13', adresseCible: '/document/42' });
    expect(html).toContain('Marge faible');
    expect(html).toContain('Tiers provisoire');
    expect(html).toContain('href="/document/42"');
    expect(html.match(/data-decision=/g)).toHaveLength(3);
    expect(propositionHtml(p, { peut: { decider: false }, jour: '2026-11-13' })).not.toContain('data-decision');
    // Échue : état calculé par la règle du module, plus de décision.
    const echue = propositionHtml(p, { peut: { decider: true }, jour: '2026-11-20' });
    expect(echue).toContain(texte('mcp.etats.ECHUE'));
    expect(echue).not.toContain('data-decision');
    expect(propositionHtml({ ...p, etat: 'REFUSEE', motif: 'Prix faux' }, { peut: { decider: true }, jour: '2026-11-13' })).toContain('Prix faux');
  });
  it('liste : état affiché et nombre d\'avertissements', () => {
    const html = propositionsHtml([p], '2026-11-13');
    expect(html).toContain('data-ouvrir="9"');
    expect(html).toContain(texte('mcp.etats.EN_ATTENTE'));
    expect(html).toContain(texte('mcp.propositions.avertissements_n', { n: 2 }));
    expect(propositionsHtml([])).toContain(texte('mcp.propositions.aucune'));
  });
});

describe('consentement OAuth et liste blanche des clients (lot 12)', () => {
  const choix = modeles.choixEcran({ modeles: ['LECTURE', 'PREPARATION'], gardes_fous: ['TIERS', 'VOLUME'], levables: ['TIERS'], echeance_defaut: 30, echeance_max: 60, portees: [] });
  const demande = { demande: 'abc', client_id: 'https://claude.ai/oauth/mcp-oauth-client-metadata', client_nom: 'Claude <ai>', retour: 'https://claude.ai', expire_le: '2026-11-13T10:10:00Z' };
  it('écran : client, retour, champs de la délégation sans client saisi, garde-fous non levables grisés', () => {
    const html = consentementHtml(demande, choix);
    expect(html).toContain('Claude &lt;ai&gt;');
    expect(html).not.toContain('Claude <ai>');
    expect(html).toContain('https://claude.ai');
    expect(html).not.toContain('data-client');
    expect(html).toContain('data-autoriser');
    expect(html).toContain('data-refuser');
    expect(html).toMatch(/data-leve="TIERS" >/);
    expect(html).toMatch(/data-leve="VOLUME" disabled/);
    expect(html).toContain('max="60"');
    // Création depuis Mon compte : client saisissable.
    expect(formulaireDelegationHtml(choix, { client: 'Claude Code' })).toContain('data-client');
  });
  it('erreurs de la demande : message propre à chaque code, sinon générique', () => {
    for (const c of ERREURS_CONSENTEMENT) {
      expect(Object.values(ERREUR_MCP)).toContain(c);
      expect(erreurConsentementHtml(c)).toContain(texteHtml(`mcp.oauth.erreurs.${c}`));
    }
    expect(erreurConsentementHtml('AUTRE')).toContain(texteHtml('mcp.oauth.erreurs.autre'));
  });
  it('liste blanche : lignes, ligne d\'ajout, corps dédoublonné et rogné', () => {
    const html = clientsOAuthHtml([{ client_id: 'https://claude.ai/oauth/x', libelle: 'claude.ai', actif: false, modifie_le: '2026-11-13T10:00:00Z', modifie_par: 'admin' }]);
    expect(html).toContain('https://claude.ai/oauth/x');
    expect(html).not.toMatch(/data-actif checked/);
    expect(html).toContain('data-nouveau-client');
    expect(clientsOAuthHtml([])).toContain(texteHtml('mcp.clients.aucun'));
    expect(modeles.corpsClients([{ client_id: ' https://a/x ', libelle: ' A ', actif: true }, { client_id: 'https://a/x', libelle: 'B', actif: false }, { client_id: ' ' }]))
      .toEqual([{ client_id: 'https://a/x', libelle: 'B', actif: false }]);
  });
});
