import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { D, analyserReference, ErreurCalcul } from '@logibtp/socle';
import { lireCas, egal } from '@logibtp/socle/testing';
import { Portees, convertirMetre, evaluerScriptMetre } from '../src/index.js';

// Jeux de conversion des métrés en lignes, partagés avec LogiBTP.Metres.Tests (CasConversionTests.cs) : même texte
// de script des deux côtés, puis exécution du script (mêmes résultats que l'ancien évaluateur des lignes).
// Hôte minimal : une ligne (id 1) et un seul contexte pour les portées $ et @@.
const dossier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/conversion');

describe('Conversion des métrés en lignes en scripts', () => {
  for (const { fichier, cas } of lireCas(dossier)) {
    it(`${fichier} – ${cas.nom}`, () => {
      const e = structuredClone(cas.entree);
      const a = cas.attendu;
      const c = convertirMetre(e.metre, e.metre_lignes, e.definitions ?? []);
      expect(c.mtr_script.split('\n')).toEqual(a.script);
      expect(c.mtr_variable).toBe(a.mtr_variable);
      expect(c.variablesLigne.map((v) => v.var_id)).toEqual(a.variables_ligne ?? []);

      const portees = new Portees({ chaine: () => ['contexte'] });
      for (const [cible, v] of Object.entries(e.variables_existantes ?? {})) {
        const r = analyserReference(cible);
        portees.affecter(r.portee, r.nom, '=', D(v), 1);
      }
      const resoudre = (texte) => {
        const r = analyserReference(texte);
        if (r.genre === 'variable') return portees.lire(r.portee, r.nom, 1);
        if (!(r.colonne in (e.donnees ?? {}))) throw new ErreurCalcul('COLONNE_INCONNUE', `Colonne inconnue ${r.colonne}`);
        return D(e.donnees[r.colonne]);
      };
      const metre = { ...e.metre, mtr_script: c.mtr_script, mtr_variable: c.mtr_variable };
      const r = evaluerScriptMetre(metre, { resoudre, portees, ligneId: 1 });
      if (a.erreur) {
        expect(r.erreurs.map((x) => x.code)).toEqual([a.erreur]);
        return;
      }
      expect(r.erreurs).toEqual([]);
      const fautes = [];
      if (!egal(a.mtr_resultat, metre.mtr_resultat)) fautes.push(`mtr_resultat : attendu ${a.mtr_resultat}, obtenu ${metre.mtr_resultat}`);
      for (const [cible, v] of Object.entries(a.variables ?? {})) {
        const ref = analyserReference(cible);
        const obtenu = portees.lire(ref.portee, ref.nom, 1).toString();
        if (!egal(v, obtenu)) fautes.push(`variable ${cible} : attendu ${v}, obtenu ${obtenu}`);
      }
      expect(fautes).toEqual([]);
    });
  }
});
