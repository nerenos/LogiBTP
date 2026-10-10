import { D, S, ZERO, arr6 } from './decimal.js';
import { evaluerExpression, ErreurCalcul } from './expression.js';
import { analyserCibleVariable } from './references.js';

/** Applique l'opérateur d'une ligne au cumul. La première ligne d'un niveau initialise le cumul. */
function appliquer(cumul, operateur, v) {
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

/**
 * Évalue un métré (section 8 de l'analyse).
 * Les niveaux de sous-détail fixent l'ordre d'exécution : on calcule d'abord le niveau le plus bas,
 * dans l'ordre des lignes, puis on remonte niveau par niveau jusqu'au résultat.
 * Dans un niveau, chaque ligne s'applique au cumul précédent, sans priorité mathématique.
 */
export function evaluerMetre(moteur, metre, ligne) {
  const lignes = moteur.metreLignes.filter((x) => x.mli_mtr_id === metre.mtr_id);
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

  const resolveur = moteur.resolveur(ligne, 'calcul');
  const resultatsEnfants = new Map();

  const affecter = (x, v) => {
    if (!x.mli_variable) return;
    const c = analyserCibleVariable(x.mli_variable);
    moteur.portees.affecter(c.portee, c.nom, '=', v, ligne);
  };

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
              c = appliquer(c, liste[k].mli_operateur, D(liste[k].mli_valeur));
            }
            v = c ?? ZERO;
          }
          v = arr6(v);
          x.mli_valeur = S(v);
          affecter(x, v);
          continue;
        }
        let v = x.mli_type === 'D' ? (resultatsEnfants.get(x.mli_id) ?? ZERO) : evaluerExpression(x.mli_formule, resolveur);
        v = arr6(v);
        x.mli_valeur = S(v);
        cumul = appliquer(cumul, x.mli_operateur, v);
        affecter(x, v);
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
      const r = arr6(evaluerNiveau(g.liste));
      if (g.parentId === null) resultat = r;
      else resultatsEnfants.set(g.parentId, r);
    }
  }

  metre.mtr_resultat = S(resultat);
  if (metre.mtr_variable) {
    const c = analyserCibleVariable(metre.mtr_variable);
    moteur.portees.affecter(c.portee, c.nom, '=', resultat, ligne);
  }
  return resultat;
}
