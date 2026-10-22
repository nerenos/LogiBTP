import { describe, it, expect } from 'vitest';
import { versMinutes, depuisMinutes, debutUnite, semaineIso, colonnes, groupes, lignesEntete, aujourdhui, arrondirAuPas, periodeFlottante, plagesVisibles, creerAxe, empiler, cumuler, ligneA, visibles } from '../src/index.js';

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
  it("lignes de l'en-tête : mois et année, jours, découpage de la journée", () => {
    const l = (du, au, e) => lignesEntete(m(du), m(au), e).map((x) => [x.niveau, x.cellules.map((c) => c.libelle)]);
    expect(l('2026-10-31', '2026-11-02', 'JOUR')).toEqual([['MOIS', ['Octobre 2026', 'Novembre 2026']], ['JOUR', ['sam 31', 'dim 1']]]);
    expect(l('2026-10-22', '2026-10-23', 'DEMI_JOUR')).toEqual([['MOIS', ['Octobre 2026']], ['JOUR', ['jeu 22']], ['DEMI_JOUR', ['matin', 'après-midi']]]);
    expect(l('2026-10-22T06:00', '2026-10-22T08:00', 'HEURE')).toEqual([['MOIS', ['Octobre 2026']], ['JOUR', ['jeu 22']], ['HEURE', ['6h', '7h']]]);
    expect(l('2026-10-21', '2026-10-27', 'SEMAINE')).toEqual([['MOIS', ['Octobre 2026']], ['SEMAINE', ['S43', 'S44']]]);
    expect(lignesEntete(m('2026-10-24'), m('2026-10-25'), 'HEURE')[1].cellules[0].weekend).toBe(true);
    expect(depuisMinutes(aujourdhui(new Date(2026, 9, 22, 23, 30)))).toBe('2026-10-22T00:00');
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

describe('axe à périodes masquées', () => {
  const s = (p) => p.map((x) => `${depuisMinutes(x.debut).slice(5)}→${depuisMinutes(x.fin).slice(5)}`);
  it('plages visibles : heures de travail, jours masqués, plages contiguës fusionnées', () => {
    // 2026-10-23 vendredi, 24 samedi, 25 dimanche, 26 lundi.
    expect(s(plagesVisibles(m('2026-10-23'), m('2026-10-27'), { heures: [420, 1080], jours: [6, 0] })))
      .toEqual(['10-23T07:00→10-23T18:00', '10-26T07:00→10-26T18:00']);
    expect(s(plagesVisibles(m('2026-10-22'), m('2026-10-27'), { heures: null, jours: [5, 6, 0] }))).toEqual(['10-22T00:00→10-23T00:00', '10-26T00:00→10-27T00:00']);
    expect(s(plagesVisibles(m('2026-10-22'), m('2026-10-24'), null))).toEqual(['10-22T00:00→10-24T00:00']);
    expect(s(plagesVisibles(m('2026-10-24'), m('2026-10-26'), { jours: [6, 0] }))).toEqual(['10-24T00:00→10-26T00:00']); // tout masqué : linéaire
  });
  it('positions et instants', () => {
    const a = creerAxe(m('2026-10-23'), m('2026-10-27'), 1, { heures: [420, 1080], jours: [6, 0] });
    expect(a.largeur).toBe(2 * 660);
    expect(a.x(m('2026-10-23T07:00'))).toBe(0);
    expect(a.x(m('2026-10-23T03:00'))).toBe(0); // masqué avant la première plage
    expect(a.x(m('2026-10-23T12:00'))).toBe(300);
    expect(a.x(m('2026-10-23T20:00'))).toBe(660); // masqué : début de la plage suivante
    expect(a.x(m('2026-10-25T10:00'))).toBe(660);
    expect(a.x(m('2026-10-26T08:00'))).toBe(720);
    expect(a.coupures).toEqual([660]);
    expect(depuisMinutes(a.instant(720))).toBe('2026-10-26T08:00');
    expect(depuisMinutes(a.instant(300))).toBe('2026-10-23T12:00');
    const l = creerAxe(m('2026-10-23'), m('2026-10-24'), 2, null);
    expect([l.x(m('2026-10-22T23:00')), l.x(m('2026-10-23T02:00')), l.instant(60) - m('2026-10-23')]).toEqual([-30, 60, 120]);
  });
});
