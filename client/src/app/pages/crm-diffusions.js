import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { SUJET_FENETRE } from '../codes.js';
import { PageBase } from '@logibtp/navigation';
import { echapper, formatDate } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { lienElement } from '../crm/crm.js';

/** Bordereaux de diffusion (module CRM) : `/crm/diffusions?type=&id=` (d'un élément ou tous), visas reçus / attendus. */
export class PageDiffusionsCrm extends PageBase {
  icone = icone('crm_btp_bordereaux');

  async ouvrir() {
    const app = this.app;
    this.element = this.requete.type && this.requete.id ? { type: this.requete.type, id: String(this.requete.id) } : null;
    const e = this.element ? (await api.crm.elements([this.element]))[0] : null;
    this.titre = e ? texte('crm_btp.diffusions.titre_element', { libelle: e.libelle }) : texte('crm_btp.routes.diffusions');
    this.conteneur.innerHTML = `<div class="page-parametres page-crm"><h1 class="page-titre">${iconeHtml('crm_btp_bordereaux')} ${texteHtml('crm_btp.routes.diffusions')}${e ? ` : ${lienElement(e)}` : ''}</h1>
      <p class="aide">${texteHtml('crm_btp.diffusions.aide')}
      ${this.element ? `<a href="/crm/plans?type=${encodeURIComponent(this.element.type)}&id=${encodeURIComponent(this.element.id)}">${texteHtml('crm_btp.diffusions.plans_element')}</a>` : `<a href="/crm/plans">${texteHtml('crm_btp.suivi.plans')}</a>`}</p>
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
    if (!liste.length) { corps.innerHTML = `<p class="aide">${texteHtml('crm_btp.diffusions.aucun')}</p>`; return; }
    corps.innerHTML = `<table class="crm-table"><thead><tr><th>${texteHtml('crm_btp.demandes.numero')}</th><th>${texteHtml('crm_btp.diffusions.date')}</th><th>${texteHtml('crm_btp.liste.objet')}</th>${this.element ? '' : `<th>${texteHtml('crm_btp.liste.rattachement')}</th>`}<th class="nombre">${texteHtml('crm_btp.diffusions.pieces')}</th><th class="nombre">${texteHtml('crm_btp.diffusions.destinataires')}</th><th>${texteHtml('crm_btp.diffusions.visas_recus')}</th></tr></thead><tbody>
      ${liste.map((d) => {
        const recus = d.destinataires.reduce((t, x) => t + x.visas_recus, 0);
        const attendus = d.destinataires.reduce((t, x) => t + x.visas_attendus, 0);
        return `<tr><td><a href="/crm/diffusion/${d.id}"><b>${echapper(d.numero)}</b></a></td><td>${formatDate(d.date)}</td><td>${echapper(d.objet)}</td>
          ${this.element ? '' : `<td>${lienElement(d.element)}</td>`}<td class="nombre">${d.pieces.length}</td><td class="nombre">${d.destinataires.length}</td>
          <td>${attendus ? `${recus} / ${attendus}` : icone('crm_btp_aucun')}</td></tr>`;
      }).join('')}</tbody></table>`;
  }
}
