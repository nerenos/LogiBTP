import { describe, it, expect } from 'vitest';
import { verifierModele } from '@logibtp/edition';
import { MODELES_EDITION } from '../src/app/editions/modeles.js';
import { MODELE_EDITION } from '../src/app/codes.js';

// Lettres de relance (plans/relances.md, lot 7, Q12, Q13 b) : source « relance » du serveur (SourceRelanceEdition).
const LETTRES = [MODELE_EDITION.RELANCE_1, MODELE_EDITION.RELANCE_2, MODELE_EDITION.MISE_EN_DEMEURE];
const modele = (code) => MODELES_EDITION.find((m) => m.code === code);

describe('Lettres de relance', () => {
  it('les trois modèles sont des rapports valides de la source relance', () => {
    for (const code of LETTRES) {
      const m = modele(code);
      expect(m, code).toBeTruthy();
      expect([m.genre, m.cible, m.source, m.contenu.source]).toEqual(['RAPPORT', 'DOCUMENT', 'relance', 'relance']);
      expect(verifierModele(m.contenu)).toEqual([]);
      const json = JSON.stringify(m.contenu);
      expect(json).toContain('relance.recommande');
      expect(json).toContain('"collection":"pieces"');
    }
  });

  it('la mise en demeure cite les mentions de pénalités et d’indemnité sans les calculer', () => {
    const json = JSON.stringify(modele(MODELE_EDITION.MISE_EN_DEMEURE).contenu);
    expect(json).toContain('societe.mentions.penalites');
    expect(json).toContain('societe.mentions.indemnite');
    expect(json).not.toMatch(/taux|Arrondi\(/);
    for (const code of [MODELE_EDITION.RELANCE_1, MODELE_EDITION.RELANCE_2]) expect(JSON.stringify(modele(code).contenu)).not.toContain('societe.mentions.penalites');
  });
});
