import { describe, it, expect } from 'vitest';
import { TL, controlesValidation } from '../src/calcul/index.js';

// Nature obligatoire sur les lignes de prix pour valider (réplique de SpecialisationBtp.ControlerValidation).
describe('Contrôles de validation BTP', () => {
  it('exige la nature des éléments, ouvrages et composantes, pas des autres lignes', () => {
    const lignes = [
      { lig_id: 1, lig_tyl_id: TL.SECTION }, { lig_id: 2, lig_tyl_id: TL.TITRE }, { lig_id: 3, lig_tyl_id: TL.TEXTE },
      { lig_id: 4, lig_tyl_id: TL.OUVRAGE, lig_nat_id: null }, { lig_id: 5, lig_tyl_id: TL.ELEMENT, lig_parent_id: 4 },
      { lig_id: 6, lig_tyl_id: TL.ELEMENT, lig_nat_id: 2 }, { lig_id: 7, lig_tyl_id: TL.ELEMENT, lig_is_ecart_arrondi: true },
      { lig_id: 8, lig_tyl_id: TL.SOUS_TOTAL }, { lig_id: 9, lig_tyl_id: TL.PIED_HT }, { lig_id: 10, lig_tyl_id: TL.TVA },
    ];
    expect(controlesValidation(lignes).map((e) => [e.lig_id, e.code])).toEqual([[4, 'NATURE_OBLIGATOIRE'], [5, 'NATURE_OBLIGATOIRE']]);
  });
});
