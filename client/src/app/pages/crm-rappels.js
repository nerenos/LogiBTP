import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { SUJET_FENETRE } from '../codes.js';
import { PageBase } from '@logibtp/navigation';
import { echapper } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { pastilleRappel, libelleRappel, lienElement, pastilleEtat } from '../crm/crm.js';

/**
 * Mes rappels (module CRM) : `/crm/rappels?tous=1`. Rappels actifs pour moi (rouge : échu ou imminent, orange :
 * bientôt, vert : à venir, selon les seuils du paramétrage) ; par défaut ceux qui sont arrivés dans leur délai,
 * « À venir aussi » pour tous ; « Fait » retire un rappel sans clore la note.
 */
export class PageRappelsCrm extends PageBase {
  icone = icone('crm_btp_rappels');

  async ouvrir() {
    const app = this.app;
    this.titre = texte('crm_btp.routes.rappels');
    this.tous = this.requete.tous === '1';
    this.conteneur.innerHTML = `<div class="page-parametres page-crm-rappels"><h1 class="page-titre">${iconeHtml('crm_btp_rappels')} ${texteHtml('crm_btp.routes.rappels')}</h1>
      <p><label class="fiche-option"><input type="checkbox" data-tous ${this.tous ? 'checked' : ''}> ${texteHtml('crm_btp.rappels.tous')}</label>
      <span class="aide"> · <span class="crm-pastille crm-pastille-rouge"></span> ${texteHtml('crm_btp.rappels.legende_rouge')} · <span class="crm-pastille crm-pastille-orange"></span> ${texteHtml('crm_btp.rappels.legende_orange')} · <span class="crm-pastille crm-pastille-vert"></span> ${texteHtml('crm_btp.rappels.legende_vert')}</span></p>
      <div data-corps></div></div>`;
    this.conteneur.querySelector('[data-tous]').addEventListener('change', (e) => { this.tous = e.target.checked; this.app.routeur.remplacerUrl(this.urlCourante()); this.charger(); });
    this.desabonner = app.abonner(SUJET_FENETRE.CRM, () => this.charger());
    await this.charger();
  }

  urlCourante() { return `/crm/rappels${this.tous ? '?tous=1' : ''}`; }

  async reprendre() { await this.charger(); }

  fermer() { this.desabonner?.(); }

  async charger() {
    const corps = this.conteneur.querySelector('[data-corps]');
    if (!corps) return;
    let rappels;
    try { rappels = await api.crm.rappels({ tous: this.tous }); } catch (e) { corps.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    if (!rappels.length) { corps.innerHTML = `<p class="aide">${texteHtml('crm_btp.rappels.aucun')}</p>`; return; }
    corps.innerHTML = `<table class="crm-table"><thead><tr><th></th><th>${texteHtml('crm_btp.rappels.rappel')}</th><th>${texteHtml('crm_btp.rappels.note')}</th><th>${texteHtml('crm_btp.liste.rattachement')}</th><th>${texteHtml('crm_btp.liste.etat')}</th><th></th></tr></thead><tbody>
      ${rappels.map((r) => `<tr><td>${pastilleRappel(r)}</td><td>${echapper(libelleRappel(r))}</td>
        <td><a href="/crm/note/${r.note_id}">${r.note?.masquee ? `${iconeHtml('verrou')} ` : ''}${echapper(r.note?.objet ?? texte('crm_btp.rappels.note_numero', { id: r.note_id }))}</a></td>
        <td>${lienElement(r.note?.element)}</td><td>${r.note ? pastilleEtat(r.note) : ''}</td>
        <td><button type="button" data-traiter="${r.id}" title="${texteHtml('crm_btp.rappels.fait_titre')}">${texteHtml('crm_btp.rappels.fait')}</button></td></tr>`).join('')}</tbody></table>`;
    corps.querySelectorAll('[data-traiter]').forEach((b) => b.addEventListener('click', async () => {
      try { await api.crm.traiterRappel(Number(b.dataset.traiter)); this.app.publier(SUJET_FENETRE.CRM, { rappels: true }); } catch (e) { this.app.erreur(e); }
    }));
  }
}
