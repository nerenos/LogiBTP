import { describe, it, expect, vi } from 'vitest';

vi.mock('@logibtp/liste/ui', () => ({ choisirDansListe: vi.fn() }));
vi.mock('../src/app/listes.js', () => ({ creerFournisseurListe: () => ({}) }));

const { FicheChantier } = await import('../src/app/fiches/fiche-structure.js');

// Lot 7 du plan ne-plus-utiliser-tva : la zone de déplacement du projet est recopiée dans le chantier ouvert depuis lui.
function ficheDepuis(projets, idProjet) {
  globalThis.location = { search: idProjet ? `?projet=${idProjet}` : '' };
  vi.spyOn(Object.getPrototypeOf(FicheChantier.prototype), 'valeursCreation').mockReturnValue({});
  const f = Object.create(FicheChantier.prototype);
  f.refs = { projets };
  f.definition = { champs: [] };
  return f;
}

describe('chantier ouvert depuis un projet : zone de déplacement', () => {
  it('projet à zone 3 : chantier créé en zone 3', () => {
    const v = ficheDepuis([{ id: 7, libelle: 'P', tiers_id: 1, ville: 'Lyon', zone: 3 }], 7).valeursCreation();
    expect(v.zone).toBe(3);
    expect(v.prj_id).toBe(7);
  });

  it('projet sans zone : chantier sans zone', () => {
    const v = ficheDepuis([{ id: 7, libelle: 'P', tiers_id: 1, ville: 'Lyon', zone: null }], 7).valeursCreation();
    expect(v.zone).toBeNull();
  });

  it('projet à zone 0 : zone 0 conservée', () => {
    const v = ficheDepuis([{ id: 7, libelle: 'P', zone: 0 }], 7).valeursCreation();
    expect(v.zone).toBe(0);
  });
});
