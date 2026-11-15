import { describe, it, expect } from 'vitest';
import {
  proposerColonne, lireValeursListe, ecrireValeursListe, controleDeErreur, demandeCreation, champsColonnes, champsColonnesLibres,
  codesSectionGenerale, sectionChampsColonnes, ONGLET_COLONNES, LONGUEUR_COLONNE, ERREUR_CHAMP_SUPPLEMENTAIRE, TYPE_CHAMP_SUPPLEMENTAIRE,
} from '../src/index.js';

const NOM = /^x_[a-z][a-z0-9_]{0,40}$/;

describe('nom technique proposé', () => {
  it('sans accent, minuscules, tirets bas, préfixe x_', () => {
    expect(proposerColonne('N° de Série (ancien) !')).toBe('x_n_de_serie_ancien');
    expect(proposerColonne('Été 2024')).toBe('x_ete_2024');
  });
  it('un chiffre en tête reçoit une lettre ; libellé vide : le préfixe seul', () => {
    expect(proposerColonne('3 pièces')).toBe('x_n_3_pieces');
    expect(NOM.test(proposerColonne('3 pièces'))).toBe(true);
    expect(proposerColonne('')).toBe('x_');
    expect(proposerColonne('!!!')).toBe('x_');
  });
  it('longueur bornée, sans tiret bas final, conforme au format du serveur', () => {
    const nom = proposerColonne('un libellé vraiment très long qui dépasse largement la longueur permise pour un nom de colonne');
    expect(nom.length).toBeLessThanOrEqual(LONGUEUR_COLONNE);
    expect(nom.endsWith('_')).toBe(false);
    expect(NOM.test(nom)).toBe(true);
  });
});

describe('valeurs d\'une liste', () => {
  it('une par ligne, libellé facultatif, lignes vides ignorées', () => {
    expect(lireValeursListe('A\n\n B | Bravo \r\nC|')).toEqual([{ valeur: 'A', libelle: 'A' }, { valeur: 'B', libelle: 'Bravo' }, { valeur: 'C', libelle: 'C' }]);
    expect(lireValeursListe(null)).toEqual([]);
  });
  it('aller-retour', () => {
    const v = [{ valeur: 'A', libelle: 'A' }, { valeur: 'B', libelle: 'Bravo' }];
    expect(ecrireValeursListe(v)).toBe('A\nB | Bravo');
    expect(lireValeursListe(ecrireValeursListe(v))).toEqual(v);
  });
});

describe('demande de création et erreurs', () => {
  it('valeurs seulement pour une liste, ordre entier', () => {
    expect(demandeCreation('materiel', { colonne: ' x_a ', type: TYPE_CHAMP_SUPPLEMENTAIRE.TEXTE, libelle: ' A ', ordre: '12', valeurs: 'X' }))
      .toEqual({ table: 'materiel', colonne: 'x_a', type: 'texte', libelle: 'A', ordre: 12, valeurs: null });
    expect(demandeCreation('materiel', { colonne: 'x_a', type: TYPE_CHAMP_SUPPLEMENTAIRE.LISTE, libelle: 'A', ordre: 'zz', valeurs: 'X | Y' }))
      .toMatchObject({ ordre: 0, valeurs: [{ valeur: 'X', libelle: 'Y' }] });
  });
  it('contrôle de l\'écran qui porte chaque erreur du serveur', () => {
    expect(controleDeErreur(ERREUR_CHAMP_SUPPLEMENTAIRE.TYPE_INVALIDE)).toBe('type');
    expect(controleDeErreur(ERREUR_CHAMP_SUPPLEMENTAIRE.LIBELLE_OBLIGATOIRE)).toBe('libelle');
    expect(controleDeErreur(ERREUR_CHAMP_SUPPLEMENTAIRE.VALEURS)).toBe('valeurs');
    for (const c of [ERREUR_CHAMP_SUPPLEMENTAIRE.NOM_INVALIDE, ERREUR_CHAMP_SUPPLEMENTAIRE.EXISTE, ERREUR_CHAMP_SUPPLEMENTAIRE.TABLE_FERMEE, 'AUTRE']) expect(controleDeErreur(c)).toBe('colonne');
  });
});

describe('affichage dans la fiche', () => {
  const champs = [
    { code: 'nom', libelle: 'Nom', type: 'texte' },
    { code: 'x_montant', libelle: 'Montant', type: 'nombre', format: '9999999999999999.99', colonne_supplementaire: true },
    { code: 'x_date', libelle: 'Date', type: 'date', colonne_supplementaire: true },
  ];
  it('définition sans sections : section générale sans les colonnes x_, onglet dédié avec elles', () => {
    const d = { champs };
    expect(codesSectionGenerale(d)).toEqual(['nom']);
    expect(champsColonnes(d).map((c) => c.code)).toEqual(['x_montant', 'x_date']);
    const s = sectionChampsColonnes(d, 'Champs supplémentaires', 'plein');
    expect(s).toMatchObject({ code: ONGLET_COLONNES, titre: 'Champs supplémentaires', champs: ['x_montant', 'x_date'] });
    expect(s.groupes).toEqual([{ titre: null, champs: ['x_montant', 'x_date'], largeur: 'plein' }]);
  });
  it('un champ x_ déjà placé par une section n\'est pas répété ; aucun champ x_ : pas d\'onglet', () => {
    const d = { champs, sections: [{ code: 'g', champs: ['nom', 'x_date'] }] };
    expect(champsColonnesLibres(d).map((c) => c.code)).toEqual(['x_montant']);
    expect(sectionChampsColonnes({ champs: [champs[0]] }, 't', 'plein')).toBeNull();
  });
});
