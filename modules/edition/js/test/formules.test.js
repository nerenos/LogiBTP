import { describe, it, expect } from 'vitest';
import { evaluerFormule, montantEnLettres, entierEnLettres, verifierCharte, lireHtml } from '../src/index.js';

describe('nombres en lettres', () => {
  it.each([
    [0, 'zéro'], [1, 'un'], [16, 'seize'], [17, 'dix-sept'], [21, 'vingt et un'], [71, 'soixante et onze'], [72, 'soixante-douze'],
    [80, 'quatre-vingts'], [81, 'quatre-vingt-un'], [91, 'quatre-vingt-onze'], [100, 'cent'], [200, 'deux cents'], [201, 'deux cent un'],
    [1000, 'mille'], [2000, 'deux mille'], [80000, 'quatre-vingt mille'], [200000, 'deux cent mille'],
    [1000000, 'un million'], [2500000, 'deux millions cinq cent mille'], [127106, 'cent vingt-sept mille cent six'],
  ])('%i → %s', (n, attendu) => expect(entierEnLettres(n)).toBe(attendu));
  it('montants', () => {
    expect(montantEnLettres('127106.12')).toBe('cent vingt-sept mille cent six euros et douze centimes');
    expect(montantEnLettres('1')).toBe('un euro');
    expect(montantEnLettres('1000000')).toBe("un million d'euros");
    expect(montantEnLettres('0.01')).toBe('zéro euro et un centime');
    expect(evaluerFormule('=EnLettres(80,8)', {})).toBe('quatre-vingts euros et quatre-vingts centimes');
  });
});

describe('fonctions du lot 1', () => {
  const ctx = { resoudre: (c) => ({ statut: 'VALIDE', d: '2026-10-18' })[c] ?? null };
  it('tests de texte, choix, dates, arrondis', () => {
    expect(evaluerFormule('=Dans(statut; "VALIDE"; "ENVOYE")', ctx)).toBe(true);
    expect(evaluerFormule('=Contient("Écart de règlement"; "ecart")', ctx)).toBe(true);
    expect(evaluerFormule('=Choix(2; "a"; "b"; "c")', ctx)).toBe('b');
    expect(evaluerFormule('=Date(AjouterJours(d; 30))', ctx)).toBe('17/11/2026');
    expect(evaluerFormule('=ArrondiSup(1,21; 1)', ctx).toString()).toBe('1.3');
    expect(evaluerFormule('=ArrondiInf(-1,21; 1)', ctx).toString()).toBe('-1.3');
  });
});

describe('charte et libellés', () => {
  it('contrôle de la charte', () => {
    const e = verifierCharte({ couleurs: { x: 'rouge' }, styles: { a: { base: 'b' }, b: { base: 'a' }, c: { police: 'Arial' } } });
    expect(e.map((x) => x.code).sort()).toEqual(['COULEUR', 'POLICE', 'STYLE_CYCLE', 'STYLE_CYCLE']);
    expect(verifierCharte({})).toEqual([]);
  });
  it('fusions de cellules signalées', () => {
    expect(lireHtml('<table><tr><td colspan="2">a</td></tr></table>')[0].fusions).toBe(true);
    expect(lireHtml('<table><tr><td>a</td></tr></table>')[0].fusions).toBeUndefined();
  });
});

describe('nombres sous leur forme la plus simple', () => {
  it.each([['30', '30'], ['30.00', '30'], ['85.26', '85,26'], ['85.5', '85,5'], ['12.3456', '12,35'], ['1234.5', '1 234,5'], ['0', '0']])('%s → %s', (v, attendu) => {
    expect(evaluerFormule(`=Simple(${v.replace('.', ',')})`, {}).replace(/\s/g, ' ')).toBe(attendu);
  });
  it('pourcentage simplifié', () => expect(evaluerFormule('=Pourcent(20)', {})).toBe('20 %'));
});
