import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { groupesFusion, controlerFusions, choixDepuisFusions } from '../src/index.js';

const { cas } = JSON.parse(readFileSync(new URL('./fusions-cas.json', import.meta.url), 'utf8'));

const doublons = [
  { table: 'bib_tiers', critere: 'SIRET', valeur: '77788899900015', fiches: [{ cle: '12', libelle: 'MATBAT' }, { cle: '13 ', libelle: 'MAT BAT' }] },
  { table: 'COMM_TIERS', critere: 'SIRET', valeur: '1', fiches: [{ cle: 'C003', libelle: 'A' }, { cle: 'F001', libelle: 'B' }, { cle: 'F009', libelle: 'C' }] },
];

describe('reprise : fusions de doublons (plan reprise-mde-optim, lot 3)', () => {
  for (const c of cas) it(`contrôle : ${c.nom}`, () => expect(controlerFusions(c.groupes)).toEqual(c.erreurs));

  it('groupes des doublons cochés, la conservée hors des fusionnées', () => {
    expect(groupesFusion(doublons, [{ fusionner: true, conservee: '13' }, { fusionner: false }])).toEqual([
      { table_source: 'bib_tiers', cle_conservee: '13', cles_fusionnees: ['12'] },
    ]);
    expect(groupesFusion(doublons, [undefined, { fusionner: true }])).toEqual([
      { table_source: 'COMM_TIERS', cle_conservee: 'C003', cles_fusionnees: ['F001', 'F009'] },
    ]);
  });

  it('choix repris des fusions enregistrées', () => {
    expect(choixDepuisFusions(doublons, [{ table_source: 'COMM_TIERS', cle_conservee: 'F001', cles_fusionnees: ['C003', 'F009'] }])).toEqual([
      { fusionner: false, conservee: '12' },
      { fusionner: true, conservee: 'F001' },
    ]);
  });
});
