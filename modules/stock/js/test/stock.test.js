import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockA, ecartComptage, valoriser, valeurUnitaire, controlerLot, MESSAGES_INVENTAIRE } from '../src/index.js';

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

describe("contrôle d'un lot d'inventaire (jeu partagé)", () => {
  for (const c of lire('03_inventaire.json').cas) {
    it(c.nom, () => {
      const r = controlerLot({ lignes: c.lignes });
      expect(r).toEqual(c.attendu);
      for (const x of [...r.erreurs, ...r.avertissements]) expect(MESSAGES_INVENTAIRE[x.code]).toBeTruthy();
    });
  }
});
