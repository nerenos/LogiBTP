// Format commun des refus d'écriture : erreurs par champ d'un 422 VALIDATION (Controles côté serveur).
import { describe, expect, it } from 'vitest';
import { ErreurApi, erreursParChamp, ERREUR_ENREGISTREMENT, TYPE_ECRITURE } from '../src/calcul/index.js';

describe('erreursParChamp', () => {
  it('sépare le rang d\'une ligne de table et garde le message du serveur', () => {
    const e = new ErreurApi(422, ERREUR_ENREGISTREMENT.VALIDATION, 'Code obligatoire (+1)', [
      { champ: 'libelle', code: ERREUR_ENREGISTREMENT.OBLIGATOIRE, message: 'Libellé obligatoire' },
      { champ: '2.code', code: ERREUR_ENREGISTREMENT.DOUBLON, message: 'Code « A » en double' },
    ]);
    expect(erreursParChamp(e)).toEqual([
      { champ: 'libelle', rang: null, code: 'OBLIGATOIRE', message: 'Libellé obligatoire' },
      { champ: 'code', rang: 2, code: 'DOUBLON', message: 'Code « A » en double' },
    ]);
  });

  it('ignore les détails sans champ et les autres erreurs', () => {
    expect(erreursParChamp(new ErreurApi(409, ERREUR_ENREGISTREMENT.DOUBLON, 'Valeur déjà utilisée'))).toEqual([]);
    expect(erreursParChamp(new ErreurApi(422, 'VALIDATION', 'x', [{ ligne: 3, message: 'm' }]))).toEqual([]);
    expect(erreursParChamp(new Error('x'))).toEqual([]);
  });

  it('expose les types d\'écriture', () => {
    expect(Object.keys(TYPE_ECRITURE)).toContain('LOT');
  });
});
