import { describe, it, expect } from 'vitest';
import { lignesCompteurs, materielsProposes, corpsReleve, lireValeur, chantiersJournee, lignesHeuresMateriel, corpsHeuresMateriel } from '../src/app/pointage/releves-borne.js';

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

// Heures de matériel à la borne (plan terrain-suites, lot 19, TS18 a).
describe('borne : heures de matériel', () => {
  const journee = [{ cha_id: 5, minutes: 120 }, { cha_id: 8, minutes: 300 }, { cha_id: 5, minutes: 60 }, { cha_id: 9, minutes: 0 }];
  const donnees = {
    materiels: [{ id: 1, code: 'PEL-01', designation: 'Pelle' }, { id: 2, code: 'MAN-02', designation: 'Manitou' }],
    pointes: [{ materiel: 2, cha_id: 5, minutes: 90 }, { materiel: 2, cha_id: 5, minutes: 30 }, { materiel: 1, cha_id: 77, minutes: 60 }],
  };

  it('chantiers de la journée, du plus pointé au moins pointé, sans les durées nulles', () => {
    expect(chantiersJournee(journee)).toEqual([8, 5]);
  });

  it('une ligne par matériel affecté : durée déjà pointée et son chantier, sinon le chantier principal', () => {
    expect(lignesHeuresMateriel(donnees, journee)).toEqual([
      { materiel: 1, code: 'PEL-01', designation: 'Pelle', cha_id: 8, minutes: 0 },
      { materiel: 2, code: 'MAN-02', designation: 'Manitou', cha_id: 5, minutes: 120 },
    ]);
  });

  it('corps envoyé : durées positives seulement', () => {
    expect(corpsHeuresMateriel('j', '2026-11-08', [{ materiel: 1, cha_id: 8, minutes: 0 }, { materiel: 2, cha_id: 5, minutes: 150, code: 'x' }]))
      .toEqual({ jeton: 'j', date: '2026-11-08', lignes: [{ materiel: 2, cha_id: 5, minutes: 150 }] });
  });
});
