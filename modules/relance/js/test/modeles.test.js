import { describe, it, expect } from 'vitest';
import { controlerRegle, regleParDefaut, NIVEAUX_MAX } from '../src/index.js';
import {
  modesAdmis, regrouperParTiers, selectionLot, basculerRelance, basculerGroupe, corpsValidation, nonRetenues, attentesNumero, lotOuvert,
  reglePourEdition, ajouterNiveau, retirerNiveau, modifierNiveau, definirRepetition, suspensionActive, controlerSuspension, corpsSuspension, somme,
} from '../ui/modeles.js';

const lot = {
  id: 7, date: '2026-11-08', etat: 'PREPARE',
  groupes: [
    { groupe: 1, tiers_id: 10, nature: 'FACTURE', mode: 'RECOMMANDE', niveau: 3, relances: [
      { id: 101, piece_id: 1, etat: 'PROPOSEE', niveau: 3, jours: 70, montant: '500.10' }, { id: 102, piece_id: 2, etat: 'PROPOSEE', niveau: 2, jours: 40, montant: 200.2 }] },
    { groupe: 2, tiers_id: 11, nature: 'DEVIS', mode: 'COURRIEL', niveau: 1, relances: [{ id: 103, piece_id: 3, etat: 'PROPOSEE', niveau: 1, jours: 16, montant: 1000 }] },
    { groupe: 3, tiers_id: 12, nature: 'FACTURE', mode: 'RECOMMANDE', niveau: 3, relances: [
      { id: 104, piece_id: 4, etat: 'ATTENTE_NUMERO', niveau: 3, jours: 61, montant: 300 }, { id: 105, piece_id: 5, etat: 'ATTENTE_NUMERO', niveau: 3, jours: 65, montant: '50.05' }] },
  ],
};

describe('liste de travail', () => {
  it('la tâche d\'appel n\'est proposée que pour un devis', () => {
    expect(modesAdmis('DEVIS')).toContain('TACHE');
    expect(modesAdmis('FACTURE')).not.toContain('TACHE');
  });
  it('regroupe les groupes par tiers avec un total décimal', () => {
    const t = regrouperParTiers([{ tiers_id: 1, tiers: 'A', montant: 0.1, groupes: 0 }, { tiers_id: 2, tiers: 'B', montant: 5 }, { tiers_id: 1, tiers: 'A', montant: 0.2 }]);
    expect(t.map((x) => [x.tiers_id, x.groupes.length, x.montant.toString()])).toEqual([[1, 2, '0.3'], [2, 1, '5']]);
    expect(somme(['0.1', 0.2]).toString()).toBe('0.3');
  });
  it('coche tout par défaut et laisse hors sélection les relances déjà envoyées', () => {
    const sel = selectionLot(lot);
    expect([...sel.get(1).retenues]).toEqual([101, 102]);
    expect(sel.get(1)).toMatchObject({ coche: true, mode: 'RECOMMANDE', commentaire: '' });
    expect(sel.get(3)).toMatchObject({ coche: false });
    expect(sel.get(3).retenues.size).toBe(0);
  });
  it('validation : groupes cochés seulement, mode changé, relances retenues', () => {
    const sel = selectionLot(lot);
    expect(corpsValidation(lot, sel)).toEqual({ groupes: [
      { groupe: 1, mode: null, commentaire: null, relances: null }, { groupe: 2, mode: null, commentaire: null, relances: null }] });
    basculerRelance(lot.groupes[0], sel.get(1), 102, false);
    sel.get(2).mode = 'COURRIER';
    sel.get(2).commentaire = ' Appel la veille ';
    expect(corpsValidation(lot, sel).groupes).toEqual([
      { groupe: 1, mode: null, commentaire: null, relances: [101] }, { groupe: 2, mode: 'COURRIER', commentaire: 'Appel la veille', relances: null }]);
    expect(nonRetenues(lot, sel)).toEqual([102]);
    basculerRelance(lot.groupes[0], sel.get(1), 101, false);
    expect(sel.get(1).coche).toBe(false);
    expect(corpsValidation(lot, sel).groupes.map((g) => g.groupe)).toEqual([2]);
    basculerGroupe(lot.groupes[0], sel.get(1), true);
    expect([...sel.get(1).retenues]).toEqual([101, 102]);
    expect(nonRetenues(lot, sel)).toEqual([]);
  });
  it('recommandés en attente de numéro, une lettre par groupe', () => {
    const a = attentesNumero([lot]);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ lot: 7, groupe: 3, tiers_id: 12 });
    expect(a[0].relances.map((r) => r.id)).toEqual([104, 105]);
    expect(a[0].montant.toString()).toBe('350.05');
    expect(lotOuvert(lot)).toBe(true);
    expect(lotOuvert({ etat: 'ENVOYE' })).toBe(false);
  });
});

describe('règle', () => {
  it('ajoute jusqu\'au maximum, retire et renumérote, reste valable', () => {
    let r = reglePourEdition(undefined, 'FACTURE');
    expect(r).toEqual(regleParDefaut('FACTURE'));
    r = ajouterNiveau(ajouterNiveau(r));
    expect(r.niveaux.map((n) => [n.rang, n.delai])).toEqual([[1, 15], [2, 30], [3, 60], [4, 75], [5, 90]]);
    expect(ajouterNiveau(r).niveaux).toHaveLength(NIVEAUX_MAX);
    expect(controlerRegle(r, 'FACTURE')).toEqual([]);
    const moins = retirerNiveau(r, 2);
    expect(moins.niveaux.map((n) => [n.rang, n.delai])).toEqual([[1, 15], [2, 60], [3, 75], [4, 90]]);
    expect(r.niveaux).toHaveLength(5);
  });
  it('un délai illisible ou non croissant est refusé par le contrôle partagé', () => {
    let r = modifierNiveau(regleParDefaut('DEVIS'), 2, 'delai', '10');
    expect(controlerRegle(r, 'DEVIS')).toEqual(['RELANCE_NIVEAU_DELAI']);
    r = modifierNiveau(r, 2, 'delai', '');
    expect(r.niveaux[1].delai).toBeNull();
    expect(controlerRegle(r, 'DEVIS')).toEqual(['RELANCE_NIVEAU_DELAI']);
  });
  it('mode, modèles et répétition', () => {
    let r = modifierNiveau(regleParDefaut('FACTURE'), 1, 'mode', 'TACHE');
    expect(controlerRegle(r, 'FACTURE')).toEqual(['RELANCE_NIVEAU_MODE']);
    r = modifierNiveau(r, 1, 'mode', 'COURRIER');
    r = modifierNiveau(r, 1, 'modele_courriel', '12');
    expect(r.niveaux[0]).toMatchObject({ mode: 'COURRIER', modele_courriel: 12 });
    expect(modifierNiveau(r, 1, 'modele_courriel', '').niveaux[0].modele_courriel).toBeNull();
    r = definirRepetition(r, true, '');
    expect(controlerRegle(r, 'FACTURE')).toEqual(['RELANCE_REGLE_INTERVALLE']);
    r = definirRepetition(r, true, '30');
    expect(r).toMatchObject({ repeter: true, intervalle: 30 });
    expect(definirRepetition(r, false, 30)).toMatchObject({ repeter: false, intervalle: null });
  });
});

describe('suspensions', () => {
  it('active jusqu\'à la date comprise', () => {
    expect(suspensionActive({ jusqu_au: '2026-11-08' }, '2026-11-08')).toBe(true);
    expect(suspensionActive({ jusqu_au: '2026-11-07' }, '2026-11-08')).toBe(false);
  });
  it('une seule cible, un motif, une date', () => {
    expect(controlerSuspension({ piece_id: 1, tiers_id: 2, motif: 'LITIGE', jusqu_au: '2026-12-01' })).toEqual(['cible']);
    expect(controlerSuspension({ motif: '', jusqu_au: '' })).toEqual(['cible', 'motif', 'jusqu_au']);
    expect(controlerSuspension({ tiers_id: 2, motif: 'LITIGE', jusqu_au: '2026-12-01' })).toEqual([]);
    expect(corpsSuspension({ piece_id: '5', tiers_id: null, motif: 'PROMESSE', jusqu_au: '2026-12-01', commentaire: '  ' }))
      .toEqual({ piece_id: 5, tiers_id: null, jusqu_au: '2026-12-01', motif: 'PROMESSE', commentaire: null });
  });
});
