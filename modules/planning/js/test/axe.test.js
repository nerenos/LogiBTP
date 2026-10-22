import { describe, it, expect } from 'vitest';
import { versMinutes, depuisMinutes, debutUnite, semaineIso, colonnes, groupes, arrondirAuPas, periodeFlottante, empiler, cumuler, ligneA, visibles } from '../src/index.js';

const m = versMinutes;

describe('axe du temps', () => {
  it('convertit les instants', () => {
    expect(depuisMinutes(m('2026-10-22T08:15'))).toBe('2026-10-22T08:15');
    expect(m('2026-10-22')).toBe(m('2026-10-22T00:00'));
    expect(m('2026-03-29T03:00') - m('2026-03-29T01:00')).toBe(120); // pas de changement d'heure
  });
  it('débuts d\'unités', () => {
    expect(depuisMinutes(debutUnite(m('2026-10-22T13:40'), 'JOUR'))).toBe('2026-10-22T00:00');
    expect(depuisMinutes(debutUnite(m('2026-10-25T13:40'), 'SEMAINE'))).toBe('2026-10-19T00:00');
    expect(depuisMinutes(debutUnite(m('2026-10-25T13:40'), 'MOIS'))).toBe('2026-10-01T00:00');
  });
  it('semaines ISO', () => {
    expect(semaineIso(m('2026-10-22'))).toBe(43);
    expect(semaineIso(m('2027-01-01'))).toBe(53);
    expect(semaineIso(m('2026-01-01'))).toBe(1);
  });
  it('colonnes et groupes', () => {
    const c = colonnes(m('2026-10-24'), m('2026-10-27'), 'JOUR');
    expect(c.map((x) => [x.libelle, x.weekend])).toEqual([['sam 24', true], ['dim 25', true], ['lun 26', false]]);
    expect(colonnes(m('2026-10-21'), m('2026-10-27'), 'SEMAINE').map((x) => x.libelle)).toEqual(['S43', 'S44']);
    expect(colonnes(m('2026-10-22T06:00'), m('2026-10-22T09:00'), 'HEURE').map((x) => x.libelle)).toEqual(['6h', '7h', '8h']);
    expect(groupes(m('2026-10-30'), m('2026-11-02'), 'SEMAINE').map((x) => x.libelle)).toEqual(['octobre 2026', 'novembre 2026']);
    expect(groupes(m('2026-10-22'), m('2026-10-23'), 'HEURE').map((x) => x.libelle)).toEqual(['jeu 22/10/2026']);
  });
  it('pas et période flottante', () => {
    expect(arrondirAuPas(52, 15)).toBe(45);
    expect(arrondirAuPas(53, 15)).toBe(60);
    const p = periodeFlottante('2026-10-22', 14, 28);
    expect([depuisMinutes(p.debut), depuisMinutes(p.fin)]).toEqual(['2026-10-08T00:00', '2026-11-20T00:00']);
  });
});

describe('disposition', () => {
  it('empile les barres qui se chevauchent', () => {
    const a = { debut: 0, fin: 10 }; const b = { debut: 5, fin: 15 }; const c = { debut: 10, fin: 20 }; const d = { debut: 0, fin: 30 };
    const { voies, nb } = empiler([a, b, c, d]);
    expect(nb).toBe(3);
    expect([voies.get(d), voies.get(a), voies.get(b), voies.get(c)]).toEqual([0, 1, 2, 1]);
  });
  it('trouve les lignes et les barres visibles', () => {
    const p = cumuler([20, 30, 20]);
    expect(p).toEqual([0, 20, 50, 70]);
    expect([ligneA(p, -5), ligneA(p, 0), ligneA(p, 19), ligneA(p, 20), ligneA(p, 69), ligneA(p, 500)]).toEqual([0, 0, 0, 1, 2, 2]);
    const barres = [{ debut: 0, fin: 100 }, { debut: 50, fin: 60 }, { debut: 200, fin: 210 }, { debut: 300, fin: 400 }];
    expect(visibles(barres, 80, 250, 100)).toEqual([barres[0], barres[2]]);
  });
});
