import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { D, Dec, analyserReference, ErreurCalcul } from '@logibtp/socle';
import { egal } from '@logibtp/socle/testing';
import { Portees, executerScript, modifierDeclaration, litteral } from '../src/index.js';

// Jeux du langage de script partagés avec LogiBTP.Metres.Tests (CasScriptTests.cs) : un fichier par thème,
// plusieurs cas par fichier. Hôte minimal : une ligne (id 1) et un seul contexte pour les portées $ et @@.
const dossier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/scripts');

function executer(entree) {
  const donnees = structuredClone(entree.donnees ?? {});
  const portees = new Portees({ chaine: () => ['contexte'] });
  for (const [cible, v] of Object.entries(entree.variables_existantes ?? {})) {
    const r = analyserReference(cible);
    portees.affecter(r.portee, r.nom, '=', D(v), 1);
  }
  const resoudre = (texte) => {
    const r = analyserReference(texte);
    if (r.genre === 'variable') return portees.lireValeur(r.portee, r.nom, 1);
    if (!(r.colonne in donnees)) throw new ErreurCalcul('COLONNE_INCONNUE', `Colonne inconnue ${r.colonne}`);
    const v = donnees[r.colonne];
    return typeof v === 'number' ? D(v) : v;
  };
  const ecrivables = entree.ecrivables ?? [];
  const ecrire = (ref, valeur) => {
    if (!ecrivables.includes(ref)) throw new ErreurCalcul('ECRITURE_INTERDITE', `{{${ref}}} ne peut pas être modifié`);
    donnees[ref] = valeur;
  };
  const script = Array.isArray(entree.script) ? entree.script.join('\n') : entree.script;
  return { r: executerScript(script, { resoudre, ecrire, portees, ligneId: 1 }), portees, donnees };
}

function comparer(attendu, { r, portees, donnees }) {
  const fautes = [];
  if (!egal(attendu.resultat ?? null, r.resultat)) fautes.push(`resultat : attendu ${attendu.resultat}, obtenu ${r.resultat}`);
  for (const [nom, att] of Object.entries(attendu.variables ?? {})) {
    const v = r.variables.find((x) => x.nom === nom);
    if (!v) { fautes.push(`variable ${nom} : absente`); continue; }
    const champs = att !== null && typeof att === 'object' ? att : { valeur: att };
    for (const [champ, val] of Object.entries(champs)) {
      if (!egal(val, v[champ])) fautes.push(`variable ${nom}.${champ} : attendu ${JSON.stringify(val)}, obtenu ${JSON.stringify(v[champ])}`);
    }
  }
  if (attendu.nb_variables !== undefined && r.variables.length !== attendu.nb_variables) {
    fautes.push(`nb_variables : attendu ${attendu.nb_variables}, obtenu ${r.variables.length}`);
  }
  for (const [cible, v] of Object.entries(attendu.portees ?? {})) {
    const ref = analyserReference(cible);
    const valeur = portees.lireValeur(ref.portee, ref.nom, 1);
    const obtenu = valeur instanceof Dec ? valeur.toString() : valeur;
    if (!egal(v, obtenu)) fautes.push(`portée ${cible} : attendu ${v}, obtenu ${obtenu}`);
  }
  for (const [col, v] of Object.entries(attendu.donnees ?? {})) {
    if (!egal(v, donnees[col])) fautes.push(`donnée ${col} : attendu ${JSON.stringify(v)}, obtenu ${JSON.stringify(donnees[col])}`);
  }
  const erreurs = r.erreurs.map((e) => ({ code: e.code, ligne: e.ligne, colonne: e.colonne }));
  const attErreurs = (attendu.erreurs ?? []).map((e) => ({ code: e.code, ligne: e.ligne, colonne: e.colonne }));
  if (JSON.stringify(erreurs) !== JSON.stringify(attErreurs)) {
    fautes.push(`erreurs : attendu ${JSON.stringify(attErreurs)}, obtenu ${JSON.stringify(r.erreurs)}`);
  }
  const avert = r.avertissements.map((a) => a.code);
  if (JSON.stringify(avert) !== JSON.stringify(attendu.avertissements ?? [])) {
    fautes.push(`avertissements : attendu ${JSON.stringify(attendu.avertissements ?? [])}, obtenu ${JSON.stringify(avert)}`);
  }
  return fautes;
}

describe('Script de métré : jeux partagés', () => {
  for (const fichier of fs.readdirSync(dossier).filter((f) => f.endsWith('.json')).sort()) {
    const jeu = JSON.parse(fs.readFileSync(path.join(dossier, fichier), 'utf8'));
    describe(`${fichier} – ${jeu.nom}`, () => {
      for (const cas of jeu.cas) {
        it(cas.nom, () => expect(comparer(cas.attendu, executer(cas.entree))).toEqual([]));
      }
    });
  }
});

describe('Script de métré : édition depuis la grille', () => {
  it('remplace la valeur par défaut d\'une déclaration', () => {
    const t = 'MaLargeur est un numérique = 1.500 // largeur\nRenvoyer MaLargeur';
    expect(modifierDeclaration(t, 'MaLargeur', litteral('2,4', 'N'))).toBe('MaLargeur est un numérique = 2.4 // largeur\nRenvoyer MaLargeur');
  });
  it('ajoute une valeur par défaut absente', () => {
    const t = 'Nom est une chaîne\nRenvoyer 1';
    expect(modifierDeclaration(t, 'Nom', litteral('Dit "x"', 'C'))).toBe('Nom est une chaîne = "Dit ""x"""\nRenvoyer 1');
  });
  it('booléen et variable inconnue', () => {
    const t = 'Std est un booléen = Vrai\nRenvoyer 1';
    expect(modifierDeclaration(t, 'Std', litteral(false, 'B'))).toBe('Std est un booléen = Faux\nRenvoyer 1');
    expect(modifierDeclaration(t, 'Autre', 'Vrai')).toBe(t);
  });
});
