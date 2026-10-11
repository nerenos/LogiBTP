import { FournisseurBibliothequeApi, FournisseurBibliothequeMemoire } from '@logibtp/bibliotheque';
import { arr6, D, S } from '@logibtp/socle';
import { calculerDocument, TL } from '../../calcul/index.js';
import { ENTETES } from '../api.js';
import { DEFINITION_DEMO } from '../demo.js';
import { BIBLIOTHEQUES, REGROUPEMENTS, NATURES, FAMILLES, ELEMENTS, TARIFS, PARAMETRES_BIBLIOTHEQUE, UNITES_BIBLIOTHEQUE } from './donnees.js';

// Bibliothèque du cœur : fournisseur (API ou démo hors ligne), calcul des ouvrages par le moteur de devis BTP
// (composition : lignes, métrés, variables), colonnes de la liste dérivées des fiches.

/** Entête minimale du document de calcul d'une composition d'ouvrage. */
export const documentComposition = (mode = 'V') => ({
  ent_id: 0, ent_tyd_id: 1, ent_numero: 'OUVRAGE', ent_objet: 'Composition', ent_std_id: 1, ent_tiers_id: 1, ent_mode_calcul_ouvrage: mode,
  ent_precision_montant: 2, ent_version: 1, ent_num_format: { separateur: '.', niveaux: [{ style: '1' }, { style: '1' }, { style: '1' }] }, ent_proprietes: {},
});

/** Ligne racine (ouvrage) d'une composition. */
export const racineComposition = (lignes) => lignes.find((l) => l.lig_parent_id === null && l.lig_tyl_id === TL.OUVRAGE) ?? null;

/**
 * Prix d'un ouvrage par unité : la racine (quantité 1, coefficients de l'élément en mode déboursé) est calculée par le
 * moteur de devis ; PA = montant PA de la racine, PR et PV unitaires, PV net = PV × remise. Même calcul côté serveur
 * (SpecialisationFicheBtp, MoteurDevisBtp).
 */
export function calculerOuvrage(composition, { coef_fg = 1, coef_benef = 1, coef_remise = 1 } = {}) {
  const lignes = composition?.lignes ?? [];
  if (!racineComposition(lignes)) return { pa: null, pr: null, pv: null, pv_net: null, resultat: null };
  const entree = {
    document: documentComposition(composition.mode),
    lignes: lignes.map((l) => (l === racineComposition(lignes) ? { ...l, lig_qte: 1, lig_coef_fg: Number(coef_fg), lig_coef_benef: Number(coef_benef) } : l)),
    taux_tva: DEFINITION_DEMO.taux_tva, entites: {}, options: {},
    metres: composition.metres ?? [], metre_lignes: composition.metre_lignes ?? [], variables: composition.variables ?? [],
  };
  const resultat = calculerDocument(entree);
  const r = racineComposition(resultat.lignes);
  const pv = D(r.lig_pv);
  return {
    pa: S(arr6(D(r.lig_montant_pa) ?? D(0))), pr: S(arr6(D(r.lig_pr) ?? D(0))), pv: S(arr6(pv ?? D(0))),
    pv_net: S(arr6((pv ?? D(0)).times(D(coef_remise) ?? D(1)))), resultat,
  };
}

/** Colonnes de la liste « éléments » dérivées de la fiche (comme v_liste_elements). */
export function colonnesListe(e, biblio) {
  const nature = biblio.nats.find((n) => n.id === Number(e.nat_id));
  return {
    type_element: 'element', bib_code: biblio.bibs.find((b) => b.id === Number(e.bib_id))?.code ?? null, famille: biblio.cheminFamille(e.fam_id),
    nature: nature?.libelle ?? null, regroupement: biblio.rgns.find((r) => r.code === nature?.regroupement)?.libelle ?? null,
  };
}

/** Démo hors ligne : prix, historique et colonnes de liste recalculés après chaque écriture d'un élément. */
export function apresEcritureElement(biblio, e, options) {
  if (e.type === 'OUVRAGE') {
    const composition = typeof e.composition === 'string' ? JSON.parse(e.composition) : e.composition;
    Object.assign(e, calculerOuvrage(composition, e), { resultat: undefined });
    delete e.resultat;
  }
  biblio.apresEcriture(e, options);
  Object.assign(e, colonnesListe(e, biblio));
}

export function creerFournisseurBibliotheque({ enLigne, utilisateur = 'demo', profil = 'ADMIN' }) {
  if (enLigne) return new FournisseurBibliothequeApi({ base: '/api/bibliotheque', entetes: ENTETES });
  const elements = structuredClone(ELEMENTS);
  // Les ouvrages sont calculés par le moteur de devis avant la reprise (le fournisseur ne connaît que les articles).
  for (const e of elements) if (e.type === 'OUVRAGE') Object.assign(e, (({ resultat, ...p }) => p)(calculerOuvrage(e.composition, e)));
  const biblio = new FournisseurBibliothequeMemoire({
    bibliotheques: BIBLIOTHEQUES, familles: FAMILLES, regroupements: REGROUPEMENTS, natures: NATURES, elements, tarifs: TARIFS,
    unites: [...DEFINITION_DEMO.unites, ...UNITES_BIBLIOTHEQUE], parametres: PARAMETRES_BIBLIOTHEQUE, utilisateur, profil,
  });
  for (const e of elements) Object.assign(e, colonnesListe(e, biblio));
  return biblio;
}
