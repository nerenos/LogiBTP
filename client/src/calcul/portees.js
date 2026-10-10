import { arr6 } from './decimal.js';
import { ErreurCalcul } from './expression.js';
import { TL } from './types.js';

/**
 * Magasins de variables de calcul.
 *  $$ : document ;
 *  $  : titre parent (la ligne elle-même si c'est un titre), puis titres englobants en lecture ;
 *  @@ : ouvrage parent (la ligne elle-même si c'est un ouvrage), puis ouvrages englobants en lecture ;
 *       les composantes sœurs partagent donc le magasin de leur ouvrage ;
 *  @  : ligne courante.
 * Les valeurs sont arrondies à 6 décimales (précision de var_valeur).
 */
export class Portees {
  constructor(moteur) {
    this.m = moteur;
    this.doc = new Map();
    this.titres = new Map();
    this.ouvrages = new Map();
    this.lignes = new Map();
  }

  #magasin(genre, id, creer) {
    let mag = this[genre].get(id);
    if (!mag && creer) {
      mag = new Map();
      this[genre].set(id, mag);
    }
    return mag ?? null;
  }

  #chaine(portee, ligne, creer) {
    if (portee === '$$') return [this.doc];
    if (portee === '@') {
      if (!ligne) throw new ErreurCalcul('PORTEE', 'Variable @ hors d\'une ligne');
      return [this.#magasin('lignes', ligne.lig_id, creer)];
    }
    const type = portee === '$' ? TL.TITRE : TL.OUVRAGE;
    const genre = portee === '$' ? 'titres' : 'ouvrages';
    const chaine = [];
    for (let x = ligne; x; x = this.m.parent(x)) {
      if (x.lig_tyl_id === type) chaine.push(this.#magasin(genre, x.lig_id, creer && chaine.length === 0));
    }
    if (chaine.length === 0) {
      throw new ErreurCalcul('PORTEE', portee === '$' ? 'Aucun titre parent pour une variable $' : 'Aucun ouvrage parent pour une variable @@');
    }
    return chaine;
  }

  lire(portee, nom, ligne) {
    for (const mag of this.#chaine(portee, ligne, false)) {
      if (mag && mag.has(nom)) return mag.get(nom);
    }
    throw new ErreurCalcul('VARIABLE_INCONNUE', `Variable {{${portee}${nom}}} non définie à ce point du document`);
  }

  affecter(portee, nom, operation, valeur, ligne) {
    const v = arr6(valeur);
    if (operation === '+=') {
      const mag = this.#chaine(portee, ligne, false).find((m) => m && m.has(nom));
      if (!mag) throw new ErreurCalcul('VARIABLE_INCONNUE', `Variable {{${portee}${nom}}} non définie : incrémentation impossible`);
      const r = arr6(mag.get(nom).plus(v));
      mag.set(nom, r);
      return r;
    }
    if (operation !== '=') throw new ErreurCalcul('OPERATION_INVALIDE', `Opération inconnue « ${operation} »`);
    this.#chaine(portee, ligne, true)[0].set(nom, v);
    return v;
  }

  /** Variables lisibles depuis une ligne à ce point du calcul (aide à la saisie des formules). */
  disponibles(ligne) {
    const res = [];
    const ajouter = (portee, mag) => { if (mag) for (const [nom, v] of mag) res.push({ portee, nom, valeur: v }); };
    ajouter('$$', this.doc);
    for (let x = ligne; x; x = this.m.parent(x)) {
      if (x.lig_tyl_id === TL.TITRE) ajouter('$', this.titres.get(x.lig_id));
      if (x.lig_tyl_id === TL.OUVRAGE) ajouter('@@', this.ouvrages.get(x.lig_id));
    }
    if (ligne) ajouter('@', this.lignes.get(ligne.lig_id));
    return res;
  }
}
