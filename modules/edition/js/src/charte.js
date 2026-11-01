// Charte graphique (Q11) : couleurs, styles de texte, traits et marges nommés, référencés par les modèles.
// Un style se désigne par son nom (« titre ») ou par un objet { base: 'normal', taille: 11, graisse: 700 } ;
// une couleur par « couleur:primaire », par son nom de charte (« primaire ») ou en dur (« #1f4e79 »).

import { texte } from '@logibtp/socle/dictionnaire';
export const CHARTE_DEFAUT = Object.freeze({
  code: 'DEFAUT',
  get libelle() { return texte('edition.charte.defaut'); },
  police: 'Inter',
  couleurs: {
    texte: '#1f2328', discret: '#5f6b7a', primaire: '#1f4e79', secondaire: '#2e7d32', alerte: '#b42318',
    trait: '#9aa4b2', trait_fort: '#1f2328', fond_entete: '#e8eef5', fond_section: '#dfe7f1', fond_titre: '#f2f5f9',
    fond_total: '#e8eef5', blanc: '#ffffff', filigrane: '#d0d5dd',
  },
  styles: {
    normal: { police: 'Inter', taille: 9, graisse: 400, couleur: 'texte', interligne: 1.25 },
    petit: { base: 'normal', taille: 7.5 },
    discret: { base: 'petit', couleur: 'discret' },
    gras: { base: 'normal', graisse: 700 },
    titre: { base: 'normal', taille: 16, graisse: 700, couleur: 'primaire' },
    sous_titre: { base: 'normal', taille: 11, graisse: 600, couleur: 'primaire' },
    entete_tableau: { base: 'normal', taille: 8, graisse: 600, couleur: 'texte' },
    section: { base: 'normal', taille: 10, graisse: 700, couleur: 'primaire' },
    titre_ligne: { base: 'normal', graisse: 600 },
    sous_total: { base: 'normal', graisse: 600, italique: true },
    composante: { base: 'normal', taille: 8, couleur: 'discret' },
    montant: { base: 'normal', tnum: true },
    total: { base: 'normal', graisse: 700, tnum: true },
    nom_adresse: { base: 'normal', taille: 10, graisse: 700 },
    mentions: { base: 'petit', taille: 6.5, couleur: 'discret', interligne: 1.2 },
    filigrane: { base: 'normal', taille: 60, graisse: 700, couleur: 'filigrane' },
  },
  traits: {
    fin: { epaisseur: 0.15, couleur: 'trait' },
    normal: { epaisseur: 0.3, couleur: 'trait' },
    fort: { epaisseur: 0.5, couleur: 'trait_fort' },
    primaire: { epaisseur: 0.5, couleur: 'primaire' },
  },
  marges: { haut: 12, bas: 12, gauche: 12, droite: 12 },
});

/** Fusion d'une charte de la base avec la charte par défaut (les clés absentes gardent la valeur par défaut). */
export function completerCharte(charte) {
  const c = charte ?? {};
  return {
    ...CHARTE_DEFAUT, ...c,
    couleurs: { ...CHARTE_DEFAUT.couleurs, ...(c.couleurs ?? {}) },
    styles: { ...CHARTE_DEFAUT.styles, ...(c.styles ?? {}) },
    traits: { ...CHARTE_DEFAUT.traits, ...(c.traits ?? {}) },
    marges: { ...CHARTE_DEFAUT.marges, ...(c.marges ?? {}) },
  };
}

/** Couleur effective (#rrggbb) ou null. */
export function resoudreCouleur(charte, v) {
  if (v === null || v === undefined || v === '' || v === false) return null;
  const s = String(v).trim();
  const nom = s.startsWith('couleur:') ? s.slice(8) : s;
  if (charte.couleurs[nom]) return resoudreCouleur(charte, charte.couleurs[nom] === nom ? null : charte.couleurs[nom]);
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) return '#' + [...s.slice(1)].map((c) => c + c).join('').toLowerCase();
  return null;
}

/**
 * Style de texte effectif : style nommé (héritage par `base`), objet de surcharge, ou liste des deux.
 * Couleurs résolues, police par défaut de la charte.
 */
export function resoudreStyle(charte, s, profondeur = 0) {
  if (profondeur > 10) return {};
  let res = {};
  const liste = Array.isArray(s) ? s : [s];
  for (const x of liste) {
    if (!x) continue;
    if (typeof x === 'string') {
      const def = charte.styles[x.startsWith('style:') ? x.slice(6) : x];
      if (def) res = { ...res, ...resoudreStyle(charte, def, profondeur + 1) };
      continue;
    }
    const { base, ...reste } = x;
    if (base) res = { ...res, ...resoudreStyle(charte, base, profondeur + 1) };
    res = { ...res, ...reste };
  }
  if (profondeur === 0) {
    res.police = res.police ?? charte.police ?? 'Inter';
    if (res.couleur) res.couleur = resoudreCouleur(charte, res.couleur) ?? '#000000';
    if (res.fond) res.fond = resoudreCouleur(charte, res.fond);
  }
  return res;
}

/** Trait effectif : nom de la charte, objet { epaisseur, couleur, pointille }, true (= fin) ou false / null (aucun). */
export function resoudreTrait(charte, t) {
  if (!t) return null;
  if (t === true) return resoudreTrait(charte, 'fin');
  if (typeof t === 'string') {
    const def = charte.traits[t.startsWith('trait:') ? t.slice(6) : t];
    return def ? resoudreTrait(charte, def) : null;
  }
  return { epaisseur: Number(t.epaisseur ?? 0.15), couleur: resoudreCouleur(charte, t.couleur ?? 'trait') ?? '#000000', pointille: !!t.pointille };
}

/** Contrôle d'une charte : [{ chemin, code, message }] (couleurs, héritages, polices disponibles). */
export function verifierCharte(charte, familles = ['Inter', 'Libre Barcode 39']) {
  const c = completerCharte(charte);
  const erreurs = [];
  for (const [nom, v] of Object.entries(c.couleurs)) {
    if (!resoudreCouleur(c, v)) erreurs.push({ chemin: `couleurs.${nom}`, code: 'COULEUR', message: texte('edition.charte.couleur_invalide', { couleur: v }) });
  }
  for (const [nom, s] of Object.entries(c.styles)) {
    const visites = new Set([nom]);
    let base = s.base;
    while (base) {
      if (visites.has(base)) { erreurs.push({ chemin: `styles.${nom}`, code: 'STYLE_CYCLE', message: texte('edition.charte.heritage_circulaire', { chaine: [...visites, base].join(' → ') }) }); break; }
      if (!c.styles[base]) { erreurs.push({ chemin: `styles.${nom}`, code: 'STYLE_BASE', message: texte('edition.charte.base_inconnue', { base }) }); break; }
      visites.add(base);
      base = c.styles[base].base;
    }
    if (s.police && !familles.includes(s.police)) erreurs.push({ chemin: `styles.${nom}.police`, code: 'POLICE', message: texte('edition.charte.police', { police: s.police }) });
    if (s.couleur && !resoudreCouleur(c, s.couleur)) erreurs.push({ chemin: `styles.${nom}.couleur`, code: 'COULEUR', message: texte('edition.charte.couleur_inconnue', { couleur: s.couleur }) });
  }
  return erreurs;
}
