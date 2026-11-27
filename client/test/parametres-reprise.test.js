import { describe, it, expect } from 'vitest';
import { sectionsRapport, lireSocietes, lireDecimales, dureeEcoulee, libelleEtape, compteursSuivi } from '../src/app/pages/parametres-reprise.js';

// Écran « Reprise de données » (plan reprise-mde-optim, lot 3) : sections du rapport et saisie des sociétés OPTIM.
const rapport = {
  source: 'OPTIM', etat: 'TERMINEE', simulation: true,
  anomalies: [{ niveau: 'AVERTISSEMENT', code: 'REPRISE_SANS_CIBLE', emplacement: 'bib_tiers 12', message: 'sans correspondance' }],
  volumes: [{ table: 'bib_tiers', lues: 1200, ecrites: 1190, ecartees: 10 }],
  correspondances: { entite: { TRS: 'personne', SCT: 'ignoré : société' } },
  tables_source: { z_unite: 4, bib_tiers: 1200 },
};

describe('reprise : écran (lot 3)', () => {
  it('une section par rubrique du rapport, correspondances aplaties, tables triées', () => {
    const s = Object.fromEntries(sectionsRapport(rapport).map((x) => [x.cle, x]));
    expect(Object.keys(s)).toEqual(['anomalies', 'chronos', 'volumes', 'valeurs_forcees', 'ecarts_arrondi', 'champs_perdus', 'correspondances', 'utilisateurs', 'tables_source']);
    expect(s.valeurs_forcees.lignes).toEqual([]);
    expect(s.correspondances.lignes.map((l) => s.correspondances.cellules(l))).toEqual([['entite', 'TRS', 'personne'], ['entite', 'SCT', 'ignoré : société']]);
    expect(s.tables_source.lignes.map(([t]) => t)).toEqual(['bib_tiers', 'z_unite']);
    for (const x of Object.values(s)) for (const l of x.lignes) expect(x.cellules(l)).toHaveLength(x.colonnes.length);
  });

  it('sociétés saisies séparées par des virgules, des points-virgules ou des espaces', () => {
    expect(lireSocietes(' 1, 2 ;3  4,')).toEqual(['1', '2', '3', '4']);
    expect(lireSocietes('')).toEqual([]);
    // Décimales : 0 à 6, sinon celles de la source (null).
    expect(lireDecimales('3')).toBe(3);
    expect(lireDecimales(' 0 ')).toBe(0);
    expect(lireDecimales('')).toBeNull();
    expect(lireDecimales('7')).toBeNull();
  });
});

describe('reprise : suivi de la tâche de fond (grosse base)', () => {
  it('durée écoulée en secondes, minutes ou heures', () => {
    const debut = '2026-11-24T10:00:00Z';
    expect(dureeEcoulee(debut, '2026-11-24T10:00:42Z')).toBe('42 s');
    expect(dureeEcoulee(debut, '2026-11-24T10:03:05Z')).toBe('3 min 05 s');
    expect(dureeEcoulee(debut, '2026-11-24T11:05:03Z')).toBe('1 h 05 min 03 s');
    expect(dureeEcoulee(debut, null, Date.parse('2026-11-24T10:00:07Z'))).toBe('7 s');
  });

  it('étape affichée : domaine traduit, rang compté depuis 1', () => {
    expect(libelleEtape({ etape: 'DOMAINE', element: 'ANNUAIRE', faits: 3, total: 14 })).toBe('Domaine 4 / 14 : Annuaire (tiers, contacts)');
    expect(libelleEtape({ etape: 'COMPTAGE', element: 'PMEDOC', faits: 0, total: 80 })).toBe('Comptage des tables de la source (1 / 80) : PMEDOC');
    expect(libelleEtape({ etape: 'PREPARATION', element: null, faits: 0, total: 14 })).toBe('Préparation…');
    // Lignes lues dans le domaine (signalées par lots) : compteur affiché.
    expect(libelleEtape({ etape: 'DOMAINE', element: 'PIECES_VENTE', faits: 7, total: 14, lignes: 12500 }))
      .toMatch(/^Domaine 8 \/ 14 : Pièces de vente \(12\s?500 lignes lues\)$/);
  });
});

describe('reprise : compteurs et temps par poste du suivi', () => {
  it('compteurs puis 4 postes les plus longs (plus d\'une seconde), part du temps écoulé', () => {
    const tache = {
      debut: '2026-11-27T10:00:00Z', lignes_total: 1200, ecrites: 35, details: 9000,
      chronos: [
        { poste: 'PIECES_ECRITURE_LIGNES', duree_ms: 300000, nombre: 30 },
        { poste: 'PIECES_CALCUL', duree_ms: 120000, nombre: 90 },
        { poste: 'LECTURE_SOURCE', duree_ms: 60000, nombre: 1200 },
        { poste: 'SQL_CIBLE', duree_ms: 2000, nombre: 50 },
        { poste: 'AUTRE', duree_ms: 1500, nombre: 1 },
        { poste: 'COURT', duree_ms: 10, nombre: 1 },
      ],
    };
    const [compteurs, postes] = compteursSuivi(tache, Date.parse('2026-11-27T10:10:00Z'));
    expect(compteurs).toMatch(/^1\s?200 lignes lues dans la source · 35 fiches et pièces écrites · 9\s?000 lignes de pièces et métrés écrits$/);
    expect(postes).toBe('Temps passé : écriture des lignes et métrés 5 min 00 s (50 %) · calcul des pièces 2 min 00 s (20 %) · lecture de la source 1 min 00 s (10 %) · requêtes sur la base 2 s (0 %)');
    expect(compteursSuivi({ debut: tache.debut })).toEqual([]);
  });
});
