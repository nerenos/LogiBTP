import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculerDocument, comparerResultats, evaluerExpression, ErreurCalcul, D } from '../src/calcul/index.js';
import { analyserReference } from '../src/calcul/references.js';

// Jeux de test partagés avec LogiBTP.Calcul.Tests (xUnit) : tests/cas/*.json et tests/expressions.json.
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests');
const dossierCas = path.join(racine, 'cas');
const fichiers = fs.readdirSync(dossierCas).filter((f) => f.endsWith('.json')).sort();

function egal(attendu, obtenu) {
  if (attendu === null) return obtenu === null || obtenu === undefined;
  if (typeof attendu === 'number') return obtenu !== null && obtenu !== undefined && D(obtenu).eq(attendu);
  return obtenu === attendu;
}

function verifier(attendu, obtenu, chemin, fautes) {
  if (!obtenu) { fautes.push(`${chemin} : introuvable`); return; }
  for (const [champ, v] of Object.entries(attendu)) {
    if (!egal(v, obtenu[champ])) fautes.push(`${chemin}.${champ} : attendu ${JSON.stringify(v)}, obtenu ${JSON.stringify(obtenu[champ] ?? null)}`);
  }
}

function trouverLigne(lignes, cle) {
  if (cle.startsWith('ecart:')) {
    const parent = Number(cle.slice(6));
    return lignes.find((l) => l.lig_is_ecart_arrondi && l.lig_parent_id === parent);
  }
  return lignes.find((l) => l.lig_id === Number(cle));
}

export function controlerCas(cas, res) {
  const a = cas.attendu;
  const fautes = [];
  const codes = res.erreurs.map((e) => e.code).sort();
  const codesAttendus = [...(a.erreurs ?? [])].sort();
  if (JSON.stringify(codes) !== JSON.stringify(codesAttendus)) {
    fautes.push(`erreurs : attendu ${JSON.stringify(codesAttendus)}, obtenu ${JSON.stringify(res.erreurs)}`);
  }
  if (a.document) verifier(a.document, res.document, 'document', fautes);
  for (const [cle, att] of Object.entries(a.lignes ?? {})) verifier(att, trouverLigne(res.lignes, cle), `lignes[${cle}]`, fautes);
  for (const [id, att] of Object.entries(a.metres ?? {})) verifier(att, res.metres.find((m) => m.mtr_id === Number(id)), `metres[${id}]`, fautes);
  for (const [id, att] of Object.entries(a.metre_lignes ?? {})) verifier(att, res.metre_lignes.find((m) => m.mli_id === Number(id)), `metre_lignes[${id}]`, fautes);
  for (const [id, att] of Object.entries(a.variables ?? {})) verifier(att, res.variables.find((v) => v.var_id === Number(id)), `variables[${id}]`, fautes);
  for (const att of a.tva ?? []) verifier(att, res.tva.find((t) => t.tva_code === att.tva_code), `tva[${att.tva_code}]`, fautes);
  return fautes;
}

describe('Jeux de test partagés du moteur de calcul', () => {
  for (const f of fichiers) {
    const cas = JSON.parse(fs.readFileSync(path.join(dossierCas, f), 'utf8'));

    it(`${f} – ${cas.nom}`, () => {
      const res = calculerDocument(cas.entree);
      expect(controlerCas(cas, res)).toEqual([]);
    });

    it(`${f} – stabilité : recalculer le résultat ne change rien`, () => {
      const r1 = calculerDocument(cas.entree);
      const r2 = calculerDocument({
        ...cas.entree,
        document: r1.document, lignes: r1.lignes, metres: r1.metres, metre_lignes: r1.metre_lignes, variables: r1.variables,
      });
      expect(comparerResultats(r1, r2)).toEqual([]);
    });
  }

  it('ne modifie pas l\'entrée', () => {
    const cas = JSON.parse(fs.readFileSync(path.join(dossierCas, fichiers[0]), 'utf8'));
    const copie = structuredClone(cas.entree);
    calculerDocument(cas.entree);
    expect(cas.entree).toEqual(copie);
  });
});

describe('Analyseur d\'expressions', () => {
  const jeu = JSON.parse(fs.readFileSync(path.join(racine, 'expressions.json'), 'utf8'));
  const resoudre = (ref) => {
    const r = analyserReference(ref);
    const cle = r.genre === 'variable' ? r.portee + r.nom : r.colonne;
    if (!(cle in jeu.variables)) throw new ErreurCalcul('VARIABLE_INCONNUE', `Variable {{${ref}}} non définie`);
    return D(jeu.variables[cle]);
  };
  for (const c of jeu.cas) {
    it(`« ${c.formule} »`, () => {
      if (c.erreur) {
        let code = null;
        try { evaluerExpression(c.formule, resoudre); } catch (e) { code = e.code; }
        expect(code).toBe(c.erreur);
      } else {
        expect(evaluerExpression(c.formule, resoudre).toString()).toBe(D(c.resultat).toString());
      }
    });
  }
});
