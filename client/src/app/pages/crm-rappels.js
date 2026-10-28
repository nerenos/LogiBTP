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
  icone = '⏰';

  async ouvrir() {
    const app = this.app;
    this.titre = 'Mes rappels';
    this.tous = this.requete.tous === '1';
    this.conteneur.innerHTML = `<div class="page-parametres page-crm-rappels"><h1 class="page-titre">⏰ Mes rappels</h1>
      <p><label class="fiche-option"><input type="checkbox" data-tous ${this.tous ? 'checked' : ''}> À venir aussi (avant leur délai)</label>
      <span class="aide"> · <span class="crm-pastille crm-pastille-rouge"></span> échu ou imminent · <span class="crm-pastille crm-pastille-orange"></span> bientôt · <span class="crm-pastille crm-pastille-vert"></span> à venir</span></p>
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
    if (!rappels.length) { corps.innerHTML = '<p class="aide">Aucun rappel.</p>'; return; }
    corps.innerHTML = `<table class="crm-table"><thead><tr><th></th><th>Rappel</th><th>Note</th><th>Rattachement</th><th>État</th><th></th></tr></thead><tbody>
      ${rappels.map((r) => `<tr><td>${pastilleRappel(r)}</td><td>${echapper(libelleRappel(r))}</td>
        <td><a href="/crm/note/${r.note_id}">${r.note?.masquee ? '🔒 ' : ''}${echapper(r.note?.objet ?? `Note ${r.note_id}`)}</a></td>
        <td>${lienElement(r.note?.element)}</td><td>${r.note ? pastilleEtat(r.note) : ''}</td>
        <td><button type="button" data-traiter="${r.id}" title="Rappel traité : il ne paraît plus (la note reste ouverte)">Fait</button></td></tr>`).join('')}</tbody></table>`;
    corps.querySelectorAll('[data-traiter]').forEach((b) => b.addEventListener('click', async () => {
      try { await api.crm.traiterRappel(Number(b.dataset.traiter)); this.app.publier(SUJET_FENETRE.CRM, { rappels: true }); } catch (e) { this.app.erreur(e); }
    }));
  }
}
