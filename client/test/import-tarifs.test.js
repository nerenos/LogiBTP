import { describe, it, expect } from 'vitest';
import { lireCsvTarifs, modeleCsvTarifs, COLONNES_TARIFS } from '../src/app/annuaire/import-tarifs.js';

// Lecture du CSV des tarifs fournisseurs (lot 8, A12) : format fixe, contrôles de forme avant l'envoi au serveur.
describe('import des tarifs : lecture du CSV', () => {
  it('lit le modèle (séparateur ;, virgule décimale, date française, principal)', () => {
    const r = lireCsvTarifs(modeleCsvTarifs());
    expect(r.erreurs).toEqual([]);
    expect(r.inconnues).toEqual([]);
    expect(r.lignes).toEqual([{
      rang: 1, element: 'HA10', reference: 'REF-123', code_barre: '3760001234567', libelle: 'Acier HA10 barre 12 m', unite: 't',
      prix_public: '1350.00', remise1: '20', remise2: '5', prix: null, delai: 7, debut: '2027-01-01', fin: null, principal: true,
    }]);
  });

  it('détecte la tabulation, ignore la casse et les accents des en-têtes, garde les guillemets', () => {
    const r = lireCsvTarifs('Référence\tPRIX\tLibellé\tCouleur\n"R-1"\t12.5\t"Vis ""tête"" fraisée"\tbleu\n\n');
    expect(r.inconnues).toEqual(['couleur']);
    expect(r.lignes).toEqual([{
      rang: 1, element: null, reference: 'R-1', code_barre: null, libelle: 'Vis "tête" fraisée', unite: null,
      prix_public: null, remise1: null, remise2: null, prix: '12.5', delai: null, debut: null, fin: null, principal: false,
    }]);
  });

  it('signale les lignes fautives avec leur rang', () => {
    const r = lireCsvTarifs('element;prix;debut;delai\nA1;abc;2027-13;2\nA2;;;\n;5;;\nA4;3;;1,5\n');
    expect(r.lignes).toEqual([]);
    expect(r.erreurs).toEqual([
      { rang: 1, message: 'prix illisible ; debut : date JJ/MM/AAAA ou AAAA-MM-JJ' },
      { rang: 2, message: 'prix public ou prix net obligatoire' },
      { rang: 3, message: 'élément, référence ou code-barres obligatoire' },
      { rang: 4, message: 'délai illisible' },
    ]);
  });

  it('refuse un en-tête sans colonne qui désigne l’élément', () => {
    expect(lireCsvTarifs('prix;unite\n3;u\n').erreurs).toEqual([{ rang: 0, message: 'En-tête : une colonne element, reference ou code_barre est obligatoire' }]);
    expect(COLONNES_TARIFS.map(([c]) => c)).toContain('prix_public');
  });
});

// Lot 6 (corrections novembre, B3) : l'onglet Tarifs du fournisseur n'a plus de bouton d'enregistrement par ligne.
describe('onglet Tarifs du fournisseur : enregistrement à la sortie de ligne', () => {
  it('une ligne existante n\'a que la suppression, la ligne vide son ajout, rien en lecture seule', async () => {
    const { actionsLigneTarif, tarifDepuisSaisie } = await import('@logibtp/bibliotheque/ui');
    expect(actionsLigneTarif({ id: 3 }, true)).toEqual(['supprimer']);
    expect(actionsLigneTarif({}, true)).toEqual(['enregistrer']);
    expect(actionsLigneTarif({ id: 3 }, false)).toEqual([]);
    expect(tarifDepuisSaisie({ id: 3 }, { prix: '12,5', prix_public: null, remise1: null, remise2: null, delai: null }).prix).toBe('12.5');
  });
  it('le source de l\'onglet n\'a plus de bouton data-enregistrer sur les lignes existantes', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/app/annuaire/tarifs-fournisseur.js', import.meta.url), 'utf8');
    expect(src).not.toContain('annuaire_btp.tarifs.enregistrer\'');
    expect(src).toContain('focusout');
  });
});
