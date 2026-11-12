// Onglet Chronologie de la page document (plans/facturation-electronique.md, lot 11) : pièce liée à un flux de
// facturation électronique (fe_flux.ffl_type_element = DOCUMENT, ffl_id_element = ent_id). Étapes du journal chaîné des
// flux de la pièce (composant Chronologie du module : dépôt, accusé, statuts reçus et posés, erreurs, reprises),
// puis historique des versions du document (création, validation, envoi…). Onglet proposé seulement si le module est
// actif, si l'utilisateur consulte le nœud « facture_electronique » et si la pièce a au moins un flux. Facture reçue
// (lot 13) : statut affiché et boutons En litige (207) et Refuser (210) proposés selon le cycle de vie (refus impossible
// après Approuvée, rien après Refusée), motif de la liste autorisée et commentaire demandés par la fenêtre du module.
import { texte, texteHtml, textesParCode, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, formatDateHeure, declarerRaccourcis, actionDe } from '@logibtp/socle/ui';
import { Chronologie, chronologieHtml, demanderStatut, libelleStatut, modeles } from '@logibtp/facture-electronique/ui';
import { STATUT_CDV, SENS_FLUX, TYPE_FLUX } from '@logibtp/facture-electronique';
import { TYPE_ELEMENT_FE } from '../codes.js';

/** Nœud des droits du module (SpecialisationFactureElectroniqueBtp.Noeud). */
export const NOEUD_FE = 'facture_electronique';

const ACTIONS = textesParCode('documents_btp.tracabilite.actions', ['CREATION', 'MODIFICATION', 'VALIDATION', 'ANNULATION', 'APPROBATION', 'ENVOI',
  'VALIDATION_TIERS', 'DEVALIDATION', 'FORCAGE', 'REJET', 'NUMERO']);

/** Statuts posés par boutons sur une facture reçue (les autres le sont par l'application : 204, 205, 211). */
export const STATUTS_BOUTONS_RECEPTION = Object.freeze([STATUT_CDV.EN_LITIGE, STATUT_CDV.REFUSEE]);

export const GROUPE_RACCOURCIS_STATUTS_FE = 'document_statuts_fe';
declarerRaccourcis(GROUPE_RACCOURCIS_STATUTS_FE, {
  libelle: texte('facture_electronique_btp.document.statuts.raccourcis.groupe'),
  actions: {
    [STATUT_CDV.EN_LITIGE]: { libelle: texte('facture_electronique_btp.document.statuts.raccourcis.207'), defaut: 'Alt+Shift+L' },
    [STATUT_CDV.REFUSEE]: { libelle: texte('facture_electronique_btp.document.statuts.raccourcis.210'), defaut: 'Alt+Shift+X' },
  },
});

/** Requête GET /flux des factures reçues d'une pièce (la plus récente porte les statuts). */
export const requeteFacturesRecues = (entId) => new URLSearchParams({ type_element: TYPE_ELEMENT_FE.DOCUMENT, id_element: String(entId), sens: SENS_FLUX.ENTRANT, limite: '10' }).toString();

/** Facture reçue d'une pièce parmi ses flux reçus (CDAR exclus), la plus récente ; null sinon. */
export const factureRecue = (flux) => (flux ?? []).find((f) => f.sens === SENS_FLUX.ENTRANT && [TYPE_FLUX.FACTURE_FOURNISSEUR, TYPE_FLUX.FACTURE_CLIENT].includes(f.type) && f.numero) ?? null;

/** Statuts proposés en boutons après l'historique (droit Modifier exigé) : sous-ensemble de STATUTS_BOUTONS_RECEPTION. */
export const boutonsStatuts = (detail, peutModifier) => (peutModifier && detail
  ? modeles.statutsProposes(detail.flux.sens, modeles.historiqueStatuts(detail), STATUTS_BOUTONS_RECEPTION) : []);

/** Bloc du statut d'une facture reçue : statut affiché et boutons proposés. */
export function statutsFactureHtml(detail, peutModifier) {
  if (!detail) return '';
  const affiche = detail.flux.statut_affiche;
  const boutons = boutonsStatuts(detail, peutModifier);
  return `<h3>${texteHtml('facture_electronique_btp.document.statuts.titre')}</h3>
    <div class="barre-outils"><span class="groupe-outils"><span data-statut-affiche>${affiche ? echapper(texte('facture_electronique_btp.document.statuts.actuel', { statut: libelleStatut(affiche) }))
      : texteHtml('facture_electronique_btp.document.statuts.aucun')}</span></span>
    ${boutons.length ? `<span class="groupe-outils">${boutons.map((c) => `<button type="button" data-poser-statut="${c}" title="${echapper(texte(`facture_electronique_btp.document.statuts.aides.${c}`))}">${iconeHtml(`fe_statut_${c}`)} ${texteHtml(`facture_electronique_btp.document.statuts.boutons.${c}`)}</button>`).join('')}</span>` : ''}</div>`;
}

/** Requête GET /flux des flux d'une pièce (un seul suffit pour proposer l'onglet). */
export const requeteFluxPiece = (entId) => new URLSearchParams({ type_element: TYPE_ELEMENT_FE.DOCUMENT, id_element: String(entId), limite: '1' }).toString();

/** Onglet Chronologie proposé : module actif, droit de consulter, pièce enregistrée liée à au moins un flux. */
export function ongletChronologieVisible({ moduleActif, peutConsulter, entId, flux }) {
  return Boolean(moduleActif && peutConsulter && Number(entId) > 0 && Array.isArray(flux) && flux.length > 0);
}

/** Libellé d'un élément d'une étape (chronologie d'une pièce : la pièce elle-même). */
export const libelleElementFe = (type, id) => (type === TYPE_ELEMENT_FE.DOCUMENT
  ? texte('facture_electronique_btp.element_document', { id })
  : type === TYPE_ELEMENT_FE.PERIODE_EREPORTING
    ? texte('facture_electronique_btp.element_ereporting', { id })
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

/** Gabarit de l'onglet : statut de la facture reçue, étapes des flux (zone du composant), puis historique du document. */
export function gabaritChronologieDocument(historique, corpsFlux = '') {
  return `<div class="chronologie-document">
    <section class="trac-bloc" data-statuts-fe hidden></section>
    <section class="trac-bloc" data-chronologie-fe>${corpsFlux}</section>
    <section class="trac-bloc" data-historique-document><h3>${texteHtml('facture_electronique_btp.document.historique')}</h3>${historiqueDocumentHtml(historique)}</section>
  </div>`;
}

/** Rendu complet sans interaction (étapes déjà lues) : contrôle de rendu et impression. */
export const chronologieDocumentHtml = (evenements, historique, options = {}) =>
  gabaritChronologieDocument(historique, chronologieHtml(evenements, { element: true, libelleElement: libelleElementFe, ...options }));

/**
 * Affiche l'onglet. options : entId, apiFe (creerApiFe), historique() → promesse des versions du document,
 * ouvrirFlux(id, nouvelleFenetre), peutModifier (droit Modifier du nœud), message(texte), erreur(e). Rend le composant
 * Chronologie (préférence des détails, actualisation) et, pour une facture reçue, son statut et les boutons 207 / 210.
 */
export async function afficherChronologieDocument(zone, { entId, apiFe, historique, ouvrirFlux, peutModifier = false, message = () => {}, erreur = () => {} }) {
  zone.innerHTML = `<p class="aide">${texteHtml('facture_electronique_btp.document.chargement')}</p>`;
  let versions = [];
  try { versions = (await historique()) ?? []; } catch (e) { erreur(e); }
  zone.innerHTML = gabaritChronologieDocument(versions);
  const chronologie = new Chronologie(zone.querySelector('[data-chronologie-fe]'), {
    charger: () => apiFe.chronologieElement(TYPE_ELEMENT_FE.DOCUMENT, String(entId)),
    element: true, libelleElement: libelleElementFe, ouvrirFlux, erreur,
  });
  const bloc = zone.querySelector('[data-statuts-fe]');
  let detail = null;
  const rendreStatuts = async () => {
    try {
      const recue = factureRecue(await apiFe.flux(requeteFacturesRecues(entId)));
      detail = recue ? await apiFe.detail(recue.id) : null;
    } catch (e) { detail = null; erreur(e); }
    bloc.hidden = !detail;
    bloc.innerHTML = statutsFactureHtml(detail, peutModifier);
  };
  const poser = async (code) => {
    if (!detail || !boutonsStatuts(detail, peutModifier).includes(code)) return;
    const demande = await demanderStatut(code, { sensFlux: detail.flux.sens, numero: detail.flux.numero ?? '' });
    if (!demande) return;
    try {
      await apiFe.poserStatut(detail.flux.id, demande);
      message(texte('facture_electronique_btp.document.statuts.pose', { statut: libelleStatut(code) }));
    } catch (e) { erreur(e); }
    await rendreStatuts();
    await chronologie.charger();
  };
  bloc.addEventListener('click', (e) => { const b = e.target.closest('[data-poser-statut]'); if (b) poser(b.dataset.poserStatut); });
  zone.addEventListener('keydown', (e) => { const a = actionDe(e, GROUPE_RACCOURCIS_STATUTS_FE); if (a) { e.preventDefault(); poser(a); } });
  await rendreStatuts();
  await chronologie.charger();
  return chronologie;
}
