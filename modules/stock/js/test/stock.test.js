import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockA, ecartComptage, valoriser, valeurUnitaire, valoriserEtat, controlerLot, MESSAGES_INVENTAIRE, projeter, minimumJusqua, proposer, repartirLots, dateLimiteLot, stockParLot, proposerLots, MESSAGES_TRACABILITE } from '../src/index.js';

// Jeux partagés avec ReglesStock.cs et ReglesValorisation.cs (LogiBTP.Stock.Tests).
const lire = (f) => JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas', f), 'utf8'));

describe('stock à une date-heure (jeu partagé)', () => {
  for (const c of lire('01_stock.json').cas) {
    it(c.nom, () => {
      const entree = { mouvements: c.mouvements, comptages: c.comptages };
      expect(stockA(entree, c.t)).toEqual(c.attendu);
      if (c.ecart) expect(ecartComptage(entree, c.comptages[c.ecart.comptage])).toEqual(c.ecart.attendu);
    });
  }
});

describe('valorisation (jeu partagé)', () => {
  for (const c of lire('02_prix.json').cas) {
    it(c.nom, () => {
      const r = valoriser({ mouvements: c.mouvements, comptages: c.comptages, reevaluations: c.reevaluations }, c.date);
      const { valeur, source, valeur_provisoire: vp, ...attendu } = c.attendu;
      expect(r).toEqual(attendu);
      const u = valeurUnitaire(r, c.methode, c.repli);
      expect(u).toEqual({ valeur, source, provisoire: Boolean(vp) });
    });
  }
});

describe('stock valorisé à une date, tous lieux (jeu partagé)', () => {
  for (const c of lire('06_valorisation_date.json').cas) {
    it(c.nom, () => {
      expect(valoriserEtat({ mouvements: c.mouvements, comptages: c.comptages, reevaluations: c.reevaluations }, c.date, c.methode, c.repli)).toEqual(c.attendu);
    });
  }
});

describe("contrôle d'un lot d'inventaire (jeu partagé)", () => {
  for (const c of lire('03_inventaire.json').cas) {
    it(c.nom, () => {
      const r = controlerLot({ lignes: c.lignes });
      expect(r).toEqual(c.attendu);
      for (const x of [...r.erreurs, ...r.avertissements]) expect(MESSAGES_INVENTAIRE[x.code]).toBeTruthy();
    });
  }
});

describe('projection et propositions (jeu partagé)', () => {
  const jeu = lire('04_projection.json');
  for (const c of jeu.projections) {
    it(c.nom, () => {
      const r = projeter({ stock: c.stock, aujourdhui: c.aujourdhui, evenements: c.evenements });
      expect(r).toEqual(c.attendu);
      for (const m of c.minimum_jusqua) expect(minimumJusqua(r, c.stock, m.date)).toBe(m.attendu);
    });
  }
  for (const c of jeu.propositions) {
    it(c.nom, () => expect(proposer(c)).toEqual(c.attendu));
  }
});

describe('lots et numéros de série (jeu partagé)', () => {
  const jeu = lire('05_tracabilite.json');
  for (const c of jeu.repartitions) {
    it(c.nom, () => {
      const r = repartirLots({ quantite: c.quantite, lots: c.lots, suivi: c.suivi });
      expect(r).toEqual(c.attendu);
      for (const x of [...r.erreurs, ...r.avertissements]) expect(MESSAGES_TRACABILITE[x.code]).toBeTruthy();
    });
  }
  for (const c of jeu.dates) it(c.nom, () => expect(dateLimiteLot(c.article, { fabrication: c.fabrication, reception: c.reception })).toBe(c.attendu));
  for (const c of jeu.stocks) it(c.nom, () => expect(stockParLot({ mouvements: c.mouvements, comptages: c.comptages }, c.t)).toEqual(c.attendu));
  for (const c of jeu.propositions) it(c.nom, () => expect(proposerLots(c)).toEqual(c.attendu));
});
