// Règle de ventilation (compte d'une ligne), répliquée dans ReglesVentilation.cs (jeu
// modules/comptabilite/tests/cas/02_ventilation.json ; ANALYSE-MODULE-COMPTABILITE.md § 3.2). Le plus précis gagne :
// 1. compte saisi sur la ligne ; 2. compte de produit ou de charge du tiers de la pièce (distinct de son compte
// auxiliaire) ; 3. clé nature + taux ; 4. clé nature ; 5. clé taux ; 6. compte par défaut du type comptable ; sinon
// COMPTE_INTROUVABLE. Aux étapes 3 à 6, le type comptable de la pièce passe avant son parent (ex. sous-traitance →
// achat), puis le parent du parent.

/** Étapes de la règle, dans l'ordre. */
export const ORIGINES_VENTILATION = {
  LIGNE: 'compte de la ligne',
  TIERS: 'compte du tiers',
  NATURE_TAUX: 'nature et taux de TVA',
  NATURE: 'nature',
  TAUX: 'taux de TVA',
  TYPE: 'type comptable',
};

export const MESSAGES_VENTILATION = {
  COMPTE_INTROUVABLE: 'Aucun compte : ni sur la ligne, ni par la ventilation, ni par défaut pour le type comptable',
};

const texte = (v) => {
  const s = String(v ?? '').trim();
  return s || null;
};

/** Types comptables de la chaîne : le type, puis ses parents (sans boucle, cinq niveaux au plus). */
export function chaineTypes(type, types = []) {
  const res = [];
  let t = texte(type);
  while (t && !res.includes(t) && res.length < 5) {
    res.push(t);
    t = texte(types.find((x) => x.code === t)?.parent);
  }
  return res;
}

/**
 * Compte de ventilation : { compte, origine, type, erreur }.
 * entree : { compte (saisi sur la ligne), tiers (compte de produit ou de charge du tiers), nature, taux (codes ou
 * identifiants, comparés tels quels aux clés), type (type comptable de la pièce) } ;
 * parametrage : { types: [{ code, parent, compte_defaut }], cles: [{ type, nature, taux, compte }] }.
 */
export function compteVentilation(entree, { types = [], cles = [] } = {}) {
  const propre = texte(entree?.compte);
  if (propre) return { compte: propre, origine: 'LIGNE', type: null, erreur: null };
  const tiers = texte(entree?.tiers);
  if (tiers) return { compte: tiers, origine: 'TIERS', type: null, erreur: null };
  const nature = texte(entree?.nature);
  const taux = texte(entree?.taux);
  const chaine = chaineTypes(entree?.type, types);
  const cle = (t, n, x) => cles.find((c) => c.type === t && texte(c.nature) === n && texte(c.taux) === x && texte(c.compte));
  const etapes = [
    ['NATURE_TAUX', nature && taux ? (t) => cle(t, nature, taux) : null],
    ['NATURE', nature ? (t) => cle(t, nature, null) : null],
    ['TAUX', taux ? (t) => cle(t, null, taux) : null],
  ];
  for (const [origine, chercher] of etapes) {
    if (!chercher) continue;
    for (const t of chaine) {
      const c = chercher(t);
      if (c) return { compte: texte(c.compte), origine, type: t, erreur: null };
    }
  }
  for (const t of chaine) {
    const d = texte(types.find((x) => x.code === t)?.compte_defaut);
    if (d) return { compte: d, origine: 'TYPE', type: t, erreur: null };
  }
  return { compte: null, origine: null, type: null, erreur: 'COMPTE_INTROUVABLE' };
}
