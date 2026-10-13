import { CFG_LIGNES as C, ancetres, descendants, parId } from '@logibtp/socle/ui';
import { TL, estChiffree, estPied, accepteEnfants, estTranche } from '../src/index.js';

/**
 * Règles de saisie des lignes de document : héritages obligatoires et TVA (sections 4, 11 et 14).
 * Classe mère : une spécialisation ajoute ses champs hérités et ses propagations (champsHeritesOuvrage,
 * apresModification).
 */
export class ReglesDocument {
  /** Champs qu'une composante reprend de son ouvrage. */
  get champsHeritesOuvrage() { return ['lig_coef_remise']; }

  ouvrageAncetre(lignes, id) { return ancetres(C, lignes, id).find((a) => a.lig_tyl_id === TL.OUVRAGE) ?? null; }
  titreAncetre(lignes, id) { return ancetres(C, lignes, id).find((a) => a.lig_tyl_id === TL.TITRE) ?? null; }
  estLigneDePrix(lignes, l) { return estChiffree(l) && !this.ouvrageAncetre(lignes, l.lig_id); }

  /** Taux par défaut d'une nouvelle ligne de prix : titre le plus proche, sinon premier taux du paramétrage. */
  tauxParDefaut(lignes, id, tauxTva) {
    for (const t of ancetres(C, lignes, id)) if (t.lig_tyl_id === TL.TITRE && t.lig_tva_id) return t.lig_tva_id;
    return tauxTva?.[0]?.ttv_id ?? null;
  }

  /**
   * Après insertion ou déplacement : une ligne entrée dans un ouvrage devient composante
   * (TVA à NULL, hérite du type de prix, de l'impression et des champs hérités de l'ouvrage) ;
   * sortie d'un ouvrage, elle redevient ligne de prix avec le taux du titre le plus proche.
   */
  appliquerContexte(brouillon, id, tauxTva) {
    const lignes = brouillon.lignes;
    const index = parId(C, lignes);
    const l = index.get(id);
    if (!l) return;
    const ouvrage = this.ouvrageAncetre(lignes, id);
    const parent = index.get(l.lig_parent_id);
    const cibles = [l, ...[...descendants(C, lignes, id)].map((d) => index.get(d))];
    if (parent && (parent.lig_type_prix ?? 'V') !== 'V') for (const c of cibles) c.lig_type_prix = parent.lig_type_prix;
    if (parent?.lig_is_non_editee) for (const c of cibles) c.lig_is_non_editee = true;
    if (ouvrage) {
      for (const c of cibles) {
        if (estChiffree(c)) { c.lig_tva_id = null; c.lig_taux_tva = null; c.lig_qte_type ??= 'R'; }
        for (const k of this.champsHeritesOuvrage) c[k] = ouvrage[k] ?? 1;
      }
    } else if (estChiffree(l)) {
      l.lig_tva_id ??= this.tauxParDefaut(lignes, id, tauxTva);
      l.lig_taux_tva = null;
      for (const c of cibles) if (c !== l && estChiffree(c)) { c.lig_tva_id = null; c.lig_taux_tva = null; }
    }
    // Tranche insérée (ensemble de la bibliothèque, collage) : ses lignes de prix sans taux prennent le taux par défaut.
    if (estTranche(l)) {
      for (const c of cibles) {
        if (c !== l && !c.lig_tva_id && this.estLigneDePrix(lignes, c)) c.lig_tva_id = this.tauxParDefaut(lignes, c.lig_id, tauxTva);
      }
    }
  }

  /** Propagations après la modification d'un champ, dans la même étape d'annulation. */
  apresModification(brouillon, id, champ) {
    const lignes = brouillon.lignes;
    const index = parId(C, lignes);
    const l = index.get(id);
    if (!l) return;
    const desc = () => [...descendants(C, lignes, id)].map((d) => index.get(d));
    if (champ === 'lig_type_prix') for (const d of desc()) d.lig_type_prix = l.lig_type_prix;
    if (champ === 'lig_is_non_editee') for (const d of desc()) d.lig_is_non_editee = l.lig_is_non_editee;
    if (l.lig_tyl_id === TL.OUVRAGE && this.champsHeritesOuvrage.includes(champ)) for (const d of desc()) d[champ] = l[champ];
    if (champ === 'lig_tva_id') l.lig_taux_tva = null;
    if (champ === 'lig_numerotation') l.lig_num_manuelle = !!l.lig_numerotation;
  }

  /** Action explicite : le taux du titre écrase celui de toutes les lignes de prix descendantes. */
  appliquerTauxTitre(brouillon, titreId) {
    const lignes = brouillon.lignes;
    const index = parId(C, lignes);
    const t = index.get(titreId);
    for (const d of descendants(C, lignes, titreId)) {
      const x = index.get(d);
      if (this.estLigneDePrix(lignes, x)) { x.lig_tva_id = t.lig_tva_id; x.lig_taux_tva = null; }
    }
  }

  /** Marqueur visuel d'hétérogénéité de TVA d'un titre, calculé à chaque rendu. */
  heterogeneiteTva(lignes, titre, libelleTaux) {
    const index = parId(C, lignes);
    const compte = new Map();
    for (const d of descendants(C, lignes, titre.lig_id)) {
      const x = index.get(d);
      if (!this.estLigneDePrix(lignes, x)) continue;
      compte.set(x.lig_tva_id, (compte.get(x.lig_tva_id) ?? 0) + 1);
    }
    const heterogene = [...compte.keys()].some((k) => k !== titre.lig_tva_id);
    const detail = [...compte].map(([k, n]) => `${libelleTaux(k)} : ${n} ligne${n > 1 ? 's' : ''}`).join(', ');
    return { heterogene, detail };
  }

  /** Contrôle de dépôt : type accepté comme parent, pied en fin de document, pas dans son propre sous-arbre. */
  depotAutorise(lignes, ids, cible, position) {
    const index = parId(C, lignes);
    const deplaces = ids.map((i) => index.get(i));
    if (!cible) return true;
    for (const id of ids) {
      if (id === cible.lig_id || descendants(C, lignes, id).has(cible.lig_id)) return false;
    }
    const parent = position === 'enfant' ? cible : index.get(cible.lig_parent_id) ?? null;
    const pied = deplaces.some(estPied);
    if (pied) {
      if (parent) return false;
      if (!estPied(cible) && position !== 'apres') return false;
      return true;
    }
    if (parent && !accepteEnfants(parent)) return false;
    // Une section reste à la racine.
    if (parent && deplaces.some((l) => l?.lig_tyl_id === TL.SECTION)) return false;
    if (!parent && estPied(cible) && position !== 'avant') return false;
    if (!parent && estPied(cible)) {
      const racine = lignes.filter((l) => !l.lig_parent_id).sort((a, b) => a.lig_ordre - b.lig_ordre);
      const i = racine.findIndex((x) => x.lig_id === cible.lig_id);
      if (i > 0 && estPied(racine[i - 1])) return false;
    }
    return true;
  }
}
