import { describe, it, expect } from 'vitest';
import { FicheBase } from '../ui/fiche.js';

// sections() ne touche pas au DOM : une instance nue suffit.
function sectionsDe(definition, specifiques = []) {
  const f = Object.create(FicheBase.prototype);
  f.definition = definition;
  f.ongletsSpecifiques = () => specifiques;
  return f.sections();
}

describe('titres courts des onglets de fiche', () => {
  const def = { champs: [{ code: 'nom', libelle: 'Nom', type: 'texte' }], supplementaires: [{ code: 'badge', libelle: 'Badge', type: 'texte' }] };

  it('onglets du programme : titre court du dictionnaire (personnalisable)', () => {
    const s = sectionsDe(def);
    expect(s.find((x) => x.code === 'general').court).toBe('Général');
    expect(s.find((x) => x.code === '+supplementaires').court).toBe('Compl.');
    expect(s.find((x) => x.code === '+pieces').court).toBe('Pièces');
  });

  it('onglet de la définition : son titre court est conservé ; sans titre court, aucun', () => {
    const s = sectionsDe({ ...def, sections: [{ code: 'a', titre: 'Coordonnées bancaires', court: 'Banque', champs: ['nom'] }, { code: 'b', titre: 'Divers', champs: [] }] });
    expect(s.find((x) => x.code === 'a').court).toBe('Banque');
    expect(s.find((x) => x.code === 'b').court).toBeUndefined();
  });

  it('onglet spécifique : titre court transmis', () => {
    const s = sectionsDe(def, [{ code: 'hist', titre: 'Historique des affectations', court: 'Historique' }, { code: 'x', titre: 'Autre' }]);
    expect(s.find((x) => x.code === '+hist').court).toBe('Historique');
    expect(s.find((x) => x.code === '+x').court).toBeUndefined();
  });
});
