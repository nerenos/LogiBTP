import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
import { composer, contenu, clesUtilisees, verifierCles } from '../src/index.js';
import { balisesHtml } from '../src/vite.js';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'perso-'));
afterAll(() => fs.rmSync(racine, { recursive: true, force: true }));

function couche(nom, fichiers) {
  const d = path.join(racine, nom, 'personnalisation');
  for (const [f, c] of Object.entries(fichiers)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), typeof c === 'string' ? c : JSON.stringify(c));
  }
  return d;
}

const socle = couche('socle', {
  'fr.json': { _meta: { langue: 'fr-FR', version: 'x' }, commun: { ok: 'OK', annuler: 'Annuler' } },
  'theme.css': ':root { --accent: blue; }',
  'images/icones.json': { parametres: '⚙' },
  'images/emojis.json': { valide: 'emojis/valide.svg' },
  'images/emojis/valide.svg': '<svg>valide</svg>',
  'images/logo.svg': '<svg>socle</svg>',
});
const coeur = couche('coeur', {
  'fr.json': { commun: { ok: 'D\'accord' }, application: { nom: 'LogiBTP' } },
  'theme.css': ':root { --accent: red; }',
  'images/icones.json': { chantier: '👷' },
  'images/emojis.json': { casque: 'emojis/casque.svg' },
  'images/emojis/casque.svg': '<svg>casque</svg>',
  'images/logo.svg': '<svg>coeur</svg>',
  'images/borne/fond.png': 'png',
});

describe('composition des couches', () => {
  const c = composer([socle, coeur]);

  it('fusionne les textes et les icônes, la dernière couche l\'emporte', () => {
    expect(c.libelles.commun).toEqual({ ok: 'D\'accord', annuler: 'Annuler' });
    expect(c.libelles.application.nom).toBe('LogiBTP');
    expect(c.libelles._meta.langue).toBe('fr-FR');
    expect(c.libelles._meta.version).toMatch(/^[0-9a-f]{16}$/);
    expect(c.icones).toEqual({ parametres: '⚙', chantier: '👷' });
  });

  it('fusionne les catalogues d\'emojis et sert leurs images (§ 42)', () => {
    expect(c.emojis).toEqual({ valide: 'emojis/valide.svg', casque: 'emojis/casque.svg' });
    expect(JSON.parse(contenu(c, 'images/emojis.json').corps)).toEqual(c.emojis);
    expect(String(contenu(c, 'images/emojis/casque.svg').corps)).toBe('<svg>casque</svg>');
    expect(c.images.has('images/emojis.json')).toBe(false);
  });

  it('concatène les thèmes dans l\'ordre et retient la dernière image', () => {
    expect(c.theme.indexOf('blue')).toBeLessThan(c.theme.indexOf('red'));
    expect(String(contenu(c, 'images/logo.svg').corps)).toBe('<svg>coeur</svg>');
    expect(contenu(c, '/images/borne/fond.png').type).toBe('image/png');
    expect(contenu(c, 'images/absent.svg')).toBeNull();
    expect(JSON.parse(contenu(c, 'fr.json').corps).commun.ok).toBe('D\'accord');
    expect(contenu(c, 'theme.css').type).toMatch(/^text\/css/);
  });

  it('version : change avec le contenu, stable sinon', () => {
    expect(composer([socle, coeur]).libelles._meta.version).toBe(c.libelles._meta.version);
    fs.writeFileSync(path.join(coeur, 'images/logo.svg'), '<svg>nouveau</svg>');
    expect(composer([socle, coeur]).libelles._meta.version).not.toBe(c.libelles._meta.version);
  });
});

describe('vérification des clés', () => {
  it('relève les appels littéraux et construits', () => {
    const src = "texte('a.b'); texteHtml(\"c\", { x }); pluriel('d.e', n); icone('f'); texte(`g.${x}`); autre('z')";
    expect(clesUtilisees(src).map((u) => [u.fonction, u.cle, u.construite])).toEqual([
      ['texte', 'a.b', false], ['texteHtml', 'c', false], ['pluriel', 'd.e', false], ['icone', 'f', false], ['texte', 'g.', true],
    ]);
  });

  it('signale les clés absentes', () => {
    const f = path.join(racine, 'source.js');
    fs.writeFileSync(f, "texte('a.b');\ntexte('a.z');\npluriel('p', 2);\npluriel('q', 1);\ntexte(`a.${x}`);\ntexte(`y.${x}`);\nicone('i');\nicone('j');");
    const { manquantes, construites } = verifierCles({ fichiers: [f], libelles: { a: { b: 'B' }, p_un: '1', p_autre: 'n' }, icones: { i: '★' } });
    expect(manquantes.map((m) => m.cle)).toEqual(['a.z', 'q_un', 'q_autre', 'y.…', 'j']);
    expect(manquantes[0].ou).toBe(`${f}:2`);
    expect(construites).toBe(2);
  });
});

describe('index.html', () => {
  it('icône, préchargements et feuille du thème, sans script', () => {
    const b = balisesHtml(['images/logo.svg'], 'images/icone.svg');
    expect(b.map((x) => `${x.attrs.rel} ${x.attrs.href}`)).toEqual([
      'icon /personnalisation/images/icone.svg', 'preload /personnalisation/fr.json', 'preload /personnalisation/images/icones.json',
      'preload /personnalisation/images/emojis.json',      'preload /personnalisation/images/logo.svg', 'stylesheet /personnalisation/theme.css',
    ]);
    expect(b.every((x) => x.tag === 'link')).toBe(true);
  });
});
