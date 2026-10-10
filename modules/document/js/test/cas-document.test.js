import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lireCas, verifier, verifierErreurs } from '@logibtp/socle/testing';
import { calculerDocument, comparerResultats } from '../src/index.js';

// Jeux du module Document (moteur générique), partagés avec LogiBTP.Document.Tests (xUnit).
const dossier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas');

describe('Module Document : jeux de test partagés du moteur générique', () => {
  for (const { fichier, cas } of lireCas(dossier)) {
    it(`${fichier} – ${cas.nom}`, () => {
      const res = calculerDocument(cas.entree);
      const a = cas.attendu;
      const fautes = [];
      verifierErreurs(a.erreurs, res.erreurs, fautes);
      if (a.document) verifier(a.document, res.document, 'document', fautes);
      for (const [id, att] of Object.entries(a.lignes ?? {})) verifier(att, res.lignes.find((l) => l.lig_id === Number(id)), `lignes[${id}]`, fautes);
      for (const att of a.tva ?? []) verifier(att, res.tva.find((t) => t.tva_code === att.tva_code), `tva[${att.tva_code}]`, fautes);
      expect(fautes).toEqual([]);
    });

    it(`${fichier} – stabilité`, () => {
      const r1 = calculerDocument(cas.entree);
      const r2 = calculerDocument({ ...cas.entree, document: r1.document, lignes: r1.lignes });
      expect(comparerResultats(r1, r2)).toEqual([]);
    });
  }
});
