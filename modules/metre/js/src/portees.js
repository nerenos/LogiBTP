import { texte } from '@logibtp/socle/dictionnaire';
import { Dec, arr6, ErreurCalcul } from '@logibtp/socle';

/**
 * Magasins de variables de calcul, indépendants de la structure du document hôte.
 *  $$ : document ;  @ : ligne courante ;
 *  autres portées ($, @@…) : contextes fournis par l'hôte, du plus proche au plus lointain
 *  (dans LogiBTP : $ = titres englobants, @@ = ouvrages englobants).
 * L'écriture vise le contexte le plus proche, la lecture remonte la chaîne. Valeurs typées : décimal (arrondi à 6
 * décimales), chaîne ou booléen (variables d'un script) ; `lire` exige un décimal (formules), `lireValeur` non.
 *
 * hote = {
 *   chaine(portee, ligneId) → identifiants des contextes (tableau vide si aucun),
 *   messagePortee?(portee) → message d'erreur quand la portée n'a pas de contexte,
 * }
 * Classe mère : un module peut la spécialiser (nouvelles portées, règles de visibilité).
 */
export class Portees {
  constructor(hote) {
    this.hote = hote;
    this.magasins = new Map();
  }

  magasin(cle, creer) {
    let m = this.magasins.get(cle);
    if (!m && creer) {
      m = new Map();
      this.magasins.set(cle, m);
    }
    return m ?? null;
  }

  /** Clés des magasins à parcourir pour une portée, du plus proche au plus lointain. */
  cles(portee, ligneId) {
    if (portee === '$$') return ['$$'];
    if (portee === '@') {
      if (ligneId === null || ligneId === undefined) throw new ErreurCalcul('PORTEE', texte('metre.portees.hors_ligne'));
      return [`@:${ligneId}`];
    }
    const contextes = this.hote.chaine(portee, ligneId) ?? [];
    if (contextes.length === 0) {
      throw new ErreurCalcul('PORTEE', this.hote.messagePortee?.(portee) ?? texte('metre.portees.sans_contexte', { portee }));
    }
    return contextes.map((c) => `${portee}:${c}`);
  }

  /** Valeur typée d'une variable : décimal, chaîne ou booléen. */
  lireValeur(portee, nom, ligneId) {
    for (const cle of this.cles(portee, ligneId)) {
      const m = this.magasin(cle, false);
      if (m && m.has(nom)) return m.get(nom);
    }
    throw new ErreurCalcul('VARIABLE_INCONNUE', texte('metre.portees.non_definie', { reference: `{{${portee}${nom}}}` }));
  }

  /** Valeur numérique d'une variable (formules, quantités) : une chaîne ou un booléen est une erreur TYPE. */
  lire(portee, nom, ligneId) {
    const v = this.lireValeur(portee, nom, ligneId);
    if (!(v instanceof Dec)) throw new ErreurCalcul('TYPE', texte('metre.portees.numerique', { reference: `{{${portee}${nom}}}` }));
    return v;
  }

  /** `=` : décimal, chaîne ou booléen ; `+=` : décimaux seulement. */
  affecter(portee, nom, operation, valeur, ligneId) {
    const v = typeof valeur === 'string' || typeof valeur === 'boolean' ? valeur : arr6(valeur);
    const cles = this.cles(portee, ligneId);
    if (operation === '+=') {
      const m = cles.map((c) => this.magasin(c, false)).find((x) => x && x.has(nom));
      if (!m) throw new ErreurCalcul('VARIABLE_INCONNUE', texte('metre.portees.increment', { reference: `{{${portee}${nom}}}` }));
      if (!(m.get(nom) instanceof Dec) || !(v instanceof Dec)) throw new ErreurCalcul('TYPE', texte('metre.portees.numerique', { reference: `{{${portee}${nom}}}` }));
      const r = arr6(m.get(nom).plus(v));
      m.set(nom, r);
      return r;
    }
    if (operation !== '=') throw new ErreurCalcul('OPERATION_INVALIDE', texte('metre.portees.operation', { operation }));
    this.magasin(cles[0], true).set(nom, v);
    return v;
  }
}
