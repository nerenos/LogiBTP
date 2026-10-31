import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import {
  resoudre, resoudrePluriel, fusionner, cles, variablesDe,
  initialiserDictionnaire, chargerDictionnaire, texte, pluriel, texteHtml, existe, langue, icone, iconeHtml, image, clesManquantes,
} from '../src/dictionnaire/index.js';

const jeu = JSON.parse(readFileSync(new URL('../../tests/dictionnaire.json', import.meta.url), 'utf8'));

describe('dictionnaire (jeu partagé avec Dictionnaire.cs)', () => {
  for (const c of jeu.cas) {
    it(c.nom, () => {
      const d = jeu.dictionnaire;
      if (c.operation === 'texte') expect(resoudre(d, c.cle, c.valeurs, c.defaut)).toBe(c.attendu);
      else if (c.operation === 'pluriel') expect(resoudrePluriel(d, c.cle, c.nombre, c.valeurs)).toBe(c.attendu);
      else if (c.operation === 'erreur') expect(() => resoudre(d, c.cle)).toThrow(/circulaire/);
      else if (c.operation === 'fusion') expect(fusionner(...c.couches)).toEqual(c.attendu);
      else throw new Error(`opération ${c.operation}`);
    });
  }

  it('clés et variables', () => {
    expect(cles({ a: { b: 'x', c: { d: 'y' } }, e: 'z' })).toEqual(['a.b', 'a.c.d', 'e']);
    expect(variablesDe('{{a}} et {{ b }}')).toEqual(['a', 'b']);
  });
});

describe('dictionnaire courant', () => {
  it('texte, pluriel, échappement, langue, icônes et clés manquantes', () => {
    const surManquante = vi.fn();
    initialiserDictionnaire({
      libelles: { _meta: { langue: 'fr-CA', version: 'v1' }, a: { b: '<b>{{x}}</b>', aide_html: '<b>{{x}}</b>', n_un: '{{nombre}} ligne', n_autre: '{{nombre}} lignes' } },
      icones: { parametres: '⚙', logo: 'logo.svg' },
      version: 'v1',
      surManquante,
    });
    expect(texte('a.b', { x: 1 })).toBe('<b>1</b>');
    expect(texteHtml('a.b', { x: '<i>' })).toBe('&lt;b&gt;&lt;i&gt;&lt;/b&gt;');
    expect(texteHtml('a.aide_html', { x: '<i>' })).toBe('<b>&lt;i&gt;</b>');
    expect(pluriel('a.n', 2)).toBe('2 lignes');
    expect(existe('a.b')).toBe(true);
    expect(langue()).toBe('fr-CA');
    expect(icone('parametres')).toBe('⚙');
    expect(icone('logo')).toBe('');
    expect(iconeHtml('logo')).toBe('<img class="icone-image" src="/personnalisation/images/logo.svg?v=v1" alt="">');
    expect(iconeHtml('inconnue', '<x>')).toBe('&lt;x&gt;');
    expect(image('borne.png')).toBe('/personnalisation/images/borne.png?v=v1');
    expect(texte('z.absente')).toBe('z.absente');
    texte('z.absente');
    expect(surManquante).toHaveBeenCalledTimes(1);
    expect(clesManquantes()).toEqual(['z.absente']);
  });

  it('chargement : fichiers servis, sinon secours', async () => {
    const reponses = {
      '/personnalisation/fr.json': { _meta: { version: 'abc' }, t: 'servi' },
      '/personnalisation/images/icones.json': { i: '★' },
    };
    globalThis.fetch = vi.fn(async (u) => (reponses[u] ? { ok: true, json: async () => reponses[u] } : { ok: false, status: 404 }));
    expect(await chargerDictionnaire()).toBe('serveur');
    expect(texte('t')).toBe('servi');
    expect(icone('i')).toBe('★');
    globalThis.fetch = vi.fn(async () => { throw new TypeError('réseau'); });
    expect(await chargerDictionnaire({ secours: async () => ({ libelles: { t: 'intégré' } }) })).toBe('secours');
    expect(texte('t')).toBe('intégré');
    await expect(chargerDictionnaire()).rejects.toThrow();
    delete globalThis.fetch;
  });
});
