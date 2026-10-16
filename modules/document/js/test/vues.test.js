import { describe, it, expect } from 'vitest';
import { fusionnerDisposition } from '../ui/vues.js';

// Disposition des colonnes réglée dans la grille (navigateur) appliquée à une vue de colonnes.
describe('Vues de colonnes : disposition du navigateur', () => {
  const vue = { colonnes: [{ cle: 'num' }, { cle: 'libelle', largeur: 300 }, { cle: 'qte' }, { cle: 'pv' }], debogage: true, systeme: ['lig_id'] };

  it('sans disposition, la vue est inchangée', () => {
    expect(fusionnerDisposition(vue, null)).toBe(vue);
    expect(fusionnerDisposition(null, undefined, ['num'])).toBe(null);
  });

  it('ordre et largeurs de la disposition, colonnes de la vue seulement, nouvelles colonnes à la suite', () => {
    const d = { colonnes: [{ cle: 'qte', largeur: 80 }, { cle: 'inconnue' }, { cle: 'num' }, { cle: 'libelle' }] };
    expect(fusionnerDisposition(vue, d)).toEqual({
      colonnes: [{ cle: 'qte', largeur: 80 }, { cle: 'num' }, { cle: 'libelle' }, { cle: 'pv' }], debogage: true, systeme: ['lig_id'],
    });
  });

  it('sans vue : toutes les colonnes du catalogue', () => {
    expect(fusionnerDisposition(null, { colonnes: [{ cle: 'pv', largeur: 90 }] }, ['num', 'pv', 'tva'])).toEqual({
      colonnes: [{ cle: 'pv', largeur: 90 }, { cle: 'num' }, { cle: 'tva' }], debogage: false, systeme: [],
    });
  });
});
