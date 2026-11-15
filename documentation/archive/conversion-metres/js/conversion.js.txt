import { referencesDe, analyserReference } from '@logibtp/socle';
import { parOrdre } from './variables.js';

// Conversion des métrés saisis en lignes (valeurs V, sous-détails D, sous-totaux S, onglet Définition) en scripts
// (réplique de ConversionMetre.cs : même texte produit). Reproduit l'évaluation des lignes : niveau le plus bas
// d'abord, dans l'ordre des lignes ; dans un niveau, chaque ligne s'applique au cumul sans priorité mathématique
// (d'où les parenthèses) ; chaque valeur de ligne est arrondie à 6 décimales (variable locale numérique).

/** Colonnes calculées après la quantité : une définition qui les lit reste une variable de ligne. */
const COLONNES_APRES_QUANTITE = new Set(['lig_qte_vendue', 'lig_qte_totale', 'lig_qte_base']);

const commentaire = (texte) => {
  const t = (texte ?? '').replace(/\s+/g, ' ').trim();
  return t ? ` // ${t}` : '';
};

/** Ligne convertie en 0 (formule vide, sous-total pointé invalide) : commentaire d'avertissement. */
const avertissement = (x) => {
  const c = commentaire(x.mli_commentaire);
  return ` // ⚠ ${x.mli_type === 'S' ? 'sous-total pointé invalide' : 'formule vide'} dans le métré d'origine${c ? ` – ${c.slice(4)}` : ''}`;
};

const litDonneeApresQuantite = (formule) => {
  try {
    return referencesDe(formule).some((r) => {
      const ref = analyserReference(r);
      return ref.genre === 'donnee' && COLONNES_APRES_QUANTITE.has(ref.colonne);
    });
  } catch {
    return false;
  }
};

/** Enchaînement des valeurs d'un niveau, de gauche à droite sans priorité : ((a + b) * c). */
function enchainer(lignes, nom) {
  let texte = null;
  let additif = false;
  for (const x of lignes) {
    const op = x.mli_operateur ?? '+';
    if (texte === null) {
      texte = op === '-' ? `-${nom.get(x.mli_id)}` : nom.get(x.mli_id);
      continue;
    }
    if (op === '*' || op === '/') {
      texte = `${additif ? `(${texte})` : texte} ${op} ${nom.get(x.mli_id)}`;
      additif = false;
    } else {
      texte = `${texte} ${op} ${nom.get(x.mli_id)}`;
      additif = true;
    }
  }
  return texte ?? '0';
}

/**
 * Convertit un métré en lignes. `definitions` : variables de l'onglet Définition du métré (var_mtr_id).
 * Renvoie { mtr_script, mtr_variable, variablesLigne } : les définitions sont reprises dans le script, sauf à partir
 * de la première qui lit une quantité calculée (lig_qte_vendue…) : celle-ci et les suivantes deviennent des variables
 * de ligne (var_mtr_id null), toujours évaluées après la quantité.
 */
export function convertirMetre(metre, lignesMetre, definitions = []) {
  const lignes = lignesMetre.filter((x) => x.mli_mtr_id === metre.mtr_id);
  const enfants = new Map();
  for (const x of lignes) {
    const p = x.mli_parent_id ?? null;
    if (!enfants.has(p)) enfants.set(p, []);
    enfants.get(p).push(x);
  }
  for (const liste of enfants.values()) liste.sort((a, b) => (a.mli_ordre - b.mli_ordre) || (a.mli_id - b.mli_id));

  // Noms : position dans l'arbre (L1, L2_1…) ; groupes en ordre préfixe avec leur profondeur.
  const nom = new Map();
  const groupes = [];
  const parcourir = (parentId, prefixe, profondeur) => {
    const liste = enfants.get(parentId) ?? [];
    if (parentId === null || liste.length > 0) groupes.push({ parentId, liste, profondeur });
    liste.forEach((x, k) => {
      const n = `${prefixe}${k + 1}`;
      nom.set(x.mli_id, n);
      parcourir(x.mli_id, `${n}_`, profondeur + 1);
    });
  };
  parcourir(null, 'L', 1);

  const defs = [...definitions].sort(parOrdre);
  const k = defs.findIndex((d) => litDonneeApresQuantite(d.var_formule));
  const enScript = k < 0 ? defs : defs.slice(0, k);
  const variablesLigne = (k < 0 ? [] : defs.slice(k)).map((d) => ({ ...d, var_mtr_id: null, var_lig_id: metre.mtr_lig_id }));

  // Instructions dans l'ordre d'évaluation : [nom, expression, commentaire, variable affectée].
  const instructions = [];
  const resultatGroupe = new Map();
  const profondeurMax = Math.max(...groupes.map((g) => g.profondeur));
  let racine = '0';
  for (let p = profondeurMax; p >= 1; p--) {
    for (const g of groupes) {
      if (g.profondeur !== p) continue;
      g.liste.forEach((x, i) => {
        let expr;
        if (x.mli_type === 'S') {
          let depuis = 0;
          if (x.mli_st_depuis_id !== null && x.mli_st_depuis_id !== undefined) {
            const j = g.liste.findIndex((y) => y.mli_id === x.mli_st_depuis_id);
            depuis = j < 0 || j >= i || g.liste[j].mli_type !== 'S' ? -1 : j + 1;
          }
          expr = depuis < 0 ? null : enchainer(g.liste.slice(depuis, i).filter((y) => y.mli_type !== 'S'), nom);
        } else if (x.mli_type === 'D') expr = resultatGroupe.get(x.mli_id) ?? '0';
        else expr = (x.mli_formule ?? '').trim() || null;
        instructions.push({
          nom: nom.get(x.mli_id),
          expr: expr ?? '0',
          commentaire: expr === null ? avertissement(x) : commentaire(x.mli_commentaire),
          variable: x.mli_variable?.trim() || null,
        });
      });
      const r = enchainer(g.liste.filter((y) => y.mli_type !== 'S'), nom);
      if (g.parentId === null) racine = r;
      else resultatGroupe.set(g.parentId, r);
    }
  }

  const avecDefinitions = enScript.length > 0;
  const affectations = avecDefinitions || instructions.some((x) => x.variable);
  const texte = ['// Métré converti depuis la saisie en lignes (valeurs, sous-détails, sous-totaux).'];
  if (!affectations) {
    for (const x of instructions) texte.push(`local ${x.nom} est un numérique = ${x.expr}${x.commentaire}`);
    texte.push(`Renvoyer ${racine}`);
    return { mtr_script: texte.join('\n'), mtr_variable: metre.mtr_variable ?? null, variablesLigne };
  }
  for (const x of instructions) texte.push(`local ${x.nom} est un numérique`);
  if (avecDefinitions) texte.push('local Resultat est un numérique');
  texte.push('');
  for (const x of instructions) {
    texte.push(`${x.nom} = ${x.expr}${x.commentaire}`);
    if (x.variable) texte.push(`${x.variable} = ${x.nom}`);
  }
  if (!avecDefinitions) {
    texte.push(`Renvoyer ${racine}`);
    return { mtr_script: texte.join('\n'), mtr_variable: metre.mtr_variable ?? null, variablesLigne };
  }
  // Définitions : évaluées après le résultat (affecté d'abord à la variable du métré).
  texte.push(`Resultat = ${racine}`);
  if (metre.mtr_variable) texte.push(`${metre.mtr_variable.trim()} = Resultat`);
  texte.push('', '// Variables définies par le métré');
  for (const d of enScript) texte.push(`${d.var_portee}${d.var_nom} ${d.var_operation ?? '='} ${(d.var_formule ?? '').trim() || '0'}`);
  texte.push(`Renvoyer Resultat`);
  return { mtr_script: texte.join('\n'), mtr_variable: null, variablesLigne };
}

/**
 * Convertit les métrés en lignes d'un contenu { metres, metre_lignes, variables } (document, composition d'ouvrage) :
 * renvoie { metres, variables } sans lignes de métré. Les métrés déjà en script sont inchangés.
 */
export function convertirContenu({ metres = [], metre_lignes: lignes = [], variables = [] }) {
  const aConvertir = new Set(metres.filter((m) => typeof m.mtr_script !== 'string').map((m) => m.mtr_id));
  const ajoutees = [];
  const nouveaux = metres.map((m) => {
    if (!aConvertir.has(m.mtr_id)) return m;
    const c = convertirMetre(m, lignes, variables.filter((v) => v.var_mtr_id === m.mtr_id));
    ajoutees.push(...c.variablesLigne);
    return { ...m, mtr_script: c.mtr_script, mtr_variable: c.mtr_variable };
  });
  return {
    metres: nouveaux,
    variables: [...variables.filter((v) => !aConvertir.has(v.var_mtr_id)), ...ajoutees],
  };
}
