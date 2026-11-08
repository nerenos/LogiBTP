import { describe, it, expect } from 'vitest';
import { ligneRestaurant } from '../src/app/pages/restaurants.js';
import { lienItineraire } from '../src/app/terrain/terrain.js';
import { MENUS_METIER } from '../src/app/navigation/menus.js';

// Liste des restaurants (plan restaurants-suites, lot 5) : lien d'itinéraire par la fonction du terrain, pas de carte.
describe('liste des restaurants', () => {
  it('une adresse connue donne le lien d’itinéraire du terrain', () => {
    const html = ligneRestaurant({ nom: 'Chez Paul', adresse: '1 rue A, 75001, Paris', ville: 'Paris' }, 'GOOGLE');
    expect(html).toContain(lienItineraire('1 rue A, 75001, Paris', 'GOOGLE').replace(/&/g, '&amp;'));
    expect(html).toContain('Chez Paul');
  });
  it('sans adresse, aucun lien', () => {
    expect(ligneRestaurant({ nom: 'X', adresse: null, ville: null })).not.toContain('<a ');
  });
  it('l’entrée de menu Pointage est protégée par le droit du pointage', () => {
    const e = MENUS_METIER.find((m) => m.code === 'pointage').elements.find((x) => x.code === 'pointage-restaurants');
    expect(e.url).toBe('/pointage/restaurants');
    expect(e.droit).toBe('pointage');
  });
});
