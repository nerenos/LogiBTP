import { echapper, creerCombo, formatNombre } from '@logibtp/socle/ui';
import { api } from '../api.js';

// Module Exécution (lot 1) : panneau « Exécution » de l'entête d'un ordre (famille E) et bloc de répartition du détail
// d'une ligne. L'exécution (état, motif, service, responsable, dates prévues) s'enregistre à part du document : elle
// reste modifiable sur un ordre validé.

export const ETATS_EXECUTION = {
  A_FAIRE: { libelle: 'À faire', icone: '⚪' },
  EN_ATTENTE: { libelle: 'En attente', icone: '⏸' },
  EN_COURS: { libelle: 'En cours', icone: '🔵' },
  BLOQUE: { libelle: 'Bloqué', icone: '⛔' },
  TERMINE: { libelle: 'Terminé', icone: '✅' },
};

/** Types d'ordres du lot 1 (codes de type_document, db/197). */
export const TYPES_ORDRE = { E_OE: "Ordre d'exécution", E_PO: 'Ordre de pose', E_DAP: "Demande d'approvisionnement" };

const nombre = (v, d = 2) => (v === null || v === undefined || v === '' ? '' : formatNombre(Number(v), d));
const date = (d) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

/** Pastille d'état d'exécution. */
export function pastilleExecution(etat) {
  const e = ETATS_EXECUTION[etat ?? 'A_FAIRE'] ?? { libelle: etat, icone: '•' };
  return `<span class="pastille-execution etat-${echapper(etat ?? 'A_FAIRE')}">${e.icone} ${echapper(e.libelle)}</span>`;
}

let referentiels = null;
/** Motifs de blocage, services, individus de notre société (chargés une fois par fenêtre). */
async function chargerReferentiels(individus) {
  referentiels ??= Promise.all([api.ressources.motifs('BLOCAGE'), api.services(), individus()]).then(([motifs, services, inds]) => ({
    motifs: motifs.filter((m) => m.actif).map((m) => ({ valeur: m.id, libelle: m.libelle, detail: m.service ?? '' })),
    services: services.filter((s) => s.actif).map((s) => ({ valeur: s.id, libelle: s.libelle, detail: s.code })),
    individus: inds,
  }));
  return referentiels;
}

/**
 * Panneau « Exécution » d'un ordre : état (motif obligatoire pour bloquer ; tâche du CRM au service du motif), commentaire,
 * service, responsable, dates prévues ; heures de main-d'œuvre par service ; historique ; ordre d'exécution : budget
 * vendu / de référence / planifié (E16).
 */
export async function rendreExecution(bloc, { app, entId, typeCode, individus, surChange = () => {} }) {
  if (!entId) { bloc.innerHTML = '<p class="aide">Enregistrez l\'ordre pour suivre son exécution.</p>'; return; }
  const [x, refs] = await Promise.all([api.execution.document(entId), chargerReferentiels(individus)]);
  const s = { etat: x.etat, motif_id: x.motif_id, commentaire: x.commentaire, srv_id: x.srv_id, responsable_id: x.responsable_id, debut_prevu: x.debut_prevu, fin_prevue: x.fin_prevue };
  const budget = x.budget;
  const ligneBudget = (titre, t) => `<tr><td>${titre}</td><td class="nombre">${nombre(t?.pr)}</td><td class="nombre">${nombre(t?.ht)}</td><td class="nombre">${nombre(t?.heures)}</td></tr>`;
  const reference = budget?.versions?.find((v) => v.reference);
  bloc.innerHTML = `<div class="execution-ordre">
    <p class="ligne"><label>État <span data-etat></span></label> <span data-motif-zone ${s.etat === 'BLOQUE' ? '' : 'hidden'}><label>Motif <span data-motif></span></label></span></p>
    <p><label>Commentaire<br><textarea data-c="commentaire" rows="2" cols="50">${echapper(s.commentaire ?? '')}</textarea></label></p>
    <p class="ligne"><label>Service <span data-service></span></label> <label>Responsable <span data-responsable></span></label></p>
    <p class="ligne"><label>Début prévu <input type="date" data-c="debut_prevu" value="${echapper(s.debut_prevu ?? '')}"></label>
      <label>Fin prévue <input type="date" data-c="fin_prevue" value="${echapper(s.fin_prevue ?? '')}"></label></p>
    <p class="connexion-erreur" data-erreur hidden></p>
    <p><button type="button" class="principal" data-enregistrer>Enregistrer l'exécution</button></p>
    ${x.heures?.length ? `<p class="aide">Heures de main-d'œuvre : ${x.heures.map((h) => `${echapper(h.service ?? 'sans service')} ${nombre(h.heures)} h`).join(' · ')}${x.heures_realisees ? ` · réalisé ${nombre(x.heures_realisees)} h` : ''}</p>` : ''}
    ${budget ? `<h4>Budget</h4><table><thead><tr><th></th><th class="nombre">Déboursé (PR)</th><th class="nombre">Vente HT</th><th class="nombre">Heures</th></tr></thead><tbody>
      ${ligneBudget('Vendu (commandes)', budget.vendu)}${reference ? ligneBudget(`Référence (${date(reference.le)})`, reference) : ''}${ligneBudget('Planifié (cet ordre)', budget.planifie)}</tbody></table>
      ${reference && budget.planifie?.pr !== null ? `<p class="aide">Dérive du planifié sur la référence : ${nombre(Number(budget.planifie.pr ?? 0) - Number(reference.pr ?? 0))} € de déboursé.</p>` : '<p class="aide">Le budget de référence est figé à la première validation de l\'ordre.</p>'}` : ''}
    ${x.historique?.length ? `<details><summary>Historique (${x.historique.length})</summary><ul class="liste-simple">${x.historique.map((h) => `<li>${date(h.le)} · ${echapper(h.par)} : ${pastilleExecution(h.etat)}
      ${h.motif ? ` — ${echapper(h.motif)}` : ''}${h.detail ? ` <small class="aide">(${echapper(h.detail)})</small>` : ''}${h.commentaire ? `<br><small>${echapper(h.commentaire)}</small>` : ''}</li>`).join('')}</ul></details>` : ''}
  </div>`;
  const combo = (sel, options, valeur, vide, champ, apres = () => {}) => {
    const c = creerCombo({ options, valeur: valeur ?? '', vide });
    c.addEventListener('change', () => { s[champ] = c.valeurCombo === '' ? null : (typeof options[0]?.valeur === 'number' ? Number(c.valeurCombo) : c.valeurCombo); apres(); });
    bloc.querySelector(sel).append(c);
  };
  combo('[data-etat]', Object.entries(ETATS_EXECUTION).map(([valeur, e]) => ({ valeur, libelle: `${e.icone} ${e.libelle}` })), s.etat, false, 'etat',
    () => { bloc.querySelector('[data-motif-zone]').hidden = s.etat !== 'BLOQUE'; });
  combo('[data-motif]', refs.motifs, s.motif_id, true, 'motif_id');
  combo('[data-service]', refs.services, s.srv_id, true, 'srv_id');
  combo('[data-responsable]', refs.individus, s.responsable_id, true, 'responsable_id');
  bloc.querySelectorAll('[data-c]').forEach((c) => c.addEventListener('change', () => { s[c.dataset.c] = c.value || null; }));
  bloc.querySelector('[data-enregistrer]').addEventListener('click', async () => {
    const erreur = bloc.querySelector('[data-erreur]');
    if (s.etat === 'BLOQUE' && !s.motif_id) { erreur.textContent = 'Motif obligatoire pour bloquer un ordre'; erreur.hidden = false; return; }
    try {
      await api.execution.enregistrer(entId, s);
      app.message(s.etat === 'BLOQUE' ? 'Ordre bloqué : le service du motif est prévenu (tâche du suivi si le module CRM est actif)' : 'Exécution enregistrée', 'succes');
      app.publier('enregistre', { type: typeCode, ids: [entId] });
      surChange();
      await rendreExecution(bloc, { app, entId, typeCode, individus, surChange });
    } catch (e) { erreur.textContent = e.message; erreur.hidden = false; }
  });
}

/**
 * Bloc « Exécution » du détail d'une ligne d'un ordre suivant (E3, E17) : ligne de l'ordre parent (quantité, déboursé,
 * heures), déjà réparti dans les ordres du même type, reste ; dépassement en rouge. `info` : ligne de la répartition.
 */
export function sectionRepartition(info) {
  if (!info) return '';
  return `<fieldset class="execution-repartition${info.depassement ? ' depassement' : ''}"><legend>Exécution</legend>
    <dl class="definitions"><dt>Ordre parent</dt><dd>${echapper(TYPES_ORDRE[info.type_source] ?? info.type_source)} <a href="/document/${info.source_ent_id}">${echapper(info.numero_source ?? '')}</a></dd>
    <dt>Quantité de l'ordre parent</dt><dd>${nombre(info.qte_source, 3)} ${echapper(info.unite ?? '')}</dd>
    ${info.montant_pr_source !== null ? `<dt>Budget (déboursé)</dt><dd>${nombre(info.montant_pr_source)} €</dd>` : ''}
    ${info.heures_source ? `<dt>Heures</dt><dd>${nombre(info.heures_source)} h</dd>` : ''}
    <dt>Déjà réparti</dt><dd>${nombre(info.deja_reparti, 3)} dans ${info.nb_ordres} autre(s) ordre(s) du même type</dd>
    <dt>Reste après cet ordre</dt><dd class="${info.depassement ? 'erreur' : ''}">${nombre(info.reste, 3)}${info.depassement ? ' — dépassement de la quantité de l\'ordre parent' : ''}</dd></dl></fieldset>`;
}
