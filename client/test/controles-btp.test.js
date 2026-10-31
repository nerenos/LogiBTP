import { describe, it, expect } from 'vitest';
import { TL, controlesValidation, controlesSaisie, CONTROLE_SAISIE } from '../src/calcul/index.js';

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

// Avertissements de saisie du panneau des notifications (jamais bloquants).
describe('Contrôles de saisie BTP', () => {
  const ligne = (id, valeurs = {}) => ({
    lig_id: id, lig_parent_id: null, lig_tyl_id: TL.ELEMENT, lig_unt_code: 'U', lig_qte: '1', lig_pa: '10', lig_pv: '12',
    lig_coef_fg: '1.1', lig_coef_benef: '1.1', ...valeurs,
  });
  const codes = (r) => r.map((e) => [e.lig_id, e.code]);

  it('signale unité manquante, coefficients < 1, PA et PV à 0, quantité à 0', () => {
    const lignes = [
      ligne(1), ligne(2, { lig_unt_code: null }), ligne(3, { lig_coef_fg: '0.95' }), ligne(4, { lig_coef_benef: '0.8' }),
      ligne(5, { lig_pa: '0', lig_pv: '0' }), ligne(6, { lig_pa: '0' }), ligne(7, { lig_qte: '0' }),
    ];
    expect(codes(controlesSaisie(lignes))).toEqual([
      [2, CONTROLE_SAISIE.UNITE_MANQUANTE], [3, CONTROLE_SAISIE.COEF_FG_INFERIEUR], [4, CONTROLE_SAISIE.COEF_BENEF_INFERIEUR],
      [5, CONTROLE_SAISIE.PRIX_NUL], [7, CONTROLE_SAISIE.QTE_NULLE],
    ]);
    expect(controlesSaisie(lignes).every((e) => e.gravite === 'avertissement')).toBe(true);
  });

  it('écarte les lignes hors prix, pour mémoire, frais annexes et écart d\'arrondi', () => {
    const lignes = [
      { lig_id: 1, lig_tyl_id: TL.TITRE }, { lig_id: 2, lig_tyl_id: TL.TEXTE },
      ligne(3, { lig_unt_code: null, lig_type_prix: 'M' }), ligne(4, { lig_unt_code: null, lig_type_prix: 'F' }),
      ligne(5, { lig_unt_code: null, lig_is_ecart_arrondi: true }), ligne(6, { lig_unt_code: null, lig_type_prix: 'O' }),
    ];
    expect(codes(controlesSaisie(lignes))).toEqual([[6, CONTROLE_SAISIE.UNITE_MANQUANTE]]);
  });

  it('coefficients : ventes seulement, ouvrage composé seulement en mode D ; composantes contrôlées', () => {
    const lignes = [ligne(1, { lig_tyl_id: TL.OUVRAGE, lig_coef_fg: '0.9' }), ligne(2, { lig_parent_id: 1, lig_coef_benef: '0.9' })];
    expect(codes(controlesSaisie(lignes))).toEqual([[2, CONTROLE_SAISIE.COEF_BENEF_INFERIEUR]]);
    expect(codes(controlesSaisie(lignes, { modeOuvrage: 'D' }))).toEqual([[1, CONTROLE_SAISIE.COEF_FG_INFERIEUR], [2, CONTROLE_SAISIE.COEF_BENEF_INFERIEUR]]);
    expect(controlesSaisie(lignes, { famille: 'A' })).toEqual([]);
  });

  it('quantités à 0 non signalées dans un document transformé', () => {
    expect(controlesSaisie([ligne(1, { lig_qte: '0' })], { qteNulle: false })).toEqual([]);
  });

  it('achats : ligne d\'un autre chantier que l\'entête signalée', () => {
    const lignes = [ligne(1, { lig_cha_id: 5 }), ligne(2, { lig_cha_id: 7 }), ligne(3)];
    expect(codes(controlesSaisie(lignes, { famille: 'A', achat: true, chantier: 5 }))).toEqual([[2, CONTROLE_SAISIE.CHANTIER_LIGNE]]);
    expect(controlesSaisie(lignes, { famille: 'A', achat: true, chantier: null })).toEqual([]);
    expect(controlesSaisie(lignes, { chantier: 5 })).toEqual([]);
  });
});
