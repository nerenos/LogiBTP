import { urlDocument, MODULE_FACULTATIF, SUJET_FENETRE } from '../codes.js';
import { echapper, creerCombo, formatNombre, formatDateHeure } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { rendreEtapes, optionsRessources, ressourceDe } from './etapes.js';

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

/** Types d'ordres (codes de type_document, db/197 et db/208). */
export const TYPES_ORDRE = {
  E_OE: "Ordre d'exécution", E_BE: "Ordre du bureau d'études", E_BM: 'Ordre du bureau des méthodes', E_OF: 'Ordre de fabrication',
  E_CO: 'Ordre de colisage', E_LI: 'Ordre de livraison', E_PO: 'Ordre de pose', E_SAV: 'Intervention SAV', E_OST: 'Ordre de sous-traitance',
  E_DAP: "Demande d'approvisionnement", E_DAC: "Demande d'achat", E_ENT: "Ordre d'entretien du matériel",
};

const nombre = (v, d = 2) => (v === null || v === undefined || v === '' ? '' : formatNombre(Number(v), d));

/** Pastille d'état d'exécution. */
export function pastilleExecution(etat) {
  const e = ETATS_EXECUTION[etat ?? 'A_FAIRE'] ?? { libelle: etat, icone: '•' };
  return `<span class="pastille-execution etat-${echapper(etat ?? 'A_FAIRE')}">${e.icone} ${echapper(e.libelle)}</span>`;
}

let referentiels = null;
/** Motifs de blocage, services, individus de notre société (chargés une fois par fenêtre). */
async function chargerReferentiels(individus) {
  referentiels ??= Promise.all([api.ressources.motifs('BLOCAGE'), api.services(), individus(), api.execution.ressources().catch(() => [])]).then(([motifs, services, inds, ressources]) => ({
    motifs: motifs.filter((m) => m.actif).map((m) => ({ valeur: m.id, libelle: m.libelle, detail: m.service ?? '' })),
    services: services.filter((s) => s.actif).map((s) => ({ valeur: s.id, libelle: s.libelle, detail: s.code })),
    individus: inds,
    ressources,
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
  const s = {
    etat: x.etat, motif_id: x.motif_id, commentaire: x.commentaire, srv_id: x.srv_id, responsable_id: x.responsable_id, debut_prevu: x.debut_prevu, fin_prevue: x.fin_prevue,
    ressource: x.ressource ?? null,
  };
  const budget = x.budget;
  const ligneBudget = (titre, t) => `<tr><td>${titre}</td><td class="nombre">${nombre(t?.pr)}</td><td class="nombre">${nombre(t?.ht)}</td><td class="nombre">${nombre(t?.heures)}</td></tr>`;
  const reference = budget?.versions?.find((v) => v.reference);
  bloc.innerHTML = `<div class="execution-ordre">
    <div data-etapes></div>
    <p class="ligne"><label>État <span data-etat></span></label> <span data-motif-zone ${s.etat === 'BLOQUE' ? '' : 'hidden'}><label>Motif <span data-motif></span></label></span></p>
    <p><label>Commentaire<br><textarea data-c="commentaire" rows="2" cols="50">${echapper(s.commentaire ?? '')}</textarea></label></p>
    <p class="ligne"><label>Service <span data-service></span></label> <label>Responsable <span data-responsable></span></label>
      <label>Ressource principale <span data-ressource></span></label></p>
    <p class="ligne"><label>Début prévu <input type="date" data-c="debut_prevu" value="${echapper(s.debut_prevu ?? '')}"></label>
      <label>Fin prévue <input type="date" data-c="fin_prevue" value="${echapper(s.fin_prevue ?? '')}"></label></p>
    <p class="connexion-erreur" data-erreur hidden></p>
    <p><button type="button" class="principal" data-enregistrer>Enregistrer l'exécution</button></p>
    ${x.heures?.length ? `<p class="aide">Heures de main-d'œuvre : ${x.heures.map((h) => `${echapper(h.service ?? 'sans service')} ${nombre(h.heures)} h`).join(' · ')}${x.heures_realisees ? ` · réalisé ${nombre(x.heures_realisees)} h` : ''}</p>` : ''}
    <div data-planning-ordre></div>
    ${budget ? `<h4>Budget</h4><table><thead><tr><th></th><th class="nombre">Déboursé (PR)</th><th class="nombre">Vente HT</th><th class="nombre">Heures</th></tr></thead><tbody>
      ${ligneBudget('Vendu (commandes)', budget.vendu)}${reference ? ligneBudget(`Référence (${formatDateHeure(reference.le)})`, reference) : ''}${ligneBudget('Planifié (cet ordre)', budget.planifie)}</tbody></table>
      ${reference && budget.planifie?.pr !== null ? `<p class="aide">Dérive du planifié sur la référence : ${nombre(Number(budget.planifie.pr ?? 0) - Number(reference.pr ?? 0))} € de déboursé.</p>` : '<p class="aide">Le budget de référence est figé à la première validation de l\'ordre.</p>'}` : ''}
    ${x.historique?.length ? `<details><summary>Historique (${x.historique.length})</summary><ul class="liste-simple">${x.historique.map((h) => `<li>${formatDateHeure(h.le)} · ${echapper(h.par)} : ${pastilleExecution(h.etat)}
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
  const cRessource = creerCombo({ options: optionsRessources(refs.ressources), valeur: s.ressource ? `${s.ressource.type}:${s.ressource.id}` : '', vide: true });
  cRessource.addEventListener('change', () => { s.ressource = ressourceDe(cRessource.valeurCombo, refs.ressources); });
  bloc.querySelector('[data-ressource]').append(cRessource);
  // Étapes de l'ordre (lot 2c) : une action peut changer l'état d'exécution et les dates prévues : panneau relu.
  rendreEtapes(bloc.querySelector('[data-etapes]'), {
    app, entId, ressources: refs.ressources, ressourceOrdre: s.ressource,
    surChange: () => { app.publier(SUJET_FENETRE.ENREGISTRE, { type: typeCode, ids: [entId] }); surChange(); rendreExecution(bloc, { app, entId, typeCode, individus, surChange }); },
  });
  bloc.querySelectorAll('[data-c]').forEach((c) => c.addEventListener('change', () => { s[c.dataset.c] = c.value || null; }));
  if (app.moduleActif(MODULE_FACULTATIF.PLANNING)) rendrePlanningOrdre(bloc.querySelector('[data-planning-ordre]'), { app, entId, recharger: () => rendreExecution(bloc, { app, entId, typeCode, individus, surChange }) });
  bloc.querySelector('[data-enregistrer]').addEventListener('click', async () => {
    const erreur = bloc.querySelector('[data-erreur]');
    if (s.etat === 'BLOQUE' && !s.motif_id) { erreur.textContent = 'Motif obligatoire pour bloquer un ordre'; erreur.hidden = false; return; }
    try {
      await api.execution.enregistrer(entId, s);
      app.message(s.etat === 'BLOQUE' ? 'Ordre bloqué : le service du motif est prévenu (tâche du suivi si le module CRM est actif)' : 'Exécution enregistrée', 'succes');
      app.publier(SUJET_FENETRE.ENREGISTRE, { type: typeCode, ids: [entId] });
      surChange();
      await rendreExecution(bloc, { app, entId, typeCode, individus, surChange });
    } catch (e) { erreur.textContent = e.message; erreur.hidden = false; }
  });
}

/**
 * Liaison Exécution ↔ Planning (P15) : l'ordre se planifie (tâche théorique de ses heures, service et dates) ; les dates
 * de ses tâches lui sont proposées, l'utilisateur les accepte ou non.
 */
async function rendrePlanningOrdre(zone, { app, entId, recharger }) {
  const p = await api.liaisons.proposition(entId).catch(() => null);
  if (!p) return;
  zone.innerHTML = `<h4>Planning</h4>${p.taches ? `<p class="aide">${p.taches} tâche(s) au planning : du ${formatDateHeure(p.debut)} au ${formatDateHeure(p.fin)}.</p>
      ${p.ecart ? `<p class="avertissement">Le planning propose d'autres dates que celles de l'ordre (${formatDateHeure(p.debut_ordre) || '—'} → ${formatDateHeure(p.fin_ordre) || '—'}). <button type="button" data-accepter>Accepter les dates du planning</button></p>` : ''}`
    : '<p class="aide">Ordre non planifié.</p>'}
    <p><button type="button" data-planifier>📅 Planifier l'ordre</button>
      <button type="button" data-planifier-etapes title="Une tâche par étape (jalons de durée nulle, attentes en décalage), après les ordres amont du parcours">📅 Planifier les étapes</button>
      <a href="/planning?vue=CHANTIERS_GANTT">Ouvrir le planning</a></p>`;
  zone.querySelector('[data-planifier]').addEventListener('click', async () => {
    try { await api.liaisons.planifierOrdre(entId); app.message('Tâche créée au planning', 'succes'); await rendrePlanningOrdre(zone, { app, entId, recharger }); } catch (e) { app.erreur(e); }
  });
  zone.querySelector('[data-planifier-etapes]').addEventListener('click', async () => {
    try {
      const r = await api.liaisons.planifierEtapes(entId);
      app.message(r.taches.length ? `${r.taches.length} tâche(s) créée(s) au planning` : 'Toutes les étapes sont déjà au planning', 'succes');
      await recharger();
    } catch (e) { app.erreur(e); }
  });
  zone.querySelector('[data-accepter]')?.addEventListener('click', async () => {
    try { await api.liaisons.accepterProposition(entId); app.message('Dates du planning reprises par l\'ordre', 'succes'); await recharger(); } catch (e) { app.erreur(e); }
  });
}

/**
 * Bloc « Exécution » du détail d'une ligne d'un ordre suivant (E3, E17) : ligne de l'ordre parent (quantité, déboursé,
 * heures), déjà réparti dans les ordres du même type, reste ; dépassement en rouge. `info` : ligne de la répartition.
 */
export function sectionRepartition(info) {
  if (!info) return '';
  return `<fieldset class="execution-repartition${info.depassement ? ' depassement' : ''}"><legend>Exécution</legend>
    <dl class="definitions"><dt>Ordre parent</dt><dd>${echapper(TYPES_ORDRE[info.type_source] ?? info.type_source)} <a href="${urlDocument(info.source_ent_id)}">${echapper(info.numero_source ?? '')}</a></dd>
    <dt>Quantité de l'ordre parent</dt><dd>${nombre(info.qte_source, 3)} ${echapper(info.unite ?? '')}</dd>
    ${info.montant_pr_source !== null ? `<dt>Budget (déboursé)</dt><dd>${nombre(info.montant_pr_source)} €</dd>` : ''}
    ${info.heures_source ? `<dt>Heures</dt><dd>${nombre(info.heures_source)} h</dd>` : ''}
    <dt>Déjà réparti</dt><dd>${nombre(info.deja_reparti, 3)} dans ${info.nb_ordres} autre(s) ordre(s) du même type</dd>
    <dt>Reste après cet ordre</dt><dd class="${info.depassement ? 'erreur' : ''}">${nombre(info.reste, 3)}${info.depassement ? ' — dépassement de la quantité de l\'ordre parent' : ''}</dd></dl></fieldset>`;
}
