import { describe, it, expect } from 'vitest';
import {
  actionDe, combinaison, declarerRaccourcis, personnaliserRaccourci, reinitialiserRaccourcis, conflitsRaccourci, libelleRaccourci, catalogueRaccourcis,
} from '../src/ui/raccourcis.js';

const touche = (key, o = {}) => ({ key, code: o.code ?? '', ctrlKey: !!o.ctrl, altKey: !!o.alt, shiftKey: !!o.shift, metaKey: false });

describe('raccourcis personnalisables', () => {
  it('combinaison : chiffres de la rangée AZERTY avec Alt, symboles sans Maj', () => {
    expect(combinaison(touche('&', { alt: true, code: 'Digit1' }))).toBe('Alt+1');
    expect(combinaison(touche('+', { shift: true, code: 'Equal' }))).toBe('+');
    expect(combinaison(touche('Enter', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+Enter');
  });

  it('groupes, personnalisation, retour aux défauts et conflits', () => {
    declarerRaccourcis('essai', { libelle: 'Essai', actions: { valider: { libelle: 'Valider', defaut: 'Ctrl+K' }, autre: { libelle: 'Autre', defaut: [] } } });
    expect(actionDe(touche('k', { ctrl: true }), 'essai')).toBe('valider');
    expect(actionDe(touche('k', { ctrl: true }), 'grille')).toBeNull();
    personnaliserRaccourci('essai', 'valider', ['Alt+K']);
    expect(actionDe(touche('k', { ctrl: true }), 'essai')).toBeNull();
    expect(actionDe(touche('k', { alt: true }), 'essai')).toBe('valider');
    expect(catalogueRaccourcis().find((g) => g.groupe === 'essai').actions[0]).toMatchObject({ personnalise: true, touches: ['Alt+K'], defaut: ['Ctrl+K'] });
    // Même groupe : bloquant ; autre groupe (grille) : simple avertissement.
    expect(conflitsRaccourci('essai', 'Alt+K', 'autre')).toMatchObject([{ action: 'valider', bloquant: true }]);
    expect(conflitsRaccourci('essai', 'Ctrl+C')).toMatchObject([{ groupe: 'grille', action: 'copier', bloquant: false }]);
    personnaliserRaccourci('essai', 'valider', null);
    expect(libelleRaccourci('valider', 'essai')).toBe('Ctrl+K');
    personnaliserRaccourci('grille', 'insererAvant', []);
    expect(libelleRaccourci('insererAvant')).toBe('');
    reinitialiserRaccourcis();
    expect(libelleRaccourci('insererAvant')).toBe('Ctrl+Maj+Entrée');
  });
});
