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
const { memoriserLimitePhotos, limitePhotos, receptionGardee, envoyerOuGarder, OPERATION_TERRAIN, formulaireLevee, pvLeveeAttendu } = await import('../src/app/terrain/operations-terrain.js');
const { api } = await import('../src/app/api.js');

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

describe('réception gardée hors ligne (terrain-suites lot 13)', () => {
  const app = (perdue) => ({ apiPerdue: perdue, utilisateur: () => 'u', publier: () => {}, message: () => {} });
  const reception = { etat: 'SANS_RESERVE', reserves: [], nom: 'Client', signature: 'data:image/png;base64,x' };

  it('heure de signature de l\'appareil jointe à la réception gardée', async () => {
    const r = await envoyerOuGarder(app(true), { type: OPERATION_TERRAIN.RECEPTION, id: 7, corps: { ordre: 7, reception: receptionGardee(reception, new Date('2026-11-08T09:30:00Z')) }, libelle: 'PV' },
      () => { throw new Error('pas d\'envoi'); });
    expect(r.horsLigne).toBe(true);
    const gardee = await lireOperation('u', OPERATION_TERRAIN.RECEPTION, 7);
    expect(gardee.corps.reception).toMatchObject({ etat: 'SANS_RESERVE', signee_le: '2026-11-08T09:30:00.000Z' });
  });

  it('réception envoyée en ligne : heure du serveur seule', async () => {
    let envoyee;
    const r = await envoyerOuGarder(app(false), { type: OPERATION_TERRAIN.RECEPTION, id: 8, corps: { ordre: 8, reception: receptionGardee(reception) }, libelle: 'PV' },
      async () => { envoyee = reception; return { reception: { id: 1 } }; });
    expect(r.reponse).toBeTruthy();
    expect(envoyee.signee_le).toBeUndefined();
  });
});

describe('levée d\'une réserve gardée hors ligne (terrain-suites lot 15)', () => {
  it('levée gardée avec l\'heure de l\'appareil et sa photo, puis envoyée au retour du réseau', async () => {
    const app = { apiPerdue: true, utilisateur: () => 'levee', publier: () => {}, message: () => {} };
    const photo = new File(['x'], 'levee.jpg', { type: 'image/jpeg' });
    const levee = { ordre: 7, reserve: 31, commentaire: 'Joint refait', photos: { fichiers: [photo], commentaire: 'Joint refait' } };
    const r = await envoyerOuGarder(app, { type: OPERATION_TERRAIN.LEVEE_RESERVE, id: 31, corps: { ...levee, levee_le: '2026-11-08T09:30:00.000Z' }, libelle: 'Levée' },
      () => { throw new Error('pas d\'envoi'); });
    expect(r.horsLigne).toBe(true);
    expect(await lireOperation('levee', OPERATION_TERRAIN.LEVEE_RESERVE, 31)).toBeTruthy();

    const envoi = vi.spyOn(api.terrain, 'leverReserve').mockResolvedValue({ levee: true, ouvertes: 0, reserves: [] });
    const res = await envoyerOperations('levee');
    expect(res.envoyees).toBe(1);
    const [ordre, reserve, formulaire] = envoi.mock.calls[0];
    expect([ordre, reserve]).toEqual([7, 31]);
    expect(formulaire.get('commentaire')).toBe('Joint refait');
    expect(formulaire.get('levee_le')).toBe('2026-11-08T09:30:00.000Z');
    expect(formulaire.get('photo').name).toBe('levee.jpg');
    expect(await lireOperation('levee', OPERATION_TERRAIN.LEVEE_RESERVE, 31)).toBeUndefined();
    envoi.mockRestore();
  });

  it('levée en ligne : ni heure de l\'appareil ni photo si aucune choisie', () => {
    const f = formulaireLevee({ commentaire: null, photos: null });
    expect(f.get('levee_le')).toBeNull();
    expect(f.get('photo')).toBeNull();
  });
});

describe('PV de levée des réserves (terrain-suites lot 16)', () => {
  it('à signer quand le serveur l\'attend, ou quand chaque réserve est levée ou gardée levée sur l\'appareil', () => {
    expect(pvLeveeAttendu({ pv_levee_attendu: true, reserves: [] })).toBe(true);
    expect(pvLeveeAttendu({ reserves: [{ etat: 'LEVEE' }, { etat: 'OUVERTE', gardee: true }] })).toBe(true);
    expect(pvLeveeAttendu({ reserves: [{ etat: 'LEVEE' }, { etat: 'OUVERTE' }] })).toBe(false);
    expect(pvLeveeAttendu({ pv_levee_attendu: false, reserves: [{ etat: 'LEVEE', pv_levee: 3 }] })).toBe(false);
    expect(pvLeveeAttendu({ reserves: [] })).toBe(false);
  });
});

describe('intervention SAV créée hors ligne (terrain-suites lot 23)', () => {
  it('création et compte rendu gardés sur l\'appareil, puis envoyés dans l\'ordre, le compte rendu sur l\'ordre créé', async () => {
    const { interventionGardee, idSavLocal, appareilSav, nouvelAppareilSav, numeroProvisoireSav } = await import('../src/app/terrain/operations-terrain.js');
    const app = { apiPerdue: true, utilisateur: () => 'sav', publier: () => {}, message: () => {} };
    const appareil = nouvelAppareilSav();
    expect(appareilSav(idSavLocal(appareil))).toBe(appareil);
    expect(appareilSav('42')).toBeNull();
    const gardee = interventionGardee({ appareil, objet: 'Fuite', cha_id: 4, chantier: 'CH-4 Résidence' });
    expect(gardee.creation).toEqual({ appareil, cha_id: 4, objet: 'Fuite', nouveau: null });
    expect(gardee.affichage.ordre).toMatchObject({ id: null, numero: numeroProvisoireSav(appareil), chantier: 'CH-4 Résidence' });

    const appels = [];
    const creer = vi.spyOn(api.terrain, 'creerIntervention').mockImplementation(async (c) => { appels.push(['creer', c.appareil]); return { ent_id: 77, numero: 'SAV-0077' }; });
    const enregistrer = vi.spyOn(api.terrain, 'enregistrerSav').mockImplementation(async (ordre) => { appels.push(['compte_rendu', ordre]); return {}; });
    const r1 = await envoyerOuGarder(app, { type: OPERATION_TERRAIN.SAV_CREATION, id: appareil, corps: gardee, libelle: 'SAV' }, () => api.terrain.creerIntervention(gardee.creation));
    expect(r1.horsLigne).toBe(true);
    const compteRendu = { constat: 'Joint usé', travaux: 'Joint changé', fournitures: ['Joint'], terminee: true, absent: true };
    const r2 = await envoyerOuGarder(app, { type: OPERATION_TERRAIN.SAV, id: `${appareil}:1`, corps: { ordre: null, creation: gardee.creation, compteRendu, photos: null }, libelle: 'SAV' },
      () => api.terrain.enregistrerSav(null, compteRendu));
    expect(r2.horsLigne).toBe(true);
    expect(appels).toEqual([]);

    const r = await envoyerOperations('sav');
    expect(r).toMatchObject({ envoyees: 2, refusees: [] });
    // Création d'abord ; le compte rendu retrouve le même ordre par l'identifiant de l'appareil (création idempotente).
    expect(appels).toEqual([['creer', appareil], ['creer', appareil], ['compte_rendu', 77]]);
    expect(await lireOperation('sav', OPERATION_TERRAIN.SAV_CREATION, appareil)).toBeUndefined();
    creer.mockRestore();
    enregistrer.mockRestore();
  });
});
