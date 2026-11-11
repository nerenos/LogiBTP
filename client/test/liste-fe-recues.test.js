import { describe, it, expect } from 'vitest';
import { SOURCES_LISTE, THEMES_LISTE, VUES_LISTE } from '../src/app/vues-liste.js';
import { MENUS_METIER } from '../src/app/navigation/menus.js';
import { MODULE_FACULTATIF, TYPE_ELEMENT_FE } from '../src/app/codes.js';

// Factures électroniques reçues à traiter (plans/facturation-electronique.md, lot 12) : source db/296, thème et vue 1014,
// entrée de menu soumise au module et au droit du nœud « facture_electronique ».
describe('factures reçues à traiter', () => {
  const vue = VUES_LISTE.find((v) => v.vli_id === 1014);
  it('la vue par défaut ne montre que les factures à traiter, avec des colonnes de la source', () => {
    expect(vue.definition.theme).toBe('fe_recues');
    expect(vue.definition.filtres).toEqual([{ colonne: 'a_traiter', op: 'vrai' }]);
    const codes = SOURCES_LISTE.fe_recues.colonnes.map(([c]) => c);
    for (const c of vue.definition.colonnes) expect(codes).toContain(c.code);
    for (const s of vue.definition.segments) expect(codes).toContain(s.colonne);
    expect(THEMES_LISTE.some((t) => t.thl_code === 'fe_recues')).toBe(true);
  });
  it('une ligne sans pièce est un flux (code partagé avec le serveur)', () => {
    expect(TYPE_ELEMENT_FE.FLUX).toBe('fe_flux');
  });
  it('l’entrée de menu exige le module et le droit de la facturation électronique', () => {
    const element = MENUS_METIER.flatMap((m) => m.elements ?? []).find((e) => e.code === 'fe-recues');
    expect(element.url).toBe('/liste/fe_recues?vue=1014');
    expect(element.module).toBe(MODULE_FACULTATIF.FACTURE_ELECTRONIQUE);
    expect(element.droit).toBe('facture_electronique');
  });
});
