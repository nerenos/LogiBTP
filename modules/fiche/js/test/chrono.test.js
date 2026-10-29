import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formaterCode, lireCode, debutCode, controlerChrono, codeSuivant, FournisseurFicheMemoire } from '../src/index.js';

const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/02_chrono.json'), 'utf8'));

describe('chrono des fiches (jeu partagé avec le C#)', () => {
  for (const c of jeu.formater) it(`formater : ${c.nom}`, () => expect(formaterCode(c, { annee: c.annee, rang: c.rang, parent: c.parent })).toBe(c.attendu));
  for (const c of jeu.lire) it(`lire : ${c.nom}`, () => expect(lireCode(c, c.code, { parent: c.parent })).toEqual(c.attendu));
  for (const c of jeu.debut) it(`début : ${c.nom}`, () => expect(debutCode(c, { annee: c.annee, parent: c.parent })).toBe(c.attendu));
  for (const c of jeu.controler) it(`contrôler : ${c.nom}`, () => expect(controlerChrono(c) === null).toBe(c.valide));
  for (const c of jeu.suivant) it(`suivant : ${c.nom}`, () => expect(codeSuivant(c.code)).toBe(c.attendu));
});

describe('chrono dans le fournisseur mémoire (mêmes règles que ServiceFiche.Chrono.cs)', () => {
  const definition = {
    libelle: 'Chantier', chrono: { champ: 'code', prefixe: 'CH-', format: '{P}{AAAA}-{N:3}', raz: 'A' },
    champs: [{ code: 'code', libelle: 'Code', type: 'texte', obligatoire: true }, { code: 'libelle', libelle: 'Libellé', type: 'texte' }],
  };
  const marche = {
    libelle: 'Marché',
    chrono: { champ: 'code', prefixe: 'M-', format: '{P}{PARENT}-{N}', raz: 'J', parent: 'cha_id', variante: 'sens', variantes: [{ valeur: 'V', prefixe: 'M-' }, { valeur: 'ST', prefixe: 'MST-' }] },
    champs: [{ code: 'code', libelle: 'Code', type: 'texte', obligatoire: true }, { code: 'cha_id', libelle: 'Chantier', type: 'nombre' }, { code: 'sens', libelle: 'Sens', type: 'texte' }],
  };
  const creer = (actions = ['VOIR', 'MODIFIER']) => new FournisseurFicheMemoire({
    horloge: () => new Date('2026-10-29T10:00:00').getTime(),
    types: {
      chantier: { definition, cle: 'id', proprietes: 'p', lignes: [{ id: 1, code: 'CH-2026-001' }, { id: 2, code: 'CH-2026-003' }, { id: 3, code: 'CH-2025-009' }] },
      marche: { definition: marche, cle: 'id', proprietes: 'p', lignes: [{ id: 1, code: 'M-2026-001-1', cha_id: 1 }, { id: 2, code: 'M-2026-001-GO', cha_id: 1 }] },
    },
    droits: ['chantier', 'marche'].flatMap((type) => actions.map((action) => ({ profil: 'ADMIN', type, action }))),
    parentChrono: (type, champ, valeur) => (valeur === '1' ? '2026-001' : null),
  });

  it('prévisionnel : premier rang libre de l\'exercice, le compteur n\'avance pas', async () => {
    const f = creer();
    expect((await f.code('chantier', {})).previsionnel).toBe('CH-2026-002');
    expect((await f.code('chantier', {})).previsionnel).toBe('CH-2026-002');
  });

  it('création sans code : code calculé attribué, rang pris sauté', async () => {
    const f = creer();
    expect((await f.creer('chantier', { valeurs: { libelle: 'A' } })).valeurs.code).toBe('CH-2026-002');
    expect((await f.creer('chantier', { valeurs: { libelle: 'B' } })).valeurs.code).toBe('CH-2026-004');
  });

  it('code saisi déjà pris : CODE_PRIS avec le prochain code libre', async () => {
    const f = creer();
    await expect(f.creer('chantier', { valeurs: { code: 'CH-2026-001' } })).rejects.toMatchObject({ code: 'CODE_PRIS', details: { propose: 'CH-2026-002' } });
    expect((await f.code('chantier', { code: 'CH-2026-003' })).pris).toEqual({ id: '2', code: 'CH-2026-003' });
  });

  it('code changé après la création : droit MODIFIER_CODE', async () => {
    const f = creer();
    await f.verrouiller('chantier', 1, { jeton: 'j' });
    await expect(f.enregistrer('chantier', 1, { jeton: 'j', valeurs: { code: 'X1' } })).rejects.toMatchObject({ code: 'ACCES_REFUSE' });
    const g = creer(['VOIR', 'MODIFIER', 'MODIFIER_CODE']);
    await g.verrouiller('chantier', 1, { jeton: 'j' });
    await expect(g.enregistrer('chantier', 1, { jeton: 'j', valeurs: { code: 'CH-2026-003' } })).rejects.toMatchObject({ code: 'CODE_PRIS' });
    expect((await g.enregistrer('chantier', 1, { jeton: 'j', valeurs: { code: 'X1' } })).valeurs.code).toBe('X1');
  });

  it('marché : rang d\'après les marchés du chantier, préfixe selon le sens, sans chantier pas de prévisionnel', async () => {
    const f = creer();
    expect((await f.code('marche', { valeurs: { cha_id: 1 } })).previsionnel).toBe('M-2026-001-2');
    expect((await f.code('marche', { valeurs: { cha_id: 1, sens: 'ST' } })).previsionnel).toBe('MST-2026-001-1');
    expect((await f.code('marche', { valeurs: {} })).previsionnel).toBeNull();
  });
});
