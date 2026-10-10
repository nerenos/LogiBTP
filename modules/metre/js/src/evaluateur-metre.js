import { D, S, ZERO, arr6, evaluerExpression, ErreurCalcul, analyserCibleVariable } from '@logibtp/socle';

/**
 * Évaluation d'un métré (section 8 de l'analyse). Classe mère du module Métré.
 * Les niveaux de sous-détail fixent l'ordre d'exécution : le niveau le plus bas est calculé en premier,
 * dans l'ordre des lignes, puis on remonte niveau par niveau jusqu'au résultat. Dans un niveau,
 * chaque ligne s'applique au cumul précédent, sans priorité mathématique.
 *
 * options = {
 *   resolveur(reference) → décimal : valeur d'une référence {{...}} d'une formule,
 *   affecter(portee, nom, valeur)  : affectation d'une valeur à une variable (@surface…),
 * }
 * Points de spécialisation : appliquer, valeurFormule, arrondir.
 */
export class EvaluateurMetre {
  constructor({ resolveur, affecter }) {
    this.resolveur = resolveur;
    this.affecterVariable = affecter;
  }

  /** Applique l'opérateur d'une ligne au cumul. La première ligne d'un niveau initialise le cumul. */
  appliquer(cumul, operateur, v) {
    if (cumul === null) return operateur === '-' ? v.neg() : v;
    switch (operateur ?? '+') {
      case '+': return cumul.plus(v);
      case '-': return cumul.minus(v);
      case '*': return cumul.times(v);
      case '/':
        if (v.isZero()) throw new ErreurCalcul('DIVISION_ZERO', 'Division par zéro');
        return cumul.div(v);
      default: throw new ErreurCalcul('OPERATION_INVALIDE', `Opérateur inconnu « ${operateur} »`);
    }
  }

  valeurFormule(ligne) {
    return evaluerExpression(ligne.mli_formule, this.resolveur);
  }

  arrondir(v) {
    return arr6(v);
  }

  affecter(cible, v) {
    if (!cible) return;
    const c = analyserCibleVariable(cible);
    this.affecterVariable(c.portee, c.nom, v);
  }

  /** Évalue le métré ; renseigne mli_valeur et mtr_resultat, renvoie le résultat. */
  evaluer(metre, lignesMetre) {
    const lignes = lignesMetre.filter((x) => x.mli_mtr_id === metre.mtr_id);
    for (const x of lignes) x.mli_valeur = null;
    metre.mtr_resultat = null;

    const enfants = new Map();
    for (const x of lignes) {
      const p = x.mli_parent_id ?? null;
      if (!enfants.has(p)) enfants.set(p, []);
      enfants.get(p).push(x);
    }
    for (const liste of enfants.values()) liste.sort((a, b) => (a.mli_ordre - b.mli_ordre) || (a.mli_id - b.mli_id));

    const groupes = [];
    const parcourir = (parentId, profondeur) => {
      const liste = enfants.get(parentId) ?? [];
      if (parentId === null || liste.length > 0) groupes.push({ parentId, liste, profondeur });
      for (const x of liste) parcourir(x.mli_id, profondeur + 1);
    };
    parcourir(null, 1);

    const resultatsEnfants = new Map();
    const evaluerNiveau = (liste) => {
      let cumul = null;
      for (let i = 0; i < liste.length; i++) {
        const x = liste[i];
        try {
          if (x.mli_type === 'S') {
            let v;
            if (x.mli_st_depuis_id === null || x.mli_st_depuis_id === undefined) v = cumul ?? ZERO;
            else {
              const j = liste.findIndex((y) => y.mli_id === x.mli_st_depuis_id);
              if (j < 0 || j >= i || liste[j].mli_type !== 'S') {
                throw new ErreurCalcul('METRE_SOUS_TOTAL', 'Le sous-total pointé doit être un sous-total précédent du même niveau');
              }
              let c = null;
              for (let k = j + 1; k < i; k++) {
                if (liste[k].mli_type === 'S') continue;
                c = this.appliquer(c, liste[k].mli_operateur, D(liste[k].mli_valeur));
              }
              v = c ?? ZERO;
            }
            v = this.arrondir(v);
            x.mli_valeur = S(v);
            this.affecter(x.mli_variable, v);
            continue;
          }
          let v = x.mli_type === 'D' ? (resultatsEnfants.get(x.mli_id) ?? ZERO) : this.valeurFormule(x);
          v = this.arrondir(v);
          x.mli_valeur = S(v);
          cumul = this.appliquer(cumul, x.mli_operateur, v);
          this.affecter(x.mli_variable, v);
        } catch (e) {
          if (e instanceof ErreurCalcul) throw new ErreurCalcul(e.code, `Métré, ligne ${x.mli_ordre} : ${e.message}`);
          throw e;
        }
      }
      return cumul ?? ZERO;
    };

    const profondeurMax = Math.max(...groupes.map((g) => g.profondeur));
    let resultat = ZERO;
    for (let p = profondeurMax; p >= 1; p--) {
      for (const g of groupes) {
        if (g.profondeur !== p) continue;
        const r = this.arrondir(evaluerNiveau(g.liste));
        if (g.parentId === null) resultat = r;
        else resultatsEnfants.set(g.parentId, r);
      }
    }

    metre.mtr_resultat = S(resultat);
    this.affecter(metre.mtr_variable, resultat);
    return resultat;
  }
}
