import { describe, it, expect, vi } from 'vitest';

// Magasin IndexedDB remplacé par une table en mémoire (même interface : requêtes rendant { result }).
const table = new Map();
vi.mock('@logibtp/socle/ui', async (original) => ({
  ...(await original()),
  magasinIdb: () => async (_mode, f) => f({
    put: (e) => { table.set(e.cle, e); return { result: e.cle }; },
    get: (k) => ({ result: table.get(k) }),
    delete: (k) => { table.delete(k); return {}; },
    index: () => ({ getAll: (c) => ({ result: [...table.values()].filter((e) => e.compte === c) }) }),
  })?.result,
}));

const { ErreurApi } = await import('@logibtp/socle');
const { declarerOperation, ecrireOperation, envoyerOperations, lireOperation } = await import('../src/app/hors-ligne/operations.js');
const { etatNumero, ETAT_NUMERO } = await import('../src/app/terrain/terrain.js');
const { ERREUR_TERRAIN } = await import('../src/app/codes.js');
const { ETAT_ATTENTE } = await import('../src/app/hors-ligne/attente.js');
const { memoriserLimitePhotos, limitePhotos } = await import('../src/app/terrain/operations-terrain.js');

describe('hors ligne : ordre saisi par son numéro, résolu à l\'envoi (terrain-suites lot 10)', () => {
  it('numéro inconnu gardé « à vérifier », puis marqué refusé quand le serveur ne le connaît pas', async () => {
    const ligne = { id: null, tac_id: null, cha_id: null, ent_id: null, numero: 'OP-9999', minutes: 60, type_mo: 3 };
    declarerOperation('test-journee', { envoyer: async () => { throw new ErreurApi(422, ERREUR_TERRAIN.ORDRE_INCONNU, 'Ordre OP-9999 inconnu'); } });
    const gardee = await ecrireOperation({ compte: 'u', type: 'test-journee', id: '2026-11-09', corps: { date: '2026-11-09', lignes: [ligne] }, libelle: 'Journée' });
    expect(etatNumero(ligne, gardee)).toBe(ETAT_NUMERO.A_VERIFIER);

    const r = await envoyerOperations('u');
    expect(r.envoyees).toBe(0);
    expect(r.refusees[0]).toMatchObject({ etat: ETAT_ATTENTE.ERREUR, code: ERREUR_TERRAIN.ORDRE_INCONNU });
    const refusee = await lireOperation('u', 'test-journee', '2026-11-09');
    expect(refusee.corps.lignes[0].numero).toBe('OP-9999');
    expect(etatNumero(refusee.corps.lignes[0], refusee)).toBe(ETAT_NUMERO.REFUSE);
  });

  it('ordre choisi ou sans numéro : aucun état', () => {
    expect(etatNumero({ numero: 'OP-1', ent_id: 4 })).toBeNull();
    expect(etatNumero({ numero: null })).toBeNull();
    expect(etatNumero({ numero: 'OP-1', ent_id: null }, { etat: ETAT_ATTENTE.ERREUR, code: 'POI_VALIDE' })).toBe(ETAT_NUMERO.A_VERIFIER);
  });
});

describe('photos du terrain (terrain-suites lot 12)', () => {
  it('limite de dépôt des photos gardée sur l\'appareil (terrain-suites lot 12), sinon celle par défaut de la GED', () => {
    const stock = new Map();
    vi.stubGlobal('localStorage', { getItem: (k) => stock.get(k) ?? null, setItem: (k, v) => stock.set(k, String(v)) });
    expect(limitePhotos()).toBe(200 * 1024 * 1024);
    memoriserLimitePhotos(12 * 1024 * 1024);
    expect(limitePhotos()).toBe(12 * 1024 * 1024);
    memoriserLimitePhotos(null);
    expect(limitePhotos()).toBe(12 * 1024 * 1024);
    vi.unstubAllGlobals();
  });
});
