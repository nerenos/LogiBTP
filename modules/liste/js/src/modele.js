import { formatNombre } from '@logibtp/socle/ui';
import { compilerFormule, resolveurColonnes, resultat, vrai } from './formule.js';

// Modèle d'une vue de liste : colonnes, valeurs calculées, mise en forme (fixe et conditionnelle) et texte affiché.
//
// Définition d'une vue (stockée en JSONB dans vue_liste.vli_definition) :
// {
//   source: { mode: 'vue' | 'requete', vue, requete, colonne_id, colonne_type, type_element },
//   colonnes: [{ code, calcul, formule, titre, bulle, format, decimales, options: [{ valeur, libelle, picto }],
//                style: { couleur, fond, gras, italique, souligne, barre }, regles: [{ condition, style }],
//                largeur: { mode: 'auto' | 'fixe' | 'proportionnel', valeur, min, max }, masquee, recherche, alignement,
//                modifiable (saisie dans la liste, si la source et la colonne de la base le permettent) }],
//   segments: [{ colonne, titre }], tri: [{ colonne, sens: 'asc' | 'desc' }], lignes: 'multi' | 'simple', taille_lot,
//   filtres: [{ colonne, op, valeur, valeur2, valeurs }]   filtres fixes appliqués par la base (ex. salariés actifs),
//   theme: code du thème (regroupement des vues ; ses types d'élément restreignent les lignes)
// }

export const FORMATS = ['texte', 'nombre', 'date', 'coche', 'combo', 'picto'];
export const STYLE_VIDE = Object.freeze({ couleur: null, fond: null, gras: false, italique: false, souligne: false, barre: false });

/** Définition complétée par les valeurs par défaut (une vue ancienne reste lisible). */
export function normaliserDefinition(def = {}) {
  return {
    source: { mode: 'vue', vue: null, requete: '', colonne_id: null, colonne_type: null, type_element: null, ...def.source },
    colonnes: (def.colonnes ?? []).map((c) => ({
      calcul: false, formule: '', titre: c.code, bulle: '', format: 'texte', decimales: 2, options: [], regles: [],
      masquee: false, recherche: !c.calcul, alignement: null, modifiable: false,
      ...c,
      style: { ...STYLE_VIDE, ...c.style },
      largeur: { mode: 'auto', valeur: null, min: null, max: null, ...c.largeur },
    })),
    segments: def.segments ?? [],
    filtres: def.filtres ?? [],
    // Lignes en sommeil (colonne usage = S) montrées ; masquées par défaut (filtresEffectifs).
    sommeil: def.sommeil ?? false,
    theme: def.theme ?? null,
    tri: def.tri ?? [],
    lignes: def.lignes ?? 'multi',
    taille_lot: def.taille_lot ?? 100,
  };
}

export function dateFr(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v ?? '');
}

const estVide = (v) => v === null || v === undefined || v === '';

export class ModeleVue {
  constructor(definition) {
    this.definition = normaliserDefinition(definition);
    this.colonnes = this.definition.colonnes;
    this.parCode = new Map(this.colonnes.map((c) => [c.code, c]));
    this.erreurs = new Map(); // code de colonne → message
    this.#compiler();
    this.memo = new WeakMap();
  }

  get visibles() { return this.colonnes.filter((c) => !c.masquee); }

  /** Colonnes lues dans la source (les colonnes calculées sont évaluées sur le poste). */
  get colonnesSource() { return this.colonnes.filter((c) => !c.calcul); }

  #compiler() {
    const resoudre = resolveurColonnes(this.colonnes);
    this.formules = new Map();
    this.regles = new Map();
    for (const c of this.colonnes) {
      try {
        if (c.calcul) this.formules.set(c.code, compilerFormule(c.formule, resoudre));
      } catch (e) {
        this.erreurs.set(c.code, `Formule : ${e.message}`);
      }
      const regles = [];
      for (const r of c.regles) {
        try {
          regles.push({ condition: compilerFormule(r.condition, resoudre), style: r.style ?? {} });
        } catch (e) {
          this.erreurs.set(c.code, `Règle « ${r.condition} » : ${e.message}`);
        }
      }
      this.regles.set(c.code, regles);
    }
  }

  #cache(ligne) {
    let m = this.memo.get(ligne);
    if (!m) this.memo.set(ligne, (m = new Map()));
    return m;
  }

  /** Oublie les valeurs calculées d'une ligne (ligne rafraîchie). */
  oublier(ligne) { this.memo.delete(ligne); }

  /** Valeur d'une colonne : donnée de la source ou résultat de la formule (#ERREUR en cas d'échec). */
  valeur(ligne, code) {
    const c = this.parCode.get(code);
    if (!c?.calcul) return ligne[code] ?? null;
    const cache = this.#cache(ligne);
    if (cache.has(code)) {
      const v = cache.get(code);
      if (v === EN_COURS) return '#CYCLE';
      return v;
    }
    const f = this.formules.get(code);
    if (!f) return '#ERREUR';
    cache.set(code, EN_COURS);
    let v;
    try {
      v = resultat(f.evaluer(this.contexte(ligne)));
    } catch {
      v = '#ERREUR';
    }
    cache.set(code, v);
    return v;
  }

  contexte(ligne) {
    return { valeur: (code) => this.valeur(ligne, code) };
  }

  /** Style de la cellule : style de la colonne, puis règles conditionnelles vraies dans l'ordre. */
  style(ligne, code) {
    const c = this.parCode.get(code);
    const s = { ...STYLE_VIDE, ...c.style };
    for (const r of this.regles.get(code) ?? []) {
      let ok = false;
      try { ok = vrai(r.condition.evaluer(this.contexte(ligne))); } catch { ok = false; }
      if (!ok) continue;
      for (const [k, v] of Object.entries(r.style)) if (v !== null && v !== undefined && v !== '') s[k] = v;
    }
    return s;
  }

  /** Texte affiché d'une valeur (filtres par valeur, recherche locale, bulles). */
  texte(valeur, colonne) {
    if (estVide(valeur)) return '';
    // Colonne multivaluée : chaque valeur mise en forme, jointes par « , ».
    if (Array.isArray(valeur)) return valeur.filter((x) => !estVide(x)).map((x) => this.texte(x, colonne)).join(', ');
    switch (colonne.format) {
      case 'nombre': return Number.isNaN(Number(valeur)) ? String(valeur) : formatNombre(valeur, colonne.decimales ?? 2);
      case 'date': return dateFr(valeur);
      case 'coche': return vraiDonnee(valeur) ? 'Oui' : 'Non';
      case 'combo':
      case 'picto': return this.option(colonne, valeur)?.libelle ?? String(valeur);
      default: return String(valeur);
    }
  }

  option(colonne, valeur) {
    return colonne.options?.find((o) => String(o.valeur) === String(valeur)) ?? null;
  }

  texteCellule(ligne, colonne) { return this.texte(this.valeur(ligne, colonne.code), colonne); }
}

const EN_COURS = Symbol('en cours');

/** Valeur booléenne d'une donnée (coche) : true, 1, 'true', 'oui', 'O'… */
export function vraiDonnee(v) {
  if (typeof v === 'boolean') return v;
  if (estVide(v)) return false;
  return ['true', '1', 'oui', 'o', 'vrai', 'yes', 't'].includes(String(v).trim().toLowerCase());
}
