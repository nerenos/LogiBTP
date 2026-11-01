// Variables de paie d'une semaine d'un salarié, règle répliquée dans ReglesPaie.cs (jeu
// modules/pointage/tests/cas/03_paie.json) : règles typées d'un profil de paie appliquées dans l'ordre aux pointages
// retenus (ANALYSE-MODULE-POINTAGE.md M1 à M5). LogiBTP calcule des quantités par rubrique, jamais un salaire.
// Heures en minutes entières ; zone = numéro de zone du jour ; nombres (panier) entiers.
import { textesParCode } from '@logibtp/socle/dictionnaire';

/**
 * Types de règles : paramètres attendus.
 * CUMUL_HEURES      : sous_types (vide = tous), exclure → minutes du jour dans la rubrique.
 * SEUIL_JOUR        : base, seuil (minutes), valeur (1), exclu_si [rubriques] → valeur si base du jour ≥ seuil.
 * TRANCHES_SEMAINE  : base, seuil (minutes), tranches [{ rubrique, jusqu_a }], deduire → heures au-delà du seuil
 *                     ventilées (semaine complète seulement), retirées de la base si deduire.
 * ZONE              : exclu_si → zone la plus élevée des pointages du jour.
 * PLAFOND           : max (par jour), max_semaine → excédent retiré.
 * REPAS             : valeurs { agence: n, '*': défaut } (absent : 1), exclu_si → n chaque jour de repas pris au
 *                     restaurant (avantage en nature selon l'agence du salarié ; 0 = rien).
 */
export const TYPES_REGLE = textesParCode('pointage.types_regle', [
  'CUMUL_HEURES', 'SEUIL_JOUR', 'TRANCHES_SEMAINE', 'ZONE', 'PLAFOND', 'REPAS',
]);

export const UNITES_RUBRIQUE = textesParCode('pointage.unites_rubrique', ['H', 'NB', 'ZONE']);
export const SAISIES_RUBRIQUE = textesParCode('pointage.saisies_rubrique', ['C', 'S', 'SC']);
// Libellés : fr.json, pointage.types_regle.<TYPE>, unites_rubrique, saisies_rubrique, paie.<CODE>.

const ajouter = (o, cle, v) => { o[cle] = (o[cle] ?? 0) + v; };

/**
 * Calcule les variables d'une semaine : `jours` [{ date, pointages [{ minutes, sous_type, zone }], saisies { RUB: n }, repas }],
 * `agence` du salarié (règle REPAS),
 * `semaine_complete` (heures supplémentaires calculées seulement si vrai). Saisies : rubriques S posées avant les
 * règles (lues par elles), SC appliquées après (elles remplacent le calcul), C ignorées. Résultat : valeurs par jour,
 * valeurs de la semaine (heures supplémentaires) et totaux (zones comptées par numéro : « ZONE_3 »).
 */
export function calculerVariables({ rubriques = [], regles = [], jours = [], semaine_complete = true, agence = null }) {
  const saisie = new Map(rubriques.map((r) => [r.code, r.saisie ?? 'C']));
  const parJour = jours.map((j) => ({ date: j.date, valeurs: {} }));
  const semaine = {};
  jours.forEach((j, i) => {
    for (const [code, v] of Object.entries(j.saisies ?? {})) if (saisie.get(code) === 'S' && v) parJour[i].valeurs[code] = v;
  });
  const valeur = (i, code) => parJour[i].valeurs[code] ?? 0;
  const exclu = (i, p) => (p.exclu_si ?? []).some((c) => valeur(i, c) > 0);
  for (const r of regles) {
    const p = r.parametres ?? {};
    if (r.type === 'CUMUL_HEURES') {
      jours.forEach((j, i) => {
        const m = (j.pointages ?? []).filter((x) => (!(p.sous_types ?? []).length || p.sous_types.includes(x.sous_type)) && !(p.exclure ?? []).includes(x.sous_type))
          .reduce((s, x) => s + x.minutes, 0);
        if (m) ajouter(parJour[i].valeurs, r.rubrique, m);
      });
    } else if (r.type === 'SEUIL_JOUR') {
      jours.forEach((_, i) => { if (valeur(i, p.base) >= p.seuil && !exclu(i, p)) parJour[i].valeurs[r.rubrique] = p.valeur ?? 1; });
    } else if (r.type === 'TRANCHES_SEMAINE') {
      if (!semaine_complete) continue;
      const total = jours.reduce((s, _, i) => s + valeur(i, p.base), 0);
      let reste = total - p.seuil;
      if (reste <= 0) continue;
      const depasse = reste;
      for (const t of p.tranches ?? []) {
        const q = t.jusqu_a != null ? Math.min(reste, t.jusqu_a) : reste;
        if (q > 0) { ajouter(semaine, t.rubrique, q); reste -= q; }
      }
      if (p.deduire) ajouter(semaine, p.base, -(depasse - reste));
    } else if (r.type === 'ZONE') {
      jours.forEach((j, i) => {
        const z = Math.max(0, ...(j.pointages ?? []).map((x) => x.zone ?? 0));
        if (z > 0 && !exclu(i, p)) parJour[i].valeurs[r.rubrique] = z;
      });
    } else if (r.type === 'REPAS') {
      const v = p.valeurs ? (p.valeurs[agence ?? ''] ?? p.valeurs['*'] ?? 1) : 1;
      jours.forEach((j, i) => { if (j.repas && v > 0 && !exclu(i, p)) parJour[i].valeurs[r.rubrique] = v; });
    } else if (r.type === 'PLAFOND') {
      jours.forEach((_, i) => { if (p.max != null && valeur(i, r.rubrique) > p.max) parJour[i].valeurs[r.rubrique] = p.max; });
      if (p.max_semaine != null) {
        const t = jours.reduce((s, _, i) => s + valeur(i, r.rubrique), 0) + (semaine[r.rubrique] ?? 0);
        if (t > p.max_semaine) ajouter(semaine, r.rubrique, p.max_semaine - t);
      }
    }
  }
  jours.forEach((j, i) => {
    for (const [code, v] of Object.entries(j.saisies ?? {})) {
      if (saisie.get(code) !== 'SC') continue;
      if (v) parJour[i].valeurs[code] = v; else delete parJour[i].valeurs[code];
    }
  });
  const totaux = {};
  const unite = new Map(rubriques.map((r) => [r.code, r.unite ?? 'H']));
  for (const j of parJour) {
    for (const [code, v] of Object.entries(j.valeurs)) {
      if (unite.get(code) === 'ZONE') ajouter(totaux, `${code}_${v}`, 1);
      else ajouter(totaux, code, v);
    }
  }
  for (const [code, v] of Object.entries(semaine)) ajouter(totaux, code, v);
  for (const k of Object.keys(totaux)) if (totaux[k] === 0) delete totaux[k];
  return { jours: parJour, semaine, totaux };
}

/** Contrôle d'un profil : PRF_RUBRIQUE (code en double ou vide), PRF_REGLE (type inconnu, rubrique absente du profil). */
export function controlerProfil({ rubriques = [], regles = [] }) {
  const r = [];
  const codes = rubriques.map((x) => x.code);
  if (codes.some((c) => !c) || new Set(codes).size !== codes.length) r.push('PRF_RUBRIQUE');
  const connue = (c) => codes.includes(c);
  for (const g of regles) {
    const p = g.parametres ?? {};
    const cibles = g.type === 'TRANCHES_SEMAINE' ? [p.base, ...(p.tranches ?? []).map((t) => t.rubrique)]
      : g.type === 'SEUIL_JOUR' ? [g.rubrique, p.base] : [g.rubrique];
    if (!TYPES_REGLE[g.type] || cibles.some((c) => !connue(c))) { r.push('PRF_REGLE'); break; }
  }
  return r;
}

export const MESSAGES_PAIE = textesParCode('pointage.paie', [
  'PRF_RUBRIQUE', 'PRF_REGLE',
]);

/** Quantité exportée : heures en décimal (2 chiffres), nombres et zones tels quels. */
export const quantiteExport = (unite, v) => (unite === 'H' ? Math.round((v / 60) * 100) / 100 : v);
