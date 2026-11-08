import { describe, it, expect, vi, beforeEach } from 'vitest';

const appels = [];
let reponse = null;
vi.mock('@logibtp/liste/ui', () => ({ choisirDansListe: vi.fn(async (o) => { appels.push(o); return reponse; }) }));
vi.mock('../src/app/listes.js', () => ({ creerFournisseurListe: () => ({}) }));

const { choisirContactTiers } = await import('../src/app/annuaire/choix.js');
const { VUES_CHOIX } = await import('../src/app/vues-liste.js');

// Contact d'un intervenant (I1, lot 7) : liste des contacts limitée à ceux du tiers.
describe('choix en liste : contact d’un intervenant parmi les contacts de son tiers', () => {
  beforeEach(() => { appels.length = 0; reponse = null; });

  it('avec un tiers : seuls ses contacts sont acceptés, la recherche part du nom du tiers', async () => {
    await choisirContactTiers({ tiers: 'ACME', idsContacts: [3, 4] });
    expect(appels[0].vue).toBe(VUES_CHOIX.contacts);
    expect(appels[0].recherche).toBe('ACME');
    expect(appels[0].accepter({ _id: 3 })).toBeNull();
    expect(appels[0].accepter({ _id: 9 })).not.toBeNull();
  });

  it('sans tiers : aucun choix n’est ouvert', async () => {
    expect(await choisirContactTiers({ tiers: '', idsContacts: [3] })).toBeNull();
    expect(appels).toHaveLength(0);
  });

  it('le contact choisi est rendu avec son id ; Échap ou création rendent null', async () => {
    reponse = { _id: 4, nom_complet: 'Ana Roy' };
    expect((await choisirContactTiers({ tiers: 'ACME', idsContacts: [4] })).id).toBe(4);
    reponse = { creer: 'x' };
    expect(await choisirContactTiers({ tiers: 'ACME' })).toBeNull();
    reponse = null;
    expect(await choisirContactTiers({ tiers: 'ACME' })).toBeNull();
  });
});
