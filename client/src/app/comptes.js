import { estFamilleAchat } from '@logibtp/document';
import { compteVentilation, ORIGINES_VENTILATION } from '@logibtp/comptabilite';
import { estChiffree } from '../calcul/index.js';

// Compte comptable des lignes de document. La ligne porte son compte (lig_cpt_code) ; sans compte, elle affiche un
// compte hérité (en souligné) : celui de la règle de ventilation du module Comptabilité (`compteVentilation` : clé nature
// + taux de TVA, nature, taux, puis compte par défaut du type comptable de la pièce ; ANALYSE-MODULE-COMPTABILITE.md
// § 3.2 ; compte de produit ou de charge du tiers avant les clés), paramétrage lu par
// `GET /api/comptabilite/ventilation/regle`. Sans ce paramétrage : pas de compte hérité. Le compte auxiliaire du tiers
// (411 / 401) n'est jamais un compte de produit ou de charge ; le tiers a pour cela un compte propre par relation.
// Libellés : plan comptable (`compte_comptable`).

/**
 * Compte hérité d'une ligne sans compte : { code, origine, detail } ou null.
 * contexte : { natures: [{ id, code }], typeDocument (tyd_code), tauxTva: [{ ttv_id, ttv_code }],
 * regle: { types, cles, types_documents } | null, compteTiers (compte de produit ou de charge du tiers de la pièce) }.
 */
export function compteHeriteParDefaut(ligne, { natures = [], typeDocument = null, tauxTva = [], regle = null, compteTiers = null } = {}) {
  if (!regle) return null;
  const nature = natures.find((n) => n.id === Number(ligne.lig_nat_id));
  const taux = tauxTva.find((t) => t.ttv_id === Number(ligne.lig_tva_id))?.ttv_code ?? null;
  const type = regle.types_documents?.[typeDocument] ?? null;
  const r = compteVentilation({ compte: null, tiers: compteTiers, nature: nature?.code ?? null, taux, type }, regle);
  if (!r.compte) return null;
  const detail = r.origine === 'TYPE' ? `${ORIGINES_VENTILATION.TYPE} ${r.type}`
    : `${ORIGINES_VENTILATION[r.origine]}${nature && r.origine.startsWith('NATURE') ? ` ${nature.code}` : ''}${taux && r.origine.endsWith('TAUX') ? ` ${taux}` : ''}`;
  return { code: r.compte, origine: r.origine, detail };
}

/** Relation du tiers d'une pièce selon sa famille : CLIENT (ventes), SOUS_TRAITANT (T), FOURNISSEUR (autres achats). */
export function relationTiers(famille) {
  if (!estFamilleAchat(famille)) return 'CLIENT';
  return famille === 'T' ? 'SOUS_TRAITANT' : 'FOURNISSEUR';
}

/**
 * Taux de TVA autoliquidé (catégorie A) proposé par défaut sur les nouvelles lignes d'une pièce d'achat d'un fournisseur
 * de l'Union européenne (`per_fou_tva_intracom`), si le module Comptabilité est actif : identifiant du taux ou null
 * (le taux reste modifiable ligne par ligne). contexte : { famille (tyd_famille), tvaIntracom, comptabiliteActive,
 * tauxTva: [{ ttv_id, ttv_categorie, ttv_defaut }] }.
 */
export function tvaAutoliqueeParDefaut({ famille = 'V', tvaIntracom = false, comptabiliteActive = false, tauxTva = [] } = {}) {
  if (!comptabiliteActive || !tvaIntracom || relationTiers(famille) !== 'FOURNISSEUR') return null;
  const autoliquides = tauxTva.filter((t) => t.ttv_categorie === 'A');
  return (autoliquides.find((t) => t.ttv_defaut) ?? autoliquides[0])?.ttv_id ?? null;
}

let regleCompteHerite = compteHeriteParDefaut;

/** Remplace la règle du compte hérité ; sans argument, rétablit la règle par défaut. */
export function definirRegleCompte(regle = compteHeriteParDefaut) { regleCompteHerite = regle; }

/** Compte d'une ligne de prix : { code, herite, origine, detail } ou null (ligne non chiffrée ou sans compte). */
export function compteLigne(ligne, contexte) {
  if (!ligne || !estChiffree(ligne)) return null;
  const propre = String(ligne.lig_cpt_code ?? '').trim();
  if (propre) return { code: propre, herite: false, origine: 'LIGNE', detail: null };
  const h = regleCompteHerite(ligne, contexte);
  return h?.code ? { ...h, herite: true } : null;
}

/** « code – libellé » d'un compte (le code seul s'il est absent du plan de comptes). */
export function libelleCompte(code, comptes = []) {
  const c = comptes.find((x) => x.code === code);
  return c ? `${c.code} – ${c.libelle}` : code;
}
