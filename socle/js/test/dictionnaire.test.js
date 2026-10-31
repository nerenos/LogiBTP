import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import {
  resoudre, resoudrePluriel, fusionner, cles, variablesDe,
  initialiserDictionnaire, chargerDictionnaire, texte, pluriel, texteHtml, existe, langue, icone, iconeHtml, image, clesManquantes,
  messageErreur, textesParCode, pairesParCode,
} from '../src/dictionnaire/index.js';
import { ErreurApi } from '../src/api.js';

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

  it('message d\'erreur par code (lot P2) : dictionnaire, sinon message fourni', () => {
    const surManquante = vi.fn();
    initialiserDictionnaire({ libelles: { erreurs: { CODE_PRIS: 'Code {{code}} déjà pris', FIXE: 'Texte du dictionnaire' } }, surManquante });
    expect(messageErreur('FIXE', 'Texte du serveur')).toBe('Texte du dictionnaire');
    expect(messageErreur('CODE_PRIS', 'x', { code: 'C1' })).toBe('Code C1 déjà pris');
    expect(messageErreur('CODE_PRIS', 'Code C1 pris', ['C1'])).toBe('Code C1 pris');
    expect(messageErreur('CODE_PRIS', 'Code C1 pris')).toBe('Code C1 pris');
    expect(messageErreur('INCONNU', 'Texte du serveur')).toBe('Texte du serveur');
    expect(messageErreur(null, 'Texte du serveur')).toBe('Texte du serveur');
    expect(surManquante).not.toHaveBeenCalled();
    const e = new ErreurApi(422, 'FIXE', 'Texte du serveur');
    expect([e.message, e.titre, e.code]).toEqual(['Texte du dictionnaire', 'Texte du serveur', 'FIXE']);
    expect(new ErreurApi(500, 'HTTP', 'Erreur interne').message).toBe('Erreur interne');
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

describe('tables de libellés par code', () => {
  it('relisent le dictionnaire à chaque accès et gardent leur forme', () => {
    initialiserDictionnaire({ libelles: { m: { A: 'Alpha', B: 'Bêta' } } });
    const t = textesParCode('m', ['A', 'B']);
    const p = pairesParCode('m', ['A', 'B']);
    expect(Object.keys(t)).toEqual(['A', 'B']);
    expect(p.map(([c, l]) => `${c}=${l}`)).toEqual(['A=Alpha', 'B=Bêta']);
    initialiserDictionnaire({ libelles: { m: { A: 'Autre', B: 'Bêta' } } });
    expect(t.A).toBe('Autre');
    expect(p[0][1]).toBe('Autre');
    expect(Object.isFrozen(p) && Object.isFrozen(p[0])).toBe(true);
  });
});
