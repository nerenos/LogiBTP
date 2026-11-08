import { describe, it, expect } from 'vitest';
import { SOURCES_LISTE, VUES_LISTE } from '../src/app/vues-liste.js';
import { MENUS_METIER } from '../src/app/navigation/menus.js';

// Liste des repas (plan restaurants-suites, lot 4) : vue filtrée par période, entrée de menu réservée au droit dédié.
describe('liste des repas', () => {
  const vue = VUES_LISTE.find((v) => v.vli_id === 1013);
  it('la vue par défaut filtre sur la période du mois et ne montre que des colonnes de la source', () => {
    expect(vue.definition.filtres).toEqual([{ colonne: 'date_repas', op: 'periode', valeur: 'mois_en_cours' }]);
    const codes = SOURCES_LISTE.repas.colonnes.map(([c]) => c);
    for (const c of vue.definition.colonnes) expect(codes).toContain(c.code);
  });
  it('l’entrée de menu exige le droit des repas', () => {
    const element = MENUS_METIER.find((m) => m.code === 'pointage').elements.find((e) => e.code === 'repas');
    expect(element.droit).toBe('pointage/repas');
    expect(element.url).toBe('/liste/repas?vue=1013');
  });
});
