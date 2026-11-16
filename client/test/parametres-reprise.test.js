import { describe, it, expect } from 'vitest';
import { sectionsRapport, lireSocietes } from '../src/app/pages/parametres-reprise.js';

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
    expect(Object.keys(s)).toEqual(['anomalies', 'volumes', 'valeurs_forcees', 'ecarts_arrondi', 'champs_perdus', 'correspondances', 'utilisateurs', 'tables_source']);
    expect(s.valeurs_forcees.lignes).toEqual([]);
    expect(s.correspondances.lignes.map((l) => s.correspondances.cellules(l))).toEqual([['entite', 'TRS', 'personne'], ['entite', 'SCT', 'ignoré : société']]);
    expect(s.tables_source.lignes.map(([t]) => t)).toEqual(['bib_tiers', 'z_unite']);
    for (const x of Object.values(s)) for (const l of x.lignes) expect(x.cellules(l)).toHaveLength(x.colonnes.length);
  });

  it('sociétés saisies séparées par des virgules, des points-virgules ou des espaces', () => {
    expect(lireSocietes(' 1, 2 ;3  4,')).toEqual(['1', '2', '3', '4']);
    expect(lireSocietes('')).toEqual([]);
  });
});
