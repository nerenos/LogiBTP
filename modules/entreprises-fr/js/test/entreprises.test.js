import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { versEntreprise, casseNom, FournisseurEntreprisesDirect, siretCherche } from '../src/index.js';

const dossier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas');
const jeu = JSON.parse(fs.readFileSync(path.join(dossier, '01_correspondance.json'), 'utf-8'));

describe('correspondance (jeu partagé 01_correspondance.json)', () => {
  for (const c of jeu.cas) it(c.nom, () => expect(versEntreprise(jeu.resultat, c.siret)).toEqual(c.attendu));
  it('casse des noms propres', () => {
    expect(casseNom("D'ARTAGNAN-DE LA TOUR")).toBe("D'Artagnan-De La Tour");
    expect(casseNom('  ')).toBeNull();
  });
});

describe('recherche directe', () => {
  it('interroge l\'API publique et retient l\'établissement du SIRET cherché', async () => {
    const appels = [];
    vi.stubGlobal('fetch', async (url) => { appels.push(url); return { ok: true, status: 200, json: async () => ({ results: [jeu.resultat], total_results: 1, page: 1, total_pages: 1 }) }; });
    const r = await new FournisseurEntreprisesDirect().rechercher('912 345 006 00015');
    expect(appels[0]).toContain('q=912+345+006+00015');
    expect(r.resultats[0].siret).toBe('91234500600015');
    expect(r.total).toBe(1);
    expect(siretCherche('abc')).toBeNull();
    await expect(new FournisseurEntreprisesDirect().rechercher('ab')).rejects.toMatchObject({ code: 'RECHERCHE' });
    vi.unstubAllGlobals();
  });
});
