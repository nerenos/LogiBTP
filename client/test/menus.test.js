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
  const mobile = { ...app(), acces: (n) => n === 'pointage', peutGererThemes: () => false, estAdmin: () => false };
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

describe('répartition des menus', () => {
  const complet = { ...app(), peutGererThemes: () => true, estAdmin: () => true };
  const elements = (a, code) => menus(a).find((m) => m.code === code).elements();
  it('garde le titre du séparateur qui suit des éléments masqués', () => {
    const e = [{ libelle: 'A' }, { separateur: true, libelle: 'X' }, { libelle: 'B', module: 'x' }, { separateur: true }, { libelle: 'C' }];
    expect(elementsVisibles(app(['x']), e)).toEqual([{ libelle: 'A' }, { separateur: true }, { libelle: 'C' }]);
  });
  it('propose les demandes d\'achat et d\'approvisionnement dans Achats et Exécution', () => {
    const achats = elements(complet, 'achats').map((e) => e.url);
    const execution = elements(complet, 'execution').map((e) => e.url);
    for (const url of ['/liste/ordres?vue=1107', '/liste/ordres?vue=1003']) {
      expect(achats).toContain(url);
      expect(execution).toContain(url);
    }
    expect(elements(app(['execution']), 'achats').map((e) => e.code)).not.toContain('achats-dac');
    expect(elements(complet, 'sous-traitance').map((e) => e.url)).toContain('/liste/ordres?vue=1106');
  });
  it('range le thème et les fiches dans des sous-menus, les paramètres des modules dans leur menu', () => {
    const p = elements(complet, 'parametres');
    expect(p.find((e) => e.libelle === "Thème d'affichage").sousMenu().length).toBeGreaterThan(1);
    expect(p.find((e) => e.libelle === 'Fiches').sousMenu().map((e) => e.libelle)).toContain('Fiche salarié : champs…');
    const urls = p.map((e) => e.url);
    for (const [menu, url] of [['pointage', '/parametres/pointage'], ['execution', '/parametres/execution'], ['planning', '/parametres/planning'], ['suivi', '/parametres/crm']]) {
      expect(urls).not.toContain(url);
      expect(elements(complet, menu).map((e) => e.url)).toContain(url);
    }
  });
  it('place Mon terrain en tête du menu Pointage, seul quand le Pointage est désactivé (I9, Q16)', () => {
    expect(menus(complet).map((m) => m.code)).not.toContain('terrain');
    const p = elements(complet, 'pointage');
    expect(p[0].url).toBe('/terrain');
    expect(p[1].separateur).toBe(true);
    expect(elements(app(['pointage']), 'pointage').map((e) => e.url)).toEqual(['/terrain']);
    expect(menus(app(['pointage', 'planning'])).map((m) => m.code)).not.toContain('pointage');
    const sansTerrain = { ...app(), acces: (n) => n !== 'terrain' };
    expect(elements(sansTerrain, 'pointage')[0].url).toBe('/pointage/saisie');
  });
  it('codes des raccourcis uniques', () => {
    const codes = catalogueRaccourcis().map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
