import { FournisseurBibliothequeMemoire, coefficientsEffectifs } from '@logibtp/bibliotheque';
import { calculerOuvrage, estCompose } from '../src/app/bibliotheque/bibliotheque.js';
import { DEFINITION_DEMO } from '../src/app/demo.js';
import { BIBLIOTHEQUES, REGROUPEMENTS, NATURES, FAMILLES, ELEMENTS, TARIFS, PARAMETRES_BIBLIOTHEQUE, UNITES_BIBLIOTHEQUE, PERIODES_COEFFICIENTS } from '../src/app/bibliotheque/donnees.js';

// Tests : bibliothèque de démonstration en mémoire (ouvrages calculés par le moteur de devis, comme le serveur).

/** Colonnes de la liste « éléments » dérivées de la fiche (comme v_liste_elements). */
function colonnesListe(e, biblio) {
  const nature = biblio.nats.find((n) => n.id === Number(e.nat_id));
  return {
    type_element: 'element', bib_code: biblio.bibs.find((b) => b.id === Number(e.bib_id))?.code ?? null, famille: biblio.cheminFamille(e.fam_id),
    nature: nature?.libelle ?? null, regroupement: biblio.rgns.find((r) => r.code === nature?.regroupement)?.libelle ?? null,
  };
}

/** Bibliothèque de démonstration en mémoire (données de src/app/bibliotheque/donnees.js, aussi reprises par db/116). */
export function bibliothequeDemo({ utilisateur = 'demo', profil = 'ADMIN' } = {}) {
  const elements = structuredClone(ELEMENTS);
  // Les ouvrages sont calculés par le moteur de devis avant la reprise (le fournisseur ne connaît que les articles),
  // avec les coefficients de leur nature ou globaux en vigueur.
  for (const e of elements) {
    if (!estCompose(e.type)) continue;
    const c = coefficientsEffectifs(e, PERIODES_COEFFICIENTS, new Date().toISOString().slice(0, 10), PARAMETRES_BIBLIOTHEQUE);
    Object.assign(e, { coef_fg: c.coef_fg, coef_benef: c.coef_benef });
    Object.assign(e, (({ resultat, ...p }) => p)(calculerOuvrage(e.composition, e)));
  }
  const biblio = new FournisseurBibliothequeMemoire({
    bibliotheques: BIBLIOTHEQUES, familles: FAMILLES, regroupements: REGROUPEMENTS, natures: NATURES, elements, tarifs: TARIFS,
    unites: [...DEFINITION_DEMO.unites, ...UNITES_BIBLIOTHEQUE], parametres: PARAMETRES_BIBLIOTHEQUE, periodes: PERIODES_COEFFICIENTS, utilisateur, profil,
  });
  for (const e of elements) Object.assign(e, colonnesListe(e, biblio));
  biblio.surRecalculOuvrage = (e) => Object.assign(e, (({ resultat, ...p }) => p)(calculerOuvrage(typeof e.composition === 'string' ? JSON.parse(e.composition) : e.composition, e)));
  return biblio;
}
