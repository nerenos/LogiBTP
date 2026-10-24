import { describe, it, expect } from 'vitest';
import { elementsVisibles, menus, catalogueRaccourcis } from '../src/app/navigation/menus.js';

// Menus filtrés par les modules actifs de la société (db/193 : module_societe).
const app = (inactifs = []) => ({ moduleActif: (c) => !inactifs.includes(c), preferences: { get: () => 'auto' }, fenetres: { liste: () => [] } });

describe('menus et modules actifs', () => {
  it('retire les éléments d\'un module désactivé et les séparateurs orphelins', () => {
    const elements = [{ separateur: true }, { libelle: 'A' }, { separateur: true }, { libelle: 'B', module: 'x' }, { separateur: true }, { libelle: 'C', module: 'y' }];
    expect(elementsVisibles(app(['x', 'y']), elements)).toEqual([{ libelle: 'A' }]);
    expect(elementsVisibles(app(['x']), elements).map((e) => e.libelle ?? '—')).toEqual(['A', '—', 'C']);
  });

  it('masque les règlements quand le module est désactivé', () => {
    const ventes = (a) => menus(a).find((m) => m.code === 'ventes').elements().map((e) => e.code);
    expect(ventes(app())).toContain('reglements-clients');
    expect(ventes(app(['reglement']))).not.toContain('reglements-clients');
    expect(catalogueRaccourcis(app(['reglement'])).map((e) => e.code)).not.toContain('reglements-fournisseurs');
  });
});

describe('menus et droits du profil', () => {
  // Profil de saisie mobile : le pointage seulement (module Droits, accesSousArbre).
  const mobile = { ...app(), acces: (n) => n === 'pointage', peutGererThemes: () => false, estAdmin: () => false, enLigne: true };
  it('ne montre que les menus des nœuds accessibles', () => {
    const codes = menus(mobile).map((m) => m.code);
    expect(codes).toContain('pointage');
    expect(codes).not.toContain('ventes');
    expect(codes).not.toContain('stock');
    expect(codes).toContain('parametres');
  });
  it('masque la gestion des profils et des comptes', () => {
    const parametres = menus(mobile).find((m) => m.code === 'parametres').elements().map((e) => e.url);
    expect(parametres).not.toContain('/parametres/droits');
    expect(parametres).not.toContain('/parametres/comptes');
  });
});
