import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STATUT_DOCUMENT } from '@logibtp/document';
import { STATUT_ORDRE } from '@logibtp/execution';
import { CLE_APERCU } from '@logibtp/navigation';
import { CLE_PREFERENCES_NAVIGATION, TYPE_FICHE } from '../src/app/codes.js';
import { TYPES_FICHE } from '../src/app/fiches/definitions.js';

const publicJs = (nom) => readFileSync(new URL(`../public/${nom}`, import.meta.url), 'utf8');

// Copies déclarées de codes entre modules sans dépendance entre eux, ou dans les scripts de démarrage (sans import).
describe('Codes recopiés', () => {
  it('les statuts lus par l\'Exécution sont des statuts du module Document', () => {
    for (const [cle, valeur] of Object.entries(STATUT_ORDRE)) expect(STATUT_DOCUMENT[cle]).toBe(valeur);
  });

  it('les types de fiches sont ceux des définitions des fiches', () => {
    expect(Object.values(TYPE_FICHE).sort()).toEqual(Object.keys(TYPES_FICHE).sort());
  });

  it('les scripts de démarrage lisent les clés de stockage de l\'application', () => {
    expect(publicJs('demarrage-theme.js')).toContain(`localStorage.getItem('${CLE_PREFERENCES_NAVIGATION}')`);
    expect(publicJs('demarrage-apercu.js')).toContain(`sessionStorage.getItem('${CLE_APERCU}')`);
  });
});
