import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lireCas, verifier, verifierErreurs } from '@logibtp/socle/testing';
import { calculerDocument, comparerResultats } from '../src/calcul/index.js';

// Jeux de test du cœur BTP, partagés avec LogiBTP.Calcul.Tests (xUnit) : tests/cas/*.json.
const dossierCas = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas');
const tous = lireCas(dossierCas);

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
  verifierErreurs(a.erreurs, res.erreurs, fautes);
  if (a.avertissements) verifierErreurs(a.avertissements, res.avertissements, fautes);
  // Ventilation des frais annexes : détail (tranche, ligne, montant) et bilan par tranche.
  if (a.ventilations_lignes) {
    const obtenu = res.ventilations_lignes.map((v) => [v.vfl_source_lig_id, v.vfl_lig_id, Number(v.vfl_montant)]);
    const attendu = a.ventilations_lignes.map((v) => [v.vfl_source_lig_id, v.vfl_lig_id, Number(v.vfl_montant)]);
    if (JSON.stringify(obtenu) !== JSON.stringify(attendu)) fautes.push(`ventilations_lignes : attendu ${JSON.stringify(attendu)}, obtenu ${JSON.stringify(obtenu)}`);
  }
  for (const [id, att] of Object.entries(a.frais_annexes ?? {})) verifier(att, res.frais_annexes.find((f) => f.lig_id === Number(id)), `frais_annexes[${id}]`, fautes);
  if (a.document) verifier(a.document, res.document, 'document', fautes);
  for (const [cle, att] of Object.entries(a.lignes ?? {})) verifier(att, trouverLigne(res.lignes, cle), `lignes[${cle}]`, fautes);
  for (const [id, att] of Object.entries(a.metres ?? {})) verifier(att, res.metres.find((m) => m.mtr_id === Number(id)), `metres[${id}]`, fautes);
  for (const [id, att] of Object.entries(a.variables ?? {})) verifier(att, res.variables.find((v) => v.var_id === Number(id)), `variables[${id}]`, fautes);
  for (const att of a.tva ?? []) verifier(att, res.tva.find((t) => t.tva_code === att.tva_code), `tva[${att.tva_code}]`, fautes);
  return fautes;
}

describe('Cœur BTP : jeux de test partagés du moteur de calcul', () => {
  for (const { fichier, cas } of tous) {
    it(`${fichier} – ${cas.nom}`, () => {
      const res = calculerDocument(cas.entree);
      expect(controlerCas(cas, res)).toEqual([]);
    });

    it(`${fichier} – stabilité : recalculer le résultat ne change rien`, () => {
      const r1 = calculerDocument(cas.entree);
      const r2 = calculerDocument({
        ...cas.entree,
        document: r1.document, lignes: r1.lignes, metres: r1.metres, variables: r1.variables, ventilations: r1.ventilations,
      });
      expect(comparerResultats(r1, r2)).toEqual([]);
    });
  }

  it('ne modifie pas l\'entrée', () => {
    const { cas } = tous[0];
    const copie = structuredClone(cas.entree);
    calculerDocument(cas.entree);
    expect(cas.entree).toEqual(copie);
  });
});
