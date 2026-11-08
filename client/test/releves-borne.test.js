import { describe, it, expect } from 'vitest';
import { lignesCompteurs, materielsProposes, corpsReleve, lireValeur } from '../src/app/pointage/releves-borne.js';

// Relevés de compteurs à la borne (plan materiel-suites, lot 4, MO2).
describe('borne : relevés de compteurs', () => {
  const donnees = {
    affectes: [{ id: 1, code: 'PEL-01', designation: 'Pelle', compteurs: 'H_KM', heures: 1200, kilometres: 8000 }],
    autres: [{ id: 2, code: 'CAM-02', designation: 'Camion benne', compteurs: 'KM', heures: 0, kilometres: 50000 }],
  };

  it('liste rapide : seuls les matériels affectés ce jour ; les autres sur demande ou recherche', () => {
    expect(materielsProposes(donnees).map((m) => m.id)).toEqual([1]);
    expect(materielsProposes(donnees, { tous: true }).map((m) => [m.id, m.affecte])).toEqual([[1, true], [2, false]]);
    expect(materielsProposes(donnees, { recherche: 'camion' }).map((m) => m.id)).toEqual([2]);
  });

  it('une ligne de saisie par unité suivie', () => {
    expect(lignesCompteurs(donnees.affectes[0])).toEqual([{ unite: 'H', dernier: 1200 }, { unite: 'KM', dernier: 8000 }]);
    expect(lignesCompteurs(donnees.autres[0]).map((l) => l.unite)).toEqual(['KM']);
  });

  it('saisie lue avec virgule ou point, refus du texte et du négatif', () => {
    expect(lireValeur('1250,5')).toBe(1250.5);
    expect(lireValeur('-3')).toBeNull();
    expect(lireValeur('abc')).toBeNull();
  });

  it('corps du relevé hors affectation : même route, le serveur signale « à valider »', () => {
    expect(corpsReleve('jt', 2, 'KM', '50100', { remise: false })).toEqual({ jeton: 'jt', materiel: 2, unite: 'KM', valeur: 50100, remise: false, commentaire: null });
    expect(corpsReleve('jt', 2, 'KM', 'x')).toBeNull();
  });
});
