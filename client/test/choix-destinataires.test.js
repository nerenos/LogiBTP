import { describe, it, expect, vi, beforeEach } from 'vitest';

const appels = [];
let reponse = null;
vi.mock('@logibtp/liste/ui', () => ({ choisirDansListe: vi.fn(async (o) => { appels.push(o); return reponse; }) }));
vi.mock('../src/app/listes.js', () => ({ creerFournisseurListe: () => ({}) }));

const { choisirDestinataires, ajouterDestinataires } = await import('../src/app/annuaire/choix.js');

// Destinataires d'un courriel (I1, lot 8) : sélection multiple dans la liste des contacts.
describe('choix en liste : destinataires du courriel', () => {
  beforeEach(() => { appels.length = 0; reponse = null; });

  it('trois contacts choisis → trois destinataires, ajoutés à la zone sans doublon', async () => {
    reponse = [{ _id: 1, nom_complet: 'Ana A', email: 'a@x.fr' }, { _id: 2, nom_complet: 'Bob B', email: 'b@x.fr' }, { _id: 3, nom_complet: null, email: 'c@x.fr' }];
    const r = await choisirDestinataires();
    expect(appels[0].multiple).toBe(true);
    expect(r.map((d) => d.adresse)).toEqual(['a@x.fr', 'b@x.fr', 'c@x.fr']);
    expect(ajouterDestinataires('Ana A <a@x.fr>', r)).toBe('Ana A <a@x.fr>, Bob B <b@x.fr>, c@x.fr');
  });

  it('Échap : aucun destinataire, zone inchangée', async () => {
    reponse = null;
    expect(await choisirDestinataires()).toEqual([]);
    expect(ajouterDestinataires('x@y.fr', [])).toBe('x@y.fr');
  });

  it('un contact sans adresse est refusé', async () => {
    await choisirDestinataires({ exclure: [4] });
    expect(appels[0].accepter({ _id: 5, email: '' })).not.toBeNull();
    expect(appels[0].accepter({ _id: 5, email: 'a@b.fr' })).toBeNull();
    expect(appels[0].accepter({ _id: 4, email: 'a@b.fr' })).not.toBeNull();
  });
});
