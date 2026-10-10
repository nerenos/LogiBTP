import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { D, analyserReference, ErreurCalcul } from '@logibtp/socle';
import { lireCas, verifier, egal } from '@logibtp/socle/testing';
import { Portees, EvaluateurMetre, evaluerVariable, parOrdre } from '../src/index.js';

// Jeux partagés avec LogiBTP.Metre.Tests (xUnit) : le module se teste sans document hôte.
// Hôte minimal : une ligne (id 1) et un seul contexte pour les portées $ et @@.
const dossier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas');

function executer(entree) {
  const e = structuredClone(entree);
  const portees = new Portees({ chaine: () => ['contexte'] });
  for (const [cible, v] of Object.entries(e.variables_existantes ?? {})) {
    const r = analyserReference(cible);
    portees.affecter(r.portee, r.nom, '=', D(v), 1);
  }
  const resolveur = (texte) => {
    const r = analyserReference(texte);
    if (r.genre === 'variable') return portees.lire(r.portee, r.nom, 1);
    if (!(r.colonne in (e.donnees ?? {}))) throw new ErreurCalcul('COLONNE_INCONNUE', `Colonne inconnue ${r.colonne}`);
    return D(e.donnees[r.colonne]);
  };
  const evaluateur = new EvaluateurMetre({ resolveur, affecter: (p, n, v) => portees.affecter(p, n, '=', v, 1) });
  evaluateur.evaluer(e.metre, e.metre_lignes);
  for (const d of [...(e.definitions ?? [])].sort(parOrdre)) evaluerVariable(d, { resolveur, portees, ligneId: 1 });
  return { ...e, portees };
}

describe('Module Métré : jeux de test partagés', () => {
  for (const { fichier, cas } of lireCas(dossier)) {
    it(`${fichier} – ${cas.nom}`, () => {
      const a = cas.attendu;
      if (a.erreur) {
        let code = null;
        try { executer(cas.entree); } catch (err) { code = err.code; }
        expect(code).toBe(a.erreur);
        return;
      }
      const r = executer(cas.entree);
      const fautes = [];
      if (!egal(a.mtr_resultat, r.metre.mtr_resultat)) fautes.push(`mtr_resultat : attendu ${a.mtr_resultat}, obtenu ${r.metre.mtr_resultat}`);
      for (const [id, att] of Object.entries(a.metre_lignes ?? {})) verifier(att, r.metre_lignes.find((x) => x.mli_id === Number(id)), `metre_lignes[${id}]`, fautes);
      for (const [id, att] of Object.entries(a.definitions ?? {})) verifier(att, r.definitions.find((x) => x.var_id === Number(id)), `definitions[${id}]`, fautes);
      for (const [cible, v] of Object.entries(a.variables ?? {})) {
        const ref = analyserReference(cible);
        const obtenu = r.portees.lire(ref.portee, ref.nom, 1).toString();
        if (!egal(v, obtenu)) fautes.push(`variable ${cible} : attendu ${v}, obtenu ${obtenu}`);
      }
      expect(fautes).toEqual([]);
    });
  }
});
