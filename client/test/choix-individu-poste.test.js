import { describe, it, expect, vi, beforeEach } from 'vitest';

const appels = [];
let reponse = null;
vi.mock('@logibtp/liste/ui', () => ({ choisirDansListe: vi.fn(async (o) => { appels.push(o); return reponse; }) }));
vi.mock('../src/app/listes.js', () => ({ creerFournisseurListe: () => ({}) }));

const { choisirIndividuPoste, rolesPoste, POSTE } = await import('../src/app/annuaire/choix.js');
const { VUES_CHOIX } = await import('../src/app/vues-liste.js');

// Individus de notre société par poste (I1, lot 6) : vue « Notre société », filtre de rôle retirable, saisie directe.
describe('choix en liste : individus de notre société par poste', () => {
  beforeEach(() => { appels.length = 0; reponse = null; });

  it('le contexte conducteur ne propose que les individus de ce poste, dans la vue de la société', async () => {
    await choisirIndividuPoste({ poste: POSTE.CONDUCTEUR });
    expect(appels[0].vue).toBe(VUES_CHOIX.societe);
    expect(appels[0].filtres).toEqual({ roles: [POSTE.CONDUCTEUR] });
    expect(appels[0].libellesFiltres.roles).toContain('Conducteur');
  });

  it('chargé d’affaires filtré sur son rôle ; rédacteur sans filtre (tous les individus de la société)', async () => {
    await choisirIndividuPoste({ poste: POSTE.CHARGE_AFFAIRES });
    await choisirIndividuPoste({ poste: POSTE.REDACTEUR });
    expect(appels[0].filtres).toEqual({ roles: [POSTE.CHARGE_AFFAIRES] });
    expect(appels[1].filtres).toEqual({});
    expect(rolesPoste(POSTE.REDACTEUR)).toEqual([]);
  });

  it('le filtre est une pastille retirable : il est transmis au composant de choix, qui sait le retirer', async () => {
    await choisirIndividuPoste({ poste: POSTE.CONDUCTEUR });
    expect(Object.keys(appels[0].libellesFiltres)).toEqual(['roles']);
  });

  it('saisie directe : le texte saisi devient la recherche initiale, l’individu choisi est rendu avec son id', async () => {
    reponse = { _id: 7, nom_complet: 'Paul Martin' };
    const r = await choisirIndividuPoste({ poste: POSTE.CONDUCTEUR, recherche: 'mar' });
    expect(appels[0].recherche).toBe('mar');
    expect(r.id).toBe(7);
  });

  it('un individu déjà choisi est refusé, la création demandée rend null', async () => {
    await choisirIndividuPoste({ poste: POSTE.CONDUCTEUR, exclure: [7] });
    expect(appels[0].accepter({ _id: 7 })).not.toBeNull();
    expect(appels[0].accepter({ _id: 8 })).toBeNull();
    reponse = { creer: 'x' };
    expect(await choisirIndividuPoste({})).toBeNull();
  });
});
