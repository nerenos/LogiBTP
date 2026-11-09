import { texte, texteHtml, textesParCode, pluriel, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { urlDocument, MODULE_FACULTATIF, SUJET_FENETRE, TYPE_DOCUMENT, ETAT_RESERVE } from '../codes.js';
import { echapper, creerCombo, formatNombre, formatDate, formatDateHeure, confirmer } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { rendreEtapes, optionsRessources, ressourceDe } from './etapes.js';

// Module Exécution (lot 1) : panneau « Exécution » de l'entête d'un ordre (famille E) et bloc de répartition du détail
// d'une ligne. L'exécution (état, motif, service, responsable, dates prévues) s'enregistre à part du document : elle
// reste modifiable sur un ordre validé.

// Libellés et icônes du dictionnaire (module Personnalisation), lus à l'affichage.
const etatExecution = (code) => Object.freeze({ get libelle() { return texte(`execution_btp.etats.${code}`); }, get icone() { return icone(`execution_btp_${code.toLowerCase()}`); } });
export const ETATS_EXECUTION = Object.freeze(Object.fromEntries(['A_FAIRE', 'EN_ATTENTE', 'EN_COURS', 'BLOQUE', 'TERMINE'].map((c) => [c, etatExecution(c)])));

/** Types d'ordres (codes de type_document, db/197 et db/208). */
export const TYPES_ORDRE = textesParCode('execution_btp.types_ordre', ['E_OE', 'E_BE', 'E_BM', 'E_OF', 'E_CO', 'E_LI', 'E_PO', 'E_SAV', 'E_OST', 'E_DAP', 'E_DAC', 'E_ENT']);

const nombre = (v, d = 2) => (v === null || v === undefined || v === '' ? '' : formatNombre(Number(v), d));

/** Pastille d'état d'exécution. */
export function pastilleExecution(etat) {
  const e = ETATS_EXECUTION[etat ?? 'A_FAIRE'] ?? { libelle: etat, icone: icone('execution_btp_puce') };
  return `<span class="pastille-execution etat-${echapper(etat ?? 'A_FAIRE')}">${echapper(e.icone)} ${echapper(e.libelle)}</span>`;
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
  if (!entId) { bloc.innerHTML = `<p class="aide">${texteHtml('execution_btp.panneau.enregistrer_dabord')}</p>`; return; }
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
    <p class="ligne"><label>${texteHtml('execution_btp.panneau.etat')} <span data-etat></span></label> <span data-motif-zone ${s.etat === 'BLOQUE' ? '' : 'hidden'}><label>${texteHtml('execution_btp.panneau.motif')} <span data-motif></span></label></span></p>
    <p><label>${texteHtml('execution_btp.panneau.commentaire')}<br><textarea data-c="commentaire" rows="2" cols="50">${echapper(s.commentaire ?? '')}</textarea></label></p>
    <p class="ligne"><label>${texteHtml('execution_btp.panneau.service')} <span data-service></span></label> <label>${texteHtml('execution_btp.panneau.responsable')} <span data-responsable></span></label>
      <label>${texteHtml('execution_btp.panneau.ressource')} <span data-ressource></span></label></p>
    <p class="ligne"><label>${texteHtml('execution_btp.panneau.debut')} <input type="date" data-c="debut_prevu" value="${echapper(s.debut_prevu ?? '')}"></label>
      <label>${texteHtml('execution_btp.panneau.fin')} <input type="date" data-c="fin_prevue" value="${echapper(s.fin_prevue ?? '')}"></label></p>
    <p class="connexion-erreur" data-erreur hidden></p>
    <p><button type="button" class="principal" data-enregistrer>${texteHtml('execution_btp.panneau.enregistrer')}</button></p>
    ${x.heures?.length ? `<p class="aide">${texteHtml('execution_btp.panneau.heures')} ${x.heures.map((h) => `${h.service ? echapper(h.service) : texteHtml('execution_btp.panneau.sans_service')} ${texteHtml('execution_btp.panneau.nb_heures', { heures: nombre(h.heures) })}`).join(' · ')}${x.heures_realisees ? ` · ${texteHtml('execution_btp.panneau.realise', { heures: nombre(x.heures_realisees) })}` : ''}</p>` : ''}
    <div data-planning-ordre></div>
    <div data-reserves-ordre></div>
    <div data-facturation-sav></div>
    ${budget ? `<h4>${texteHtml('execution_btp.panneau.budget')}</h4><table><thead><tr><th></th><th class="nombre">${texteHtml('execution_btp.panneau.debourse')}</th><th class="nombre">${texteHtml('execution_btp.panneau.vente')}</th><th class="nombre">${texteHtml('execution_btp.panneau.heures_titre')}</th></tr></thead><tbody>
      ${ligneBudget(texteHtml('execution_btp.panneau.vendu'), budget.vendu)}${reference ? ligneBudget(texteHtml('execution_btp.panneau.reference', { date: formatDateHeure(reference.le) }), reference) : ''}${ligneBudget(texteHtml('execution_btp.panneau.planifie'), budget.planifie)}</tbody></table>
      ${reference && budget.planifie?.pr !== null ? `<p class="aide">${texteHtml('execution_btp.panneau.derive', { montant: nombre(Number(budget.planifie.pr ?? 0) - Number(reference.pr ?? 0)) })}</p>` : `<p class="aide">${texteHtml('execution_btp.panneau.fige')}</p>`}` : ''}
    ${x.historique?.length ? `<details><summary>${texteHtml('execution_btp.panneau.historique', { nombre: x.historique.length })}</summary><ul class="liste-simple">${x.historique.map((h) => `<li>${formatDateHeure(h.le)} · ${echapper(h.par)} : ${pastilleExecution(h.etat)}
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
  if (typeCode === TYPE_DOCUMENT.E_PO) rendreReservesOrdre(bloc.querySelector('[data-reserves-ordre]'), entId);
  if (typeCode === TYPE_DOCUMENT.E_SAV) rendreFacturationSav(bloc.querySelector('[data-facturation-sav]'), { app, entId });
  if (app.moduleActif(MODULE_FACULTATIF.PLANNING)) rendrePlanningOrdre(bloc.querySelector('[data-planning-ordre]'), { app, entId, recharger: () => rendreExecution(bloc, { app, entId, typeCode, individus, surChange }) });
  bloc.querySelector('[data-enregistrer]').addEventListener('click', async () => {
    const erreur = bloc.querySelector('[data-erreur]');
    if (s.etat === 'BLOQUE' && !s.motif_id) { erreur.textContent = texte('execution_btp.panneau.motif_obligatoire'); erreur.hidden = false; return; }
    try {
      await api.execution.enregistrer(entId, s);
      app.message(s.etat === 'BLOQUE' ? texte('execution_btp.panneau.bloque') : texte('execution_btp.panneau.enregistree'), 'succes');
      app.publier(SUJET_FENETRE.ENREGISTRE, { type: typeCode, ids: [entId] });
      surChange();
      await rendreExecution(bloc, { app, entId, typeCode, individus, surChange });
    } catch (e) { erreur.textContent = e.message; erreur.hidden = false; }
  });
}

/**
 * Réserves suivies d'un ordre de pose (terrain-suites lot 15) : réserves de ses réceptions signées sur le terrain, état,
 * levée (date, par qui, heure de l'appareil, commentaire). Lecture seule : la levée se fait sur le terrain.
 */
async function rendreReservesOrdre(zone, entId) {
  const reserves = await api.execution.reserves(entId).catch(() => []);
  if (!reserves.length) return;
  const ouvertes = reserves.filter((r) => r.etat === ETAT_RESERVE.OUVERTE).length;
  zone.innerHTML = `<h4>${texteHtml('execution_btp.reserves.titre')}</h4>
    <p class="aide">${ouvertes ? texteHtml('execution_btp.reserves.ouvertes', { nombre: ouvertes, total: reserves.length }) : texteHtml('execution_btp.reserves.toutes_levees')}</p>
    <ul class="liste-simple">${reserves.map((r) => `<li>${r.etat === ETAT_RESERVE.LEVEE ? iconeHtml('execution_btp_reserve_levee') : iconeHtml('execution_btp_reserve_ouverte')} ${echapper(r.libelle)}
      <br><small class="aide">${r.etat === ETAT_RESERVE.LEVEE
    ? `${texteHtml('execution_btp.reserves.levee', { date: formatDateHeure(r.levee_le), par: r.levee_par ?? '' })}${r.levee_appareil_le ? ` (${texteHtml('execution_btp.reserves.levee_appareil', { date: formatDateHeure(r.levee_appareil_le) })})` : ''}${r.commentaire ? ` · ${echapper(r.commentaire)}` : ''}${r.photo_levee ? ` · ${texteHtml('execution_btp.reserves.photo')}` : ''}`
    : texteHtml('execution_btp.reserves.ouverte', { date: formatDate(r.recue_le) })}</small></li>`).join('')}</ul>`;
}

/**
 * Facture brouillon depuis le bon de SAV (terrain-suites lot 22) : temps au prix de l'article « Main-d'œuvre SAV »
 * désigné dans les paramètres de l'Exécution, fournitures du bon ; jamais validée automatiquement. Sans article désigné,
 * le bouton est masqué avec l'explication ; une facture brouillon existante est proposée à la place du bouton.
 */
async function rendreFacturationSav(zone, { app, entId }) {
  const f = await api.execution.facturationSav(entId).catch(() => null);
  if (!f) return;
  const factures = f.factures.map((x) => `<a href="${urlDocument(x.id)}">${echapper(x.numero ?? texte('execution_btp.facturation_sav.sans_numero'))}</a>${x.brouillon ? ` ${texteHtml('execution_btp.facturation_sav.brouillon')}` : ''}`).join(' · ');
  const action = !f.article
    ? `<p class="aide">${texteHtml('execution_btp.facturation_sav.sans_article')}</p>`
    : f.brouillon
      ? `<p class="aide">${texteHtml('execution_btp.facturation_sav.deja_brouillon')}</p>`
      : `<p><button type="button" data-facturer>${iconeHtml('execution_btp_facturer')} ${texteHtml('execution_btp.facturation_sav.facturer')}</button></p>`;
  zone.innerHTML = `<h4>${texteHtml('execution_btp.facturation_sav.titre')}</h4>
    <p class="aide">${texteHtml('execution_btp.facturation_sav.bon', { heures: nombre(f.heures), fournitures: f.fournitures.length })}</p>
    ${factures ? `<p>${texteHtml('execution_btp.facturation_sav.factures')} ${factures}</p>` : ''}${action}`;
  zone.querySelector('[data-facturer]')?.addEventListener('click', async () => {
    if (!(await confirmer(texte('execution_btp.facturation_sav.confirmer', { heures: nombre(f.heures), article: f.article.code, fournitures: f.fournitures.length })))) return;
    try {
      const r = await api.execution.facturerSav(entId);
      app.message(texte('execution_btp.facturation_sav.creee', { numero: r.numero ?? '' }), 'succes');
      app.naviguer(urlDocument(r.ent_id), { nouvelleFenetre: true });
      await rendreFacturationSav(zone, { app, entId });
    } catch (e) { app.erreur(e); }
  });
}

/**
 * Liaison Exécution ↔ Planning (P15) : l'ordre se planifie (tâche théorique de ses heures, service et dates) ; les dates
 * de ses tâches lui sont proposées, l'utilisateur les accepte ou non.
 */
async function rendrePlanningOrdre(zone, { app, entId, recharger }) {
  const p = await api.liaisons.proposition(entId).catch(() => null);
  if (!p) return;
  zone.innerHTML = `<h4>${texteHtml('execution_btp.planning.titre')}</h4>${p.taches ? `<p class="aide">${echapper(pluriel('execution_btp.planning.taches', p.taches))} ${texteHtml('execution_btp.planning.periode', { debut: formatDateHeure(p.debut), fin: formatDateHeure(p.fin) })}</p>
      ${p.ecart ? `<p class="avertissement">${texteHtml('execution_btp.planning.ecart', { debut: formatDateHeure(p.debut_ordre) || '—', fin: formatDateHeure(p.fin_ordre) || '—' })} <button type="button" data-accepter>${texteHtml('execution_btp.planning.accepter')}</button></p>` : ''}`
    : `<p class="aide">${texteHtml('execution_btp.planning.non_planifie')}</p>`}
    <p><button type="button" data-planifier>${iconeHtml('execution_btp_planifier')} ${texteHtml('execution_btp.planning.planifier')}</button>
      <button type="button" data-planifier-etapes title="${texteHtml('execution_btp.planning.planifier_etapes_titre')}">${iconeHtml('execution_btp_planifier')} ${texteHtml('execution_btp.planning.planifier_etapes')}</button>
      <a href="/planning?vue=CHANTIERS_GANTT">${texteHtml('execution_btp.planning.ouvrir')}</a></p>`;
  zone.querySelector('[data-planifier]').addEventListener('click', async () => {
    try { await api.liaisons.planifierOrdre(entId); app.message(texte('execution_btp.planning.tache_creee'), 'succes'); await rendrePlanningOrdre(zone, { app, entId, recharger }); } catch (e) { app.erreur(e); }
  });
  zone.querySelector('[data-planifier-etapes]').addEventListener('click', async () => {
    try {
      const r = await api.liaisons.planifierEtapes(entId);
      app.message(r.taches.length ? pluriel('execution_btp.planning.taches_crees', r.taches.length) : texte('execution_btp.planning.deja'), 'succes');
      await recharger();
    } catch (e) { app.erreur(e); }
  });
  zone.querySelector('[data-accepter]')?.addEventListener('click', async () => {
    try { await api.liaisons.accepterProposition(entId); app.message(texte('execution_btp.planning.reprises'), 'succes'); await recharger(); } catch (e) { app.erreur(e); }
  });
}

/**
 * Bloc « Exécution » du détail d'une ligne d'un ordre suivant (E3, E17) : ligne de l'ordre parent (quantité, déboursé,
 * heures), déjà réparti dans les ordres du même type, reste ; dépassement en rouge. `info` : ligne de la répartition.
 */
export function sectionRepartition(info) {
  if (!info) return '';
  return `<fieldset class="execution-repartition${info.depassement ? ' depassement' : ''}"><legend>${texteHtml('execution_btp.repartition.titre')}</legend>
    <dl class="definitions"><dt>${texteHtml('execution_btp.repartition.parent')}</dt><dd>${echapper(TYPES_ORDRE[info.type_source] ?? info.type_source)} <a href="${urlDocument(info.source_ent_id)}">${echapper(info.numero_source ?? '')}</a></dd>
    <dt>${texteHtml('execution_btp.repartition.quantite')}</dt><dd>${nombre(info.qte_source, 3)} ${echapper(info.unite ?? '')}</dd>
    ${info.montant_pr_source !== null ? `<dt>${texteHtml('execution_btp.repartition.budget')}</dt><dd>${texteHtml('execution_btp.repartition.montant', { montant: nombre(info.montant_pr_source) })}</dd>` : ''}
    ${info.heures_source ? `<dt>${texteHtml('execution_btp.panneau.heures_titre')}</dt><dd>${texteHtml('execution_btp.panneau.nb_heures', { heures: nombre(info.heures_source) })}</dd>` : ''}
    <dt>${texteHtml('execution_btp.repartition.deja')}</dt><dd>${echapper(pluriel('execution_btp.repartition.autres', info.nb_ordres, { quantite: nombre(info.deja_reparti, 3) }))}</dd>
    <dt>${texteHtml('execution_btp.repartition.reste')}</dt><dd class="${info.depassement ? 'erreur' : ''}">${nombre(info.reste, 3)}${info.depassement ? ` — ${texteHtml('execution_btp.repartition.depassement')}` : ''}</dd></dl></fieldset>`;
}
