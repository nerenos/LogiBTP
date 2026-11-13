import { texte, texteHtml, iconeHtml, textesParCode } from '@logibtp/socle/dictionnaire';
import { urlDocument } from '../codes.js';
import { echapper, formatDate, formatDateHeure, formatNombre } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { tableNonRepris } from '../import/rapport-import.js';
import { afficherJournalRelances } from '../relances/journal-relances.js';
import { ECART_RECEPTION } from '@logibtp/facture-electronique';
import { originesAgent, mentionAgentHtml } from '../agents/origines.js';

// Onglet Traçabilité d'un document : origine (import : format, fichier source conservé dans la GED, réutilisable),
// documents dont il est issu et documents qui en sont issus (transformations, copies), historique des versions (total HT
// et nombre de lignes de chaque instantané, motif ; « ↺ Restaurer » si le document est modifiable : documents/restauration.js).
// Le rapport des champs non repris d'un import n'est affiché qu'en mode débogage (vue de colonnes).

const ACTIONS = textesParCode('documents_btp.tracabilite.actions', ['CREATION', 'MODIFICATION', 'VALIDATION', 'ANNULATION', 'APPROBATION', 'ENVOI',
  'VALIDATION_TIERS', 'DEVALIDATION', 'FORCAGE', 'REJET', 'NUMERO']);
const LIENS = textesParCode('documents_btp.tracabilite.liens', ['TRANSFORMATION', 'COPIE']);
const date = (d, heure = false) => (heure ? formatDateHeure(d) : formatDate(d));

/**
 * Facture électronique de sous-traitance reçue (plans/facturation-electronique.md, lot 15), lue du rapport d'origine :
 * paiement direct (cadre S5 avec un payeur : marché, contrat, payeur) et écarts signalés à la réception (ECART_RECEPTION :
 * payeur, autoliquidation, contrat), toujours affichés (pas seulement en débogage) ; vide sans paiement direct ni écart.
 */
export function receptionSousTraitanceHtml(rapport) {
  const pd = rapport?.paiement_direct ?? null;
  const ecarts = (rapport?.ecarts ?? []).filter((e) => Object.values(ECART_RECEPTION).includes(e?.code));
  if (!pd && !ecarts.length) return '';
  const vide = texte('facture_electronique_btp.sous_traitance.inconnu');
  return `<div class="trac-sous-traitance">${pd ? `<p data-paiement-direct>${iconeHtml('facture_electronique_btp_paiement_direct')} ${texteHtml('facture_electronique_btp.sous_traitance.paiement_direct', {
    marche: pd.code_marche ?? pd.contrat ?? vide, payeur: pd.payeur?.raison_sociale ?? vide })}</p>` : ''}
    ${ecarts.length ? `<ul class="import-avertissements" data-ecarts>${ecarts.map((e) => `<li data-ecart="${echapper(e.code)}">${iconeHtml('avertissement')} ${texteHtml(`facture_electronique_btp.sous_traitance.ecarts.${e.code}`, {
    payeur: e.payeur ?? vide, maitre_ouvrage: e.maitre_ouvrage ?? vide, contrat: e.contrat ?? vide })}</li>`).join('')}</ul>` : ''}</div>`;
}

/** Version la plus récente d'un document de la GED (pour télécharger ou réutiliser le fichier source). */
export async function derniereVersionGed(ged, id) {
  const d = await ged.document(id);
  return [...(d.versions ?? [])].sort((a, b) => b.numero - a.numero)[0] ?? null;
}

/**
 * Rendu de l'onglet. options : entId, ged (fournisseur GED, facultatif), debogage (booléen), naviguer(url, e),
 * reimporter(origine) (relance l'import du fichier source), restaurer(version) (facultatif : document modifiable),
 * relances ({ piece, groupe } : relances du module Relances faites sur le document et ses indices, facultatif).
 */
export async function afficherTracabilite(zone, { entId, ged, debogage, naviguer, reimporter, restaurer = null, relances = null, origines = null }) {
  zone.innerHTML = `<p class="aide">${texteHtml('documents_btp.tracabilite.chargement')}</p>`;
  const t = await api.tracabilite(entId);
  // Lignes écrites par un agent IA (module MCP actif) : mention « 🤖 via <client> » après l'utilisateur.
  let agents = new Map();
  if (origines) { try { agents = originesAgent(await origines()); } catch { /* historique sans mention */ } }
  const o = t.origine;
  const lies = (liste, titre, vide) => `<section class="trac-bloc"><h3>${titre}</h3>${liste.length ? `<ul class="trac-liens">${liste.map((d) => `
      <li><a href="${urlDocument(d.ent_id)}" data-document="${d.ent_id}">${echapper(d.type_libelle)} ${echapper(d.numero ?? `#${d.ent_id}`)}${d.indice && d.indice !== 'A' ? ` (${echapper(d.indice)})` : ''}</a>
        <span class="aide">${echapper(LIENS[d.lien] ?? d.lien)} · ${echapper(d.statut ?? '')} · ${date(d.date)}${d.objet ? ` · ${echapper(d.objet)}` : ''}</span></li>`).join('')}</ul>` : `<p class="aide">${vide}</p>`}</section>`;
  const rapport = o?.dor_rapport ?? null;
  zone.innerHTML = `<div class="tracabilite">
    <section class="trac-bloc"><h3>${texteHtml('documents_btp.tracabilite.origine')}</h3>${o ? `
      <p>${iconeHtml('documents_btp_importe')} ${texteHtml('documents_btp.tracabilite.importe_html', { format: o.dor_format, date: date(o.dor_date, true), utilisateur: o.dor_utilisateur })}${o.dor_reference ? ` — ${texteHtml('documents_btp.tracabilite.reference_html', { reference: o.dor_reference })}` : ''}.</p>
      ${receptionSousTraitanceHtml(rapport)}
      <p>${texteHtml('documents_btp.tracabilite.fichier', { nom: o.dor_nom_fichier ?? '—' })}${o.dor_fichier_id ? ` ${texteHtml('documents_btp.tracabilite.conserve')}` : ` <span class="aide">${texteHtml('documents_btp.tracabilite.non_conserve')}</span>`}</p>
      <div class="boutons">${o.dor_fichier_id && ged ? `<button type="button" data-trac="telecharger">${iconeHtml('telecharger')} ${texteHtml('documents_btp.tracabilite.telecharger')}</button>
        <button type="button" data-trac="reimporter" title="${texteHtml('documents_btp.tracabilite.reimporter_aide')}">${iconeHtml('documents_btp_reimporter')} ${texteHtml('documents_btp.tracabilite.reimporter')}</button>` : ''}</div>
      ${debogage && rapport ? `<details class="trac-rapport" open><summary>${texteHtml('documents_btp.tracabilite.rapport')}</summary>${tableNonRepris(rapport.non_repris ?? [])}
        ${(rapport.avertissements ?? []).length ? `<ul class="import-avertissements">${rapport.avertissements.map((a) => `<li>${iconeHtml('avertissement')} ${echapper(a)}</li>`).join('')}</ul>` : ''}</details>` : ''}`
    : `<p class="aide">${texteHtml('documents_btp.tracabilite.saisi')}</p>`}</section>
    ${lies(t.sources, texteHtml('documents_btp.tracabilite.issu_de'), texteHtml('documents_btp.tracabilite.aucune_source'))}
    ${lies(t.cibles, texteHtml('documents_btp.tracabilite.cibles'), texteHtml('documents_btp.tracabilite.aucune_cible'))}
    ${relances ? '<section class="trac-bloc trac-relances" data-relances hidden></section>' : ''}
    <section class="trac-bloc"><h3>${texteHtml('documents_btp.tracabilite.historique')}</h3>${t.historique.length ? `
      <p class="aide">${texteHtml(restaurer ? 'documents_btp.tracabilite.versions_aide' : 'documents_btp.tracabilite.versions_lecture')}</p>
      <table class="table-analyse"><thead><tr><th>${texteHtml('documents_btp.tracabilite.colonnes.version')}</th><th>${texteHtml('documents_btp.tracabilite.colonnes.action')}</th><th>${texteHtml('documents_btp.tracabilite.colonnes.date')}</th><th>${texteHtml('documents_btp.tracabilite.colonnes.utilisateur')}</th>
        <th>${texteHtml('documents_btp.tracabilite.colonnes.total_ht')}</th><th>${texteHtml('documents_btp.tracabilite.colonnes.lignes')}</th><th>${texteHtml('documents_btp.tracabilite.colonnes.motif')}</th>${restaurer ? '<th></th>' : ''}</tr></thead><tbody>
      ${t.historique.map((h) => `<tr><td class="nombre">${h.his_version}</td><td>${echapper(ACTIONS[h.his_action] ?? h.his_action)}</td><td>${date(h.his_date, true)}</td><td>${echapper(h.his_utilisateur)}${mentionAgentHtml(agents.get(Number(h.his_id)))}</td>
        <td class="nombre">${h.total_ht === null || h.total_ht === undefined ? '' : formatNombre(h.total_ht, 2)}</td><td class="nombre">${h.nombre_lignes ?? ''}</td><td>${echapper(h.his_motif ?? '')}</td>
        ${restaurer ? `<td><button type="button" data-restaurer="${h.his_id}" title="${texteHtml('documents_btp.tracabilite.restaurer_aide', { version: h.his_version })}">${iconeHtml('documents_btp_restaurer')} ${texteHtml('documents_btp.tracabilite.restaurer')}</button></td>` : ''}</tr>`).join('')}</tbody></table>`
    : `<p class="aide">${texteHtml('documents_btp.tracabilite.aucune_version')}</p>`}</section>
  </div>`;
  if (relances) afficherJournalRelances(zone.querySelector('[data-relances]'), { filtre: relances, naviguer: (url, e) => naviguer(url, e) });
  zone.querySelectorAll('[data-restaurer]').forEach((b) => b.addEventListener('click', () => {
    const h = t.historique.find((x) => x.his_id === Number(b.dataset.restaurer));
    if (h) restaurer(h);
  }));
  zone.querySelectorAll('[data-document]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); naviguer(urlDocument(a.dataset.document), e); }));
  zone.querySelector('[data-trac="telecharger"]')?.addEventListener('click', async () => {
    const v = await derniereVersionGed(ged, o.dor_fichier_id);
    if (v) window.open(ged.urlContenu(v.id, { telecharger: true }), '_blank');
  });
  zone.querySelector('[data-trac="reimporter"]')?.addEventListener('click', () => reimporter(o));
}
