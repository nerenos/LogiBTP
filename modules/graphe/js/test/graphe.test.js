import { describe, it, expect } from 'vitest';
import { parcourirEnLargeur, fusionnerGraphes, disposerGraphe, voisinage } from '../src/index.js';

// Graphe générique : parcours, fusion (développement d'un nœud), disposition en couches et en colonnes.
const n = (cle, ordre, autres = {}) => ({ cle, type: 'x', id: Number(cle.slice(1)), libelle: cle, ordre, ...autres });
const a = (cle, de, vers) => ({ cle, de, vers, type: 'lien', libelle: null, actif: true });

describe('Module Graphe', () => {
  it('parcourt en largeur jusqu\'à la profondeur demandée', () => {
    const v = { A: ['B', 'C'], B: ['D'], C: ['D'], D: ['E'], E: [] };
    expect([...parcourirEnLargeur('A', (k) => v[k], 2)]).toEqual([['A', 0], ['B', 1], ['C', 1], ['D', 2]]);
    expect(parcourirEnLargeur('A', (k) => v[k], 5).get('E')).toBe(3);
  });

  it('fusionne deux graphes par clé : nœud présent gardé, nouveau jamais départ, règles de la spécialisation', () => {
    const g1 = { noeuds: [n('N1', 0, { depart: true }), n('N2', 1)], aretes: [a('A1', 'N1', 'N2')] };
    const g2 = { noeuds: [n('N2', 1, { depart: true, libelle: 'autre' }), n('N3', 2, { depart: true })], aretes: [a('A1', 'N1', 'N2'), a('A2', 'N2', 'N3')] };
    const f = fusionnerGraphes(g1, g2, { apres: ({ aretes }) => aretes.delete('A1') });
    expect(f.noeuds.map((x) => [x.cle, !!x.depart, x.libelle])).toEqual([['N1', true, 'N1'], ['N2', false, 'N2'], ['N3', false, 'N3']]);
    expect(f.aretes.map((x) => x.cle)).toEqual(['A2']);
  });

  it('dispose en couches par ordre, sans chevauchement, les nœuds en colonne sous leur voisin', () => {
    const g = {
      noeuds: [n('H1', 0), n('M1', 1), n('M2', 1), n('B1', 2), n('C1', 9, { colonne: true }), n('C2', 9, { colonne: true })],
      aretes: [a('1', 'H1', 'M1'), a('2', 'H1', 'M2'), a('3', 'M2', 'B1'), a('4', 'M1', 'C1'), a('5', 'M1', 'C2')],
    };
    const { positions, couches } = disposerGraphe(g, { ecartX: 100, ecartY: 50, ecartContact: 20 });
    expect(couches.slice(0, 3)).toEqual([['H1'], ['M1', 'M2'], ['B1']]);
    expect(Math.abs(positions.get('M1').x - positions.get('M2').x)).toBeGreaterThanOrEqual(100);
    expect(positions.get('C1').y).toBe(150);
    expect(positions.get('C2').y).toBe(170);
    expect(positions.get('C1').x).toBe(positions.get('M1').x);
    expect([...voisinage(g, 'M1').noeuds].sort()).toEqual(['C1', 'C2', 'H1', 'M1']);
  });
});
