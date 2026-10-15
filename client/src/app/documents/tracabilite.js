import { echapper } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { tableNonRepris } from '../import/rapport-import.js';

// Onglet Traçabilité d'un document : origine (import : format, fichier source conservé dans la GED, réutilisable),
// documents dont il est issu et documents qui en sont issus (transformations, copies), historique des versions.
// Le rapport des champs non repris d'un import n'est affiché qu'en mode débogage (vue de colonnes).

const ACTIONS = { CREATION: 'Création', MODIFICATION: 'Modification', VALIDATION: 'Validation', ANNULATION: 'Annulation' };
const LIENS = { TRANSFORMATION: 'Transformation', COPIE: 'Copie' };
const date = (d, heure = false) => (d ? new Date(d).toLocaleString('fr-FR', heure ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' }) : '');

/** Version la plus récente d'un document de la GED (pour télécharger ou réutiliser le fichier source). */
export async function derniereVersionGed(ged, id) {
  const d = await ged.document(id);
  return [...(d.versions ?? [])].sort((a, b) => b.numero - a.numero)[0] ?? null;
}

/**
 * Rendu de l'onglet. options : entId, ged (fournisseur GED, facultatif), debogage (booléen), naviguer(url, e),
 * reimporter(origine) (relance l'import du fichier source).
 */
export async function afficherTracabilite(zone, { entId, ged, debogage, naviguer, reimporter }) {
  zone.innerHTML = '<p class="aide">Chargement…</p>';
  const t = await api.tracabilite(entId);
  const o = t.origine;
  const lies = (liste, titre, vide) => `<section class="trac-bloc"><h3>${titre}</h3>${liste.length ? `<ul class="trac-liens">${liste.map((d) => `
      <li><a href="/document/${d.ent_id}" data-document="${d.ent_id}">${echapper(d.type_libelle)} ${echapper(d.numero ?? `#${d.ent_id}`)}${d.indice && d.indice !== 'A' ? ` (${echapper(d.indice)})` : ''}</a>
        <span class="aide">${echapper(LIENS[d.lien] ?? d.lien)} · ${echapper(d.statut ?? '')} · ${date(d.date)}${d.objet ? ` · ${echapper(d.objet)}` : ''}</span></li>`).join('')}</ul>` : `<p class="aide">${vide}</p>`}</section>`;
  const rapport = o?.dor_rapport ?? null;
  zone.innerHTML = `<div class="tracabilite">
    <section class="trac-bloc"><h3>Origine</h3>${o ? `
      <p>📥 Importé depuis <b>${echapper(o.dor_format)}</b> le ${date(o.dor_date, true)} par ${echapper(o.dor_utilisateur)}${o.dor_reference ? ` — référence d'origine <b>${echapper(o.dor_reference)}</b>` : ''}.</p>
      <p>Fichier source : ${echapper(o.dor_nom_fichier ?? '—')}${o.dor_fichier_id ? ' (conservé dans les pièces du document)' : ' <span class="aide">(non conservé)</span>'}</p>
      <div class="boutons">${o.dor_fichier_id && ged ? `<button type="button" data-trac="telecharger">⬇ Télécharger le fichier</button>
        <button type="button" data-trac="reimporter" title="Relire le fichier source et ouvrir un nouveau devis importé à vérifier">↻ Réutiliser l'import</button>` : ''}</div>
      ${debogage && rapport ? `<details class="trac-rapport" open><summary>Rapport d'import (mode débogage)</summary>${tableNonRepris(rapport.non_repris ?? [])}
        ${(rapport.avertissements ?? []).length ? `<ul class="import-avertissements">${rapport.avertissements.map((a) => `<li>⚠ ${echapper(a)}</li>`).join('')}</ul>` : ''}</details>` : ''}`
    : '<p class="aide">Document saisi dans LogiBTP (ni import, ni transformation).</p>'}</section>
    ${lies(t.sources, 'Issu de', 'Aucun document d\'origine.')}
    ${lies(t.cibles, 'Documents issus de celui-ci', 'Aucun document créé à partir de celui-ci.')}
    <section class="trac-bloc"><h3>Historique</h3>${t.historique.length ? `<table class="table-analyse"><thead><tr><th>Version</th><th>Action</th><th>Date</th><th>Utilisateur</th></tr></thead><tbody>
      ${t.historique.map((h) => `<tr><td class="nombre">${h.his_version}</td><td>${echapper(ACTIONS[h.his_action] ?? h.his_action)}</td><td>${date(h.his_date, true)}</td><td>${echapper(h.his_utilisateur)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="aide">Aucune version enregistrée.</p>'}</section>
  </div>`;
  zone.querySelectorAll('[data-document]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); naviguer(`/document/${a.dataset.document}`, e); }));
  zone.querySelector('[data-trac="telecharger"]')?.addEventListener('click', async () => {
    const v = await derniereVersionGed(ged, o.dor_fichier_id);
    if (v) window.open(ged.urlContenu(v.id, { telecharger: true }), '_blank');
  });
  zone.querySelector('[data-trac="reimporter"]')?.addEventListener('click', () => reimporter(o));
}
