import { estFamilleAchat } from '@logibtp/document';
import { compteVentilation, ORIGINES_VENTILATION } from '@logibtp/comptabilite';
import { estChiffree } from '../calcul/index.js';

// Compte comptable des lignes de document. La ligne porte son compte (lig_cpt_code) ; sans compte, elle affiche un
// compte hérité (en souligné) : celui de la règle de ventilation du module Comptabilité (`compteVentilation` : clé nature
// + taux de TVA, nature, taux, puis compte par défaut du type comptable de la pièce ; ANALYSE-MODULE-COMPTABILITE.md
// § 3.2), paramétrage lu par `GET /api/comptabilite/ventilation/regle`. Sans ce paramétrage (hors ligne) : compte de la
// nature selon la famille. Le compte du tiers (auxiliaire) n'est jamais un compte de produit ou de charge.
// Libellés : plan comptable (`compte_comptable`).

/**
 * Compte hérité d'une ligne sans compte : { code, origine, detail } ou null.
 * contexte : { natures: [{ id, code, compte_vente, compte_achat }], famille (tyd_famille), typeDocument (tyd_code),
 * tauxTva: [{ ttv_id, ttv_code }], regle: { types, cles, types_documents } | null }.
 */
export function compteHeriteParDefaut(ligne, { natures = [], famille = 'V', typeDocument = null, tauxTva = [], regle = null } = {}) {
  const nature = natures.find((n) => n.id === Number(ligne.lig_nat_id));
  if (regle) {
    const taux = tauxTva.find((t) => t.ttv_id === Number(ligne.lig_tva_id))?.ttv_code ?? null;
    const type = regle.types_documents?.[typeDocument] ?? null;
    const r = compteVentilation({ compte: null, nature: nature?.code ?? null, taux, type }, regle);
    if (!r.compte) return null;
    const detail = r.origine === 'TYPE' ? `${ORIGINES_VENTILATION.TYPE} ${r.type}`
      : `${ORIGINES_VENTILATION[r.origine]}${nature && r.origine.startsWith('NATURE') ? ` ${nature.code}` : ''}${taux && r.origine.endsWith('TAUX') ? ` ${taux}` : ''}`;
    return { code: r.compte, origine: r.origine, detail };
  }
  const compteNature = estFamilleAchat(famille) ? nature?.compte_achat : nature?.compte_vente;
  return compteNature ? { code: compteNature, origine: 'NATURE', detail: `nature ${nature.code}` } : null;
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
