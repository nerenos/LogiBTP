import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { SUJET_FENETRE } from '../codes.js';
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
  icone = icone('crm_btp_plans');

  async ouvrir() {
    const app = this.app;
    this.element = this.requete.type && this.requete.id ? { type: this.requete.type, id: String(this.requete.id) } : null;
    this.recherche = this.requete.recherche ?? '';
    const e = this.element ? (await api.crm.elements([this.element]))[0] : null;
    this.libelle = e?.libelle ?? '';
    this.titre = e ? texte('crm_btp.plans.titre_element', { libelle: e.libelle }) : texte('crm_btp.routes.plans');
    this.conteneur.innerHTML = `<div class="page-parametres page-crm"><h1 class="page-titre">${iconeHtml('crm_btp_plans')} ${texteHtml('crm_btp.routes.plans')}${e ? ` : ${lienElement(e)}` : ''}</h1>
      <div class="crm-filtres"><input type="search" data-recherche placeholder="${texteHtml('crm_btp.plans.recherche')}" value="${echapper(this.recherche)}">
        <button type="button" data-diffuser title="${texteHtml('crm_btp.plans.diffuser_titre')}">${iconeHtml('crm_btp_bordereaux')} ${texteHtml('crm_btp.plans.diffuser')}</button>
        ${this.element ? `<a href="/crm/diffusions?type=${encodeURIComponent(this.element.type)}&id=${encodeURIComponent(this.element.id)}">${texteHtml('crm_btp.suivi.bordereaux')}</a>` : `<a href="/crm/diffusions">${texteHtml('crm_btp.suivi.bordereaux')}</a>`}
        <button type="button" class="principal" data-nouveau>${iconeHtml('ajouter')} ${texteHtml('crm_btp.plans.nouveau')}</button></div>
      <div data-corps></div></div>`;
    const $ = (s) => this.conteneur.querySelector(s);
    let minuterie;
    $('[data-recherche]').addEventListener('input', (ev) => { clearTimeout(minuterie); minuterie = setTimeout(() => { this.recherche = ev.target.value; this.charger(); }, 300); });
    const suffixe = this.element ? `type_element=${encodeURIComponent(this.element.type)}&id_element=${encodeURIComponent(this.element.id)}` : '';
    $('[data-nouveau]').addEventListener('click', (ev) => app.naviguer(`/crm/plan/nouveau${suffixe ? `?${suffixe}` : ''}`, { nouvelleFenetre: ev.ctrlKey || ev.shiftKey }));
    $('[data-diffuser]').addEventListener('click', () => {
      const ids = [...this.conteneur.querySelectorAll('[data-choix]:checked')].map((c) => c.dataset.choix);
      if (!ids.length) { app.message(texte('crm_btp.plans.aucun_coche'), 'avertissement'); return; }
      app.naviguer(`/crm/diffusion/nouveau?plans=${ids.join(',')}${suffixe ? `&${suffixe}` : ''}`);
    });
    this.desabonner = app.abonner(SUJET_FENETRE.CRM, () => this.charger());
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
    if (!plans.length) { corps.innerHTML = `<p class="aide">${texteHtml('crm_btp.plans.aucun')}</p>`; return; }
    corps.innerHTML = `<table class="crm-table"><thead><tr><th></th><th>${texteHtml('crm_btp.plans.repere')}</th><th>${texteHtml('crm_btp.plans.nom')}</th><th>${texteHtml('crm_btp.plans.lot')}</th><th>${texteHtml('crm_btp.plans.repere_cctp')}</th>${this.element ? '' : `<th>${texteHtml('crm_btp.liste.rattachement')}</th>`}
      <th>${texteHtml('crm_btp.plans.indice')}</th><th>${texteHtml('crm_btp.plans.en_vigueur')}</th><th>${texteHtml('crm_btp.plans.statut')}</th><th class="nombre">${texteHtml('crm_btp.plans.visas_attendus')}</th></tr></thead><tbody>
      ${plans.map((p) => `<tr><td><input type="checkbox" data-choix="${p.id}" ${p.nb_indices ? '' : `disabled title="${texteHtml('crm_btp.plans.sans_indice')}"`}></td>
        <td><a href="/crm/plan/${p.id}"><b>${echapper(p.repere)}</b></a></td><td>${echapper(p.nom)}</td><td>${echapper(p.lot ?? '')}</td><td>${echapper(p.repere_cctp ?? '')}</td>
        ${this.element ? '' : `<td>${lienElement(p.element)}</td>`}<td>${echapper(p.etat.indice === '' ? texte('crm_btp.plans.indice_vide') : p.etat.indice ?? '')}</td><td>${echapper(p.etat.en_vigueur === '' ? texte('crm_btp.plans.indice_vide') : p.etat.en_vigueur ?? icone('crm_btp_aucun'))}</td><td>${pastillePlan(p.etat)}</td>
        <td class="nombre${p.etat.retards ? ' crm-retard' : ''}">${p.etat.manquants || ''}${p.etat.retards ? ` ${texteHtml('crm_btp.plans.en_retard', { nombre: p.etat.retards })}` : ''}</td></tr>`).join('')}</tbody></table>`;
  }
}
