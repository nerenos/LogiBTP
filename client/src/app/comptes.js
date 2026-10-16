import { estChiffree } from '../calcul/index.js';

// Compte comptable des lignes de document. La ligne porte son compte (lig_cpt_code) ; sans compte, elle affiche un
// compte hérité (en souligné) : celui de sa nature (compte de vente ou d'achat selon la famille du document), sinon
// celui du tiers. Règle provisoire : le module Comptabilité la précisera en remplaçant `regleCompteHerite`
// (point de spécialisation unique, utilisé par la grille et le détail). Libellés : table compte_comptable (db/166).

/**
 * Compte hérité d'une ligne sans compte : { code, origine, detail } ou null.
 * contexte : { natures: [{ id, code, compte_vente, compte_achat }], famille (tyd_famille : V, A…), compteTiers }.
 */
export function compteHeriteParDefaut(ligne, { natures = [], famille = 'V', compteTiers = null } = {}) {
  const nature = natures.find((n) => n.id === Number(ligne.lig_nat_id));
  const compteNature = famille === 'A' ? nature?.compte_achat : nature?.compte_vente;
  if (compteNature) return { code: compteNature, origine: 'nature', detail: `nature ${nature.code}` };
  if (compteTiers) return { code: compteTiers, origine: 'tiers', detail: 'tiers du document' };
  return null;
}

let regleCompteHerite = compteHeriteParDefaut;

/** Remplace la règle du compte hérité (futur module Comptabilité) ; sans argument, rétablit la règle par défaut. */
export function definirRegleCompte(regle = compteHeriteParDefaut) { regleCompteHerite = regle; }

/** Compte d'une ligne de prix : { code, herite, origine, detail } ou null (ligne non chiffrée ou sans compte). */
export function compteLigne(ligne, contexte) {
  if (!ligne || !estChiffree(ligne)) return null;
  const propre = String(ligne.lig_cpt_code ?? '').trim();
  if (propre) return { code: propre, herite: false, origine: 'ligne', detail: null };
  const h = regleCompteHerite(ligne, contexte);
  return h?.code ? { ...h, herite: true } : null;
}

/** « code – libellé » d'un compte (le code seul s'il est absent du plan de comptes). */
export function libelleCompte(code, comptes = []) {
  const c = comptes.find((x) => x.code === code);
  return c ? `${c.code} – ${c.libelle}` : code;
}
