import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { composer, verifierCles, catalogueErreurs } from '@logibtp/personnalisation';
import { cles, resoudre } from '@logibtp/socle/dictionnaire';
import { COUCHES, PRECHARGES } from '../personnalisation/couches.js';
import { LOGO, logoValide } from '../src/personnalisation.js';
import { sourcesErreurs, coucheErreur } from '../scripts/erreurs-personnalisation.mjs';

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

  // Lot P2 : « erreurs.<CODE> » remplace le message du serveur ou du moteur ; il n'est sûr que si le code est toujours
  // levé avec ce même message littéral (sinon le dictionnaire masquerait un message plus précis).
  it('erreurs par code : seulement des codes sûrs, au message du code, dans la couche du code', () => {
    const { retenus, ecartes } = catalogueErreurs(sourcesErreurs());
    const relatif = (c) => path.relative(racine, c).split(path.sep).join('/');
    const fautes = [];
    for (const couche of COUCHES) {
      const f = path.join(couche, 'fr.json');
      const erreurs = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).erreurs ?? {} : {};
      for (const [code, message] of Object.entries(erreurs)) {
        const r = retenus.get(code);
        if (!r) fautes.push(`${code} : ${ecartes.get(code) ?? 'plus levé'}`);
        else if (r.message !== message) fautes.push(`${code} : message changé (« ${r.message} »)`);
        else if (coucheErreur(r.chemins) !== relatif(couche)) fautes.push(`${code} : à ranger dans ${coucheErreur(r.chemins)}`);
      }
    }
    // Correction : npm run extraire-erreurs --workspace client
    expect(fautes).toEqual([]);
    expect(retenus.size).toBeGreaterThan(200);
  });

  it('toute couche de personnalisation du dépôt est déclarée', () => {
    const declarees = new Set(COUCHES.map((c) => path.resolve(c)));
    const trouvees = ['socle/js/personnalisation', 'client/personnalisation',
      ...fs.readdirSync(path.join(racine, 'modules')).flatMap((m) => [`modules/${m}/js/personnalisation`, `modules/${m}/personnalisation`])]
      .map((d) => path.join(racine, d)).filter((d) => fs.existsSync(d));
    expect(trouvees.filter((d) => !declarees.has(path.resolve(d))).map((d) => path.relative(racine, d))).toEqual([]);
  });
});
