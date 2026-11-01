import { CFG_LIGNES as C, descendants, racinesSelection } from '@logibtp/socle/ui';

// Couper, copier, coller entre documents de l'application, via un JSON placé dans le presse-papiers système.
// La copie porte des sous-arbres complets : lignes, enfants, propriétés, et les compléments d'une
// spécialisation (métrés, variables…) via extraireComplements / renumeroterComplements.

let memoire = null; // repli si l'accès au presse-papiers système est refusé

/** Presse-papiers des lignes de document (classe mère). */
export class PressePapiers {
  /** Format reconnu au collage : une spécialisation peut le changer pour ne pas mélanger les contenus. */
  get format() { return 'logibtp-lignes'; }

  extraire(saisie, ids, { entId, coupe }) {
    const racines = racinesSelection(C, saisie.lignes, ids);
    const garder = new Set();
    for (const r of racines) { garder.add(r.lig_id); for (const d of descendants(C, saisie.lignes, r.lig_id)) garder.add(d); }
    return {
      format: this.format,
      version: 1,
      source_ent_id: entId,
      coupe,
      racines: racines.map((r) => r.lig_id),
      lignes: saisie.lignes.filter((l) => garder.has(l.lig_id)),
      ...this.extraireComplements(saisie, garder),
    };
  }

  /** Compléments rattachés aux lignes copiées (ID de lignes dans `garder`). */
  extraireComplements(_saisie, _garder) { return {}; }

  async ecrire(contenu) {
    memoire = contenu;
    try { await navigator.clipboard.writeText(JSON.stringify(contenu)); } catch { /* mémoire interne */ }
  }

  async lire() {
    try {
      const texte = await navigator.clipboard.readText();
      const o = JSON.parse(texte);
      if (o?.format === this.format) return o;
    } catch { /* presse-papiers inaccessible ou autre contenu */ }
    return memoire?.format === this.format ? memoire : null;
  }

  oublierCoupe() {
    if (memoire) memoire.coupe = false;
  }

  /**
   * Copie avec de nouveaux ID temporaires (négatifs). Les racines gardent leur parent d'origine
   * (à replacer par l'appelant) ; les références internes sont renumérotées, les externes supprimées.
   */
  renumeroter(contenu, prochainId) {
    const compteur = { n: prochainId, suivant() { return this.n--; } };
    const lig = new Map();
    for (const l of contenu.lignes) lig.set(l.lig_id, compteur.suivant());
    const lignes = contenu.lignes.map((l) => ({
      ...structuredClone(l),
      lig_id: lig.get(l.lig_id),
      lig_parent_id: lig.has(l.lig_parent_id) ? lig.get(l.lig_parent_id) : l.lig_parent_id,
      lig_st_depuis_id: correspondance(lig, l.lig_st_depuis_id),
      lig_variante_de_id: correspondance(lig, l.lig_variante_de_id),
      lig_pied_base_id: correspondance(lig, l.lig_pied_base_id),
      lig_origine_id: l.lig_id > 0 ? l.lig_id : l.lig_origine_id ?? null,
      lig_numerotation: l.lig_num_manuelle ? l.lig_numerotation : null,
    }));
    return { racines: contenu.racines.map((r) => lig.get(r)), lignes, ...this.renumeroterComplements(contenu, lignes, lig, compteur) };
  }

  /** Renumérote les compléments ; `lignes` sont déjà renumérotées (références vers les compléments à corriger). */
  renumeroterComplements(_contenu, _lignes, _lig, _compteur) { return {}; }

  /** Ajoute au brouillon les compléments d'une copie renumérotée. */
  insererComplements(_brouillon, _copie) {}

  /** Après le placement des lignes collées (parents connus) : compléments qui dépendent de la position. */
  apresPlacement(_brouillon, _copie) {}
}

/** Nouvel ID d'une référence, ou null si elle sort de la copie. */
export const correspondance = (table, v) => (v === null || v === undefined ? null : table.get(v) ?? null);
