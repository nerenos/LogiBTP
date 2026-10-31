import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { composer, verifierCles } from '@logibtp/personnalisation';
import { cles, resoudre } from '@logibtp/socle/dictionnaire';
import { COUCHES, PRECHARGES } from '../personnalisation/couches.js';
import { LOGO, logoValide } from '../src/personnalisation.js';

const racine = fileURLToPath(new URL('../..', import.meta.url));

/** Fichiers JS d'un dossier (hors node_modules et tests). */
function sources(dossier) {
  const res = [];
  const parcourir = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (!['node_modules', 'test', 'dist'].includes(e.name)) parcourir(f); } else if (/\.m?js$/.test(e.name)) res.push(f);
    }
  };
  parcourir(path.join(racine, dossier));
  return res;
}

// Module Personnalisation : dictionnaire composé des couches du programme (socle → modules → cœur).
describe('personnalisation du programme', () => {
  const composition = composer(COUCHES);

  it('toute clé littérale du code existe (texte, pluriel, icône)', () => {
    const fichiers = [...sources('socle/js/src'), ...sources('modules/navigation/js'), ...sources('client/src')];
    const { manquantes } = verifierCles({ fichiers, libelles: composition.libelles, icones: composition.icones });
    expect(manquantes.map((m) => `${path.relative(racine, m.ou.split(':')[0])} ${m.cle}`)).toEqual([]);
  });

  it('chaque texte se résout (références existantes, sans cycle)', () => {
    for (const c of cles(composition.libelles)) {
      const t = resoudre(composition.libelles, c);
      expect(t, c).not.toMatch(/\$t\(/);
    }
  });

  it('images du cœur : logo et icône de la page, préchargement du logo', () => {
    expect(PRECHARGES).toContain(LOGO);
    expect(composition.images.has(LOGO)).toBe(true);
    expect(composition.images.has('images/icone.svg')).toBe(true);
    expect(logoValide(fs.readFileSync(composition.images.get(LOGO), 'utf8'))).toMatch(/^<svg/);
  });

  it('logo : SVG seul, sans script ni gestionnaire', () => {
    expect(logoValide('<?xml version="1.0"?>\n<svg viewBox="0 0 1 1"></svg>')).toBe('<svg viewBox="0 0 1 1"></svg>');
    expect(logoValide('<svg><script>alert(1)</script></svg>')).toBe('');
    expect(logoValide('<svg onload="x()"></svg>')).toBe('');
    expect(logoValide('<img src=x>')).toBe('');
  });
});
