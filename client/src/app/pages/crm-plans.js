import { PageBase } from '@logibtp/navigation';
import { echapper } from '@logibtp/socle/ui';
import { STATUTS_PLAN } from '@logibtp/crm';
import { api } from '../api.js';
import { lienElement } from '../crm/crm.js';

/** Pastille du statut d'un plan (dernier indice). */
export const pastillePlan = (etat) => `<span class="crm-etat crm-plan-${String(etat.statut).toLowerCase()}">${echapper(STATUTS_PLAN.find((s) => s.valeur === etat.statut)?.libelle ?? etat.statut)}</span>`;

/**
 * Plans et visas (module CRM, suivi des validations) : `/crm/plans?type=&id=&recherche=`. Plans d'un élément (chantier,
 * affaire…) ou de tous : dernier indice, indice en vigueur (bon pour exécution), visas manquants et en retard ;
 * nouveau plan, bordereau de diffusion des plans choisis.
 */
export class PagePlansCrm extends PageBase {
  icone = '📐';

  async ouvrir() {
    const app = this.app;
    this.element = this.requete.type && this.requete.id ? { type: this.requete.type, id: String(this.requete.id) } : null;
    this.recherche = this.requete.recherche ?? '';
    const e = this.element ? (await api.crm.elements([this.element]))[0] : null;
    this.libelle = e?.libelle ?? '';
    this.titre = e ? `Plans : ${e.libelle}` : 'Plans et visas';
    this.conteneur.innerHTML = `<div class="page-parametres page-crm"><h1 class="page-titre">📐 Plans et visas${e ? ` : ${lienElement(e)}` : ''}</h1>
      <div class="crm-filtres"><input type="search" data-recherche placeholder="Rechercher (repère, nom, lot)" value="${echapper(this.recherche)}">
        <button type="button" data-diffuser title="Bordereau de diffusion des plans cochés (dernier indice)">📤 Diffuser la sélection…</button>
        ${this.element ? `<a href="/crm/diffusions?type=${encodeURIComponent(this.element.type)}&id=${encodeURIComponent(this.element.id)}">Bordereaux</a>` : '<a href="/crm/diffusions">Bordereaux</a>'}
        <button type="button" class="principal" data-nouveau>＋ Nouveau plan</button></div>
      <div data-corps></div></div>`;
    const $ = (s) => this.conteneur.querySelector(s);
    let minuterie;
    $('[data-recherche]').addEventListener('input', (ev) => { clearTimeout(minuterie); minuterie = setTimeout(() => { this.recherche = ev.target.value; this.charger(); }, 300); });
    const suffixe = this.element ? `type_element=${encodeURIComponent(this.element.type)}&id_element=${encodeURIComponent(this.element.id)}` : '';
    $('[data-nouveau]').addEventListener('click', (ev) => app.naviguer(`/crm/plan/nouveau${suffixe ? `?${suffixe}` : ''}`, { nouvelleFenetre: ev.ctrlKey || ev.shiftKey }));
    $('[data-diffuser]').addEventListener('click', () => {
      const ids = [...this.conteneur.querySelectorAll('[data-choix]:checked')].map((c) => c.dataset.choix);
      if (!ids.length) { app.message('Cochez les plans à diffuser', 'avertissement'); return; }
      app.naviguer(`/crm/diffusion/nouveau?plans=${ids.join(',')}${suffixe ? `&${suffixe}` : ''}`);
    });
    this.desabonner = app.abonner('crm', () => this.charger());
    await this.charger();
  }

  urlCourante() {
    const p = new URLSearchParams(Object.entries({ type: this.element?.type, id: this.element?.id, recherche: this.recherche }).filter(([, v]) => v));
    return `/crm/plans${p.toString() ? `?${p}` : ''}`;
  }

  async reprendre() { await this.charger(); }

  fermer() { this.desabonner?.(); }

  async charger() {
    const corps = this.conteneur.querySelector('[data-corps]');
    if (!corps) return;
    let plans;
    try { plans = await api.crm.plans({ type_element: this.element?.type, id_element: this.element?.id, recherche: this.recherche }); } catch (e) { corps.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    if (!plans.length) { corps.innerHTML = '<p class="aide">Aucun plan.</p>'; return; }
    corps.innerHTML = `<table class="crm-table"><thead><tr><th></th><th>Repère</th><th>Nom</th><th>Lot</th><th>Repère CCTP</th>${this.element ? '' : '<th>Rattachement</th>'}
      <th>Indice</th><th>En vigueur</th><th>Statut</th><th class="nombre">Visas attendus</th></tr></thead><tbody>
      ${plans.map((p) => `<tr><td><input type="checkbox" data-choix="${p.id}" ${p.nb_indices ? '' : 'disabled title="Créez d\'abord un indice"'}></td>
        <td><a href="/crm/plan/${p.id}"><b>${echapper(p.repere)}</b></a></td><td>${echapper(p.nom)}</td><td>${echapper(p.lot ?? '')}</td><td>${echapper(p.repere_cctp ?? '')}</td>
        ${this.element ? '' : `<td>${lienElement(p.element)}</td>`}<td>${echapper(p.etat.indice === '' ? '(vide)' : p.etat.indice ?? '')}</td><td>${echapper(p.etat.en_vigueur === '' ? '(vide)' : p.etat.en_vigueur ?? '—')}</td><td>${pastillePlan(p.etat)}</td>
        <td class="nombre${p.etat.retards ? ' crm-retard' : ''}">${p.etat.manquants || ''}${p.etat.retards ? ` (${p.etat.retards} en retard)` : ''}</td></tr>`).join('')}</tbody></table>`;
  }
}
