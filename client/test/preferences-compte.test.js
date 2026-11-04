import { describe, it, expect, vi, afterEach } from 'vitest';
import { preferencesCompte, DELAI_ENVOI } from '../src/app/preferences-compte.js';

const DEFAUTS = { raccourcis: ['a', 'b'], widgets: [] };

/** Serveur en mémoire : valeur par clé, appels tracés. */
function serveur(valeur = null, { panne = false } = {}) {
  const s = {
    valeur,
    envois: [],
    lire: vi.fn(async () => { if (panne) throw new Error('hors ligne'); return s.valeur; }),
    enregistrer: vi.fn(async (_, v) => { s.envois.push(structuredClone(v)); s.valeur = v; }),
  };
  return s;
}

function stockageLocal(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m };
}

afterEach(() => vi.useRealTimers());

describe('préférences du compte', () => {
  it('valeur du serveur, sinon défauts', async () => {
    const p = await preferencesCompte('accueil', DEFAUTS, { service: serveur({ raccourcis: ['x'] }) });
    expect(p.get('raccourcis')).toEqual(['x']);
    expect(p.get('widgets')).toEqual([]);
    const q = await preferencesCompte('accueil', DEFAUTS, { service: serveur() });
    expect(q.get('raccourcis')).toEqual(['a', 'b']);
  });

  it('changements rapprochés envoyés en une fois', async () => {
    vi.useFakeTimers();
    const s = serveur();
    const p = await preferencesCompte('accueil', DEFAUTS, { service: s });
    p.set('raccourcis', ['c']);
    p.set('raccourcis', ['c', 'd']);
    expect(s.enregistrer).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DELAI_ENVOI);
    expect(s.envois).toEqual([{ raccourcis: ['c', 'd'], widgets: [] }]);
  });

  it('reprise unique de la valeur du navigateur', async () => {
    const local = stockageLocal({ 'logibtp.accueil': JSON.stringify({ raccourcis: ['z'] }) });
    const s = serveur();
    const p = await preferencesCompte('accueil', DEFAUTS, { service: s, ancienneCle: 'logibtp.accueil', stockageLocal: local });
    expect(p.get('raccourcis')).toEqual(['z']);
    expect(s.envois).toEqual([{ raccourcis: ['z'], widgets: [] }]);
    expect(local.m.has('logibtp.accueil')).toBe(false);
  });

  it('valeur du serveur prioritaire sur celle du navigateur', async () => {
    const local = stockageLocal({ 'logibtp.accueil': JSON.stringify({ raccourcis: ['z'] }) });
    const s = serveur({ raccourcis: ['x'] });
    const p = await preferencesCompte('accueil', DEFAUTS, { service: s, ancienneCle: 'logibtp.accueil', stockageLocal: local });
    expect(p.get('raccourcis')).toEqual(['x']);
    expect(s.enregistrer).not.toHaveBeenCalled();
  });

  it('lecture impossible : défauts, changements gardés en mémoire sans envoi', async () => {
    vi.useFakeTimers();
    const s = serveur({ raccourcis: ['x'] }, { panne: true });
    const erreurs = [];
    const p = await preferencesCompte('accueil', DEFAUTS, { service: s, surErreur: (e) => erreurs.push(e.message) });
    expect(erreurs).toEqual(['hors ligne']);
    p.set('raccourcis', ['c']);
    await vi.advanceTimersByTimeAsync(DELAI_ENVOI);
    expect(p.get('raccourcis')).toEqual(['c']);
    expect(s.enregistrer).not.toHaveBeenCalled();
  });
});
