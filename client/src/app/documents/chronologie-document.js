// Onglet Chronologie de la page document (plans/facturation-electronique.md, lot 11) : pièce liée à un flux de
// facturation électronique (fe_flux.ffl_type_element = DOCUMENT, ffl_id_element = ent_id). Étapes du journal chaîné des
// flux de la pièce (composant Chronologie du module : dépôt, accusé, statuts reçus et posés, erreurs, reprises),
// puis historique des versions du document (création, validation, envoi…). Onglet proposé seulement si le module est
// actif, si l'utilisateur consulte le nœud « facture_electronique » et si la pièce a au moins un flux.
import { texte, texteHtml, textesParCode } from '@logibtp/socle/dictionnaire';
import { echapper, formatDateHeure } from '@logibtp/socle/ui';
import { Chronologie, chronologieHtml } from '@logibtp/facture-electronique/ui';
import { TYPE_ELEMENT_FE } from '../codes.js';

/** Nœud des droits du module (SpecialisationFactureElectroniqueBtp.Noeud). */
export const NOEUD_FE = 'facture_electronique';

const ACTIONS = textesParCode('documents_btp.tracabilite.actions', ['CREATION', 'MODIFICATION', 'VALIDATION', 'ANNULATION', 'APPROBATION', 'ENVOI',
  'VALIDATION_TIERS', 'DEVALIDATION', 'FORCAGE', 'REJET', 'NUMERO']);

/** Requête GET /flux des flux d'une pièce (un seul suffit pour proposer l'onglet). */
export const requeteFluxPiece = (entId) => new URLSearchParams({ type_element: TYPE_ELEMENT_FE.DOCUMENT, id_element: String(entId), limite: '1' }).toString();

/** Onglet Chronologie proposé : module actif, droit de consulter, pièce enregistrée liée à au moins un flux. */
export function ongletChronologieVisible({ moduleActif, peutConsulter, entId, flux }) {
  return Boolean(moduleActif && peutConsulter && Number(entId) > 0 && Array.isArray(flux) && flux.length > 0);
}

/** Libellé d'un élément d'une étape (chronologie d'une pièce : la pièce elle-même). */
export const libelleElementFe = (type, id) => (type === TYPE_ELEMENT_FE.DOCUMENT
  ? texte('facture_electronique_btp.element_document', { id })
  : texte('facture_electronique.element', { type, id }));

/** Historique des versions du document, de la plus récente à la plus ancienne (versions de /documents/{id}/tracabilite). */
export function historiqueDocumentHtml(historique) {
  const versions = [...(historique ?? [])].sort((a, b) => String(b.his_date).localeCompare(String(a.his_date)) || (b.his_version ?? 0) - (a.his_version ?? 0));
  if (!versions.length) return `<p class="aide">${texteHtml('documents_btp.tracabilite.aucune_version')}</p>`;
  return `<table class="tableau-compact"><thead><tr><th>${texteHtml('documents_btp.tracabilite.colonnes.date')}</th><th>${texteHtml('documents_btp.tracabilite.colonnes.version')}</th>
      <th>${texteHtml('documents_btp.tracabilite.colonnes.action')}</th><th>${texteHtml('documents_btp.tracabilite.colonnes.utilisateur')}</th><th>${texteHtml('documents_btp.tracabilite.colonnes.motif')}</th></tr></thead>
    <tbody>${versions.map((h) => `<tr data-version="${echapper(h.his_version)}"><td>${echapper(formatDateHeure(h.his_date))}</td><td class="nombre">${echapper(h.his_version)}</td>
      <td>${echapper(ACTIONS[h.his_action] ?? h.his_action)}</td><td>${echapper(h.his_utilisateur ?? '')}</td><td>${echapper(h.his_motif ?? '')}</td></tr>`).join('')}</tbody></table>`;
}

/** Gabarit de l'onglet : étapes des flux (zone du composant), puis historique du document. */
export function gabaritChronologieDocument(historique, corpsFlux = '') {
  return `<div class="chronologie-document">
    <section class="trac-bloc" data-chronologie-fe>${corpsFlux}</section>
    <section class="trac-bloc" data-historique-document><h3>${texteHtml('facture_electronique_btp.document.historique')}</h3>${historiqueDocumentHtml(historique)}</section>
  </div>`;
}

/** Rendu complet sans interaction (étapes déjà lues) : contrôle de rendu et impression. */
export const chronologieDocumentHtml = (evenements, historique, options = {}) =>
  gabaritChronologieDocument(historique, chronologieHtml(evenements, { element: true, libelleElement: libelleElementFe, ...options }));

/**
 * Affiche l'onglet. options : entId, apiFe (creerApiFe), historique() → promesse des versions du document,
 * ouvrirFlux(id, nouvelleFenetre), erreur(e). Rend le composant Chronologie (préférence des détails, actualisation).
 */
export async function afficherChronologieDocument(zone, { entId, apiFe, historique, ouvrirFlux, erreur = () => {} }) {
  zone.innerHTML = `<p class="aide">${texteHtml('facture_electronique_btp.document.chargement')}</p>`;
  let versions = [];
  try { versions = (await historique()) ?? []; } catch (e) { erreur(e); }
  zone.innerHTML = gabaritChronologieDocument(versions);
  const chronologie = new Chronologie(zone.querySelector('[data-chronologie-fe]'), {
    charger: () => apiFe.chronologieElement(TYPE_ELEMENT_FE.DOCUMENT, String(entId)),
    element: true, libelleElement: libelleElementFe, ouvrirFlux, erreur,
  });
  await chronologie.charger();
  return chronologie;
}
