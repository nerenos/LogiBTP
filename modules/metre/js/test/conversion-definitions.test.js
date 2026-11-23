import { describe, it, expect } from 'vitest';
import { D, analyserReference } from '@logibtp/socle';
import { Portees, evaluerVariable, evaluerScriptMetre, scriptDepuisDefinitions } from '../src/index.js';

// Conversion des définitions $ d'une tranche en script de métré (création du métré d'une tranche) : même calcul.
// Hôte : tranche 2 dans la tranche 1 (portée $ : [2, 1]), $Base = 10 sur la tranche 1.
function hote() {
  const portees = new Portees({ chaine: (p, ligneId) => (p === '$' ? (ligneId === 2 ? [2, 1] : [1]) : []) });
  portees.affecter('$', 'Base', '=', D(10), 1);
  const resoudre = (texte) => {
    const r = analyserReference(texte);
    return r.genre === 'variable' ? portees.lireValeur(r.portee, r.nom, 2) : D(0);
  };
  return { portees, resoudre };
}

const definitions = [
  { var_id: 1, var_ordre: 1, var_portee: '$', var_nom: 'Hauteur', var_operation: '=', var_formule: '2,5' },
  { var_id: 2, var_ordre: 2, var_portee: '$', var_nom: 'Surface', var_operation: '=', var_formule: '{{$Hauteur}} × {{$Base}}' },
  { var_id: 3, var_ordre: 3, var_portee: '$', var_nom: 'Base', var_operation: '+=', var_formule: '1' },
  { var_id: 4, var_ordre: 4, var_portee: '$', var_nom: 'Surface', var_operation: '+=', var_formule: '0,5 * 2' },
  { var_id: 5, var_ordre: 5, var_portee: '$', var_nom: 'Lot', var_operation: '=', var_formule: '({{$Surface}} − 1) / 5' },
];

const lire = (portees, nom) => String(portees.lireValeur('$', nom, 2));

describe('Conversion des définitions $ en script', () => {
  it('produit un script lisible : déclarations, affectations, incrément de la tranche parente', () => {
    expect(scriptDepuisDefinitions(definitions, { commentaire: 'Métré de la tranche', renvoyer: '1' })).toBe([
      '// Métré de la tranche',
      'Hauteur est un numérique = 2.5',
      'Surface est un numérique',
      'Lot est un numérique',
      '',
      'Surface = Hauteur * {{$Base}}',
      '$Base += 1',
      'Surface += 0.5 * 2',
      'Lot = (Surface - 1) / 5',
      '',
      'Renvoyer 1',
    ].join('\n'));
  });

  it('donne le même résultat que les définitions', () => {
    const a = hote();
    for (const v of definitions) evaluerVariable(v, { resolveur: (t) => a.portees.lire(analyserReference(t).portee, analyserReference(t).nom, 2), portees: a.portees, ligneId: 2 });
    const b = hote();
    const r = evaluerScriptMetre({ mtr_id: 1, mtr_lig_id: 2, mtr_script: scriptDepuisDefinitions(definitions, { renvoyer: '1' }) },
      { resoudre: b.resoudre, portees: b.portees, ligneId: 2, publication: '$' });
    expect(r.erreurs).toEqual([]);
    for (const nom of ['Hauteur', 'Surface', 'Base', 'Lot']) expect(lire(b.portees, nom)).toBe(lire(a.portees, nom));
    expect(lire(b.portees, 'Lot')).toBe('5');
  });

  it('garde la référence à une variable parente lue avant sa définition locale, et la portée d\'un mot du langage', () => {
    const defs = [
      { var_id: 1, var_ordre: 1, var_nom: 'Copie', var_operation: '=', var_formule: '{{$Base}} + 1' },
      { var_id: 2, var_ordre: 2, var_nom: 'Base', var_operation: '=', var_formule: '{{$Base}} * 2' },
      { var_id: 3, var_ordre: 3, var_nom: 'Fin', var_operation: '=', var_formule: '{{$Base}}' },
    ];
    const s = scriptDepuisDefinitions(defs);
    expect(s).toBe(['Copie est un numérique', 'Base est un numérique', '', 'Copie = {{$Base}} + 1', 'Base = {{$Base}} * 2', '$Fin = Base'].join('\n'));
    const a = hote();
    for (const v of defs) evaluerVariable({ ...v, var_portee: '$' }, { resolveur: (t) => a.portees.lire('$', analyserReference(t).nom, 2), portees: a.portees, ligneId: 2 });
    const b = hote();
    evaluerScriptMetre({ mtr_id: 1, mtr_lig_id: 2, mtr_script: s }, { resoudre: b.resoudre, portees: b.portees, ligneId: 2, publication: '$' });
    for (const nom of ['Copie', 'Base', 'Fin']) expect(lire(b.portees, nom)).toBe(lire(a.portees, nom));
  });
});
