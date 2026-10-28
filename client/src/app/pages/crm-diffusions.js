import { SUJET_FENETRE } from '../codes.js';
import { PageBase } from '@logibtp/navigation';
import { echapper, formatDate } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { lienElement } from '../crm/crm.js';

/** Bordereaux de diffusion (module CRM) : `/crm/diffusions?type=&id=` (d'un élément ou tous), visas reçus / attendus. */
export class PageDiffusionsCrm extends PageBase {
  icone = '📤';

  async ouvrir() {
    const app = this.app;
    this.element = this.requete.type && this.requete.id ? { type: this.requete.type, id: String(this.requete.id) } : null;
    const e = this.element ? (await api.crm.elements([this.element]))[0] : null;
    this.titre = e ? `Bordereaux : ${e.libelle}` : 'Bordereaux de diffusion';
    this.conteneur.innerHTML = `<div class="page-parametres page-crm"><h1 class="page-titre">📤 Bordereaux de diffusion${e ? ` : ${lienElement(e)}` : ''}</h1>
      <p class="aide">Un bordereau se crée depuis la liste des plans (« Diffuser la sélection ») ou depuis un plan (« Diffuser… »).
      ${this.element ? `<a href="/crm/plans?type=${encodeURIComponent(this.element.type)}&id=${encodeURIComponent(this.element.id)}">Plans de l'élément</a>` : '<a href="/crm/plans">Plans</a>'}</p>
      <div data-corps></div></div>`;
    this.desabonner = app.abonner(SUJET_FENETRE.CRM, () => this.charger());
    await this.charger();
  }

  urlCourante() { return this.element ? `/crm/diffusions?type=${encodeURIComponent(this.element.type)}&id=${encodeURIComponent(this.element.id)}` : '/crm/diffusions'; }

  async reprendre() { await this.charger(); }

  fermer() { this.desabonner?.(); }

  async charger() {
    const corps = this.conteneur.querySelector('[data-corps]');
    if (!corps) return;
    let liste;
    try { liste = await api.crm.diffusions({ type_element: this.element?.type, id_element: this.element?.id }); } catch (e) { corps.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    if (!liste.length) { corps.innerHTML = '<p class="aide">Aucun bordereau.</p>'; return; }
    corps.innerHTML = `<table class="crm-table"><thead><tr><th>N°</th><th>Date</th><th>Objet</th>${this.element ? '' : '<th>Rattachement</th>'}<th class="nombre">Pièces</th><th class="nombre">Destinataires</th><th>Visas reçus</th></tr></thead><tbody>
      ${liste.map((d) => {
        const recus = d.destinataires.reduce((t, x) => t + x.visas_recus, 0);
        const attendus = d.destinataires.reduce((t, x) => t + x.visas_attendus, 0);
        return `<tr><td><a href="/crm/diffusion/${d.id}"><b>${echapper(d.numero)}</b></a></td><td>${formatDate(d.date)}</td><td>${echapper(d.objet)}</td>
          ${this.element ? '' : `<td>${lienElement(d.element)}</td>`}<td class="nombre">${d.pieces.length}</td><td class="nombre">${d.destinataires.length}</td>
          <td>${attendus ? `${recus} / ${attendus}` : '—'}</td></tr>`;
      }).join('')}</tbody></table>`;
  }
}
