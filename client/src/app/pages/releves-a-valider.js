import { texte, texteHtml, iconeHtml, icone } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, saisir } from '@logibtp/socle/ui';
import { TYPE_FICHE, urlFiche } from '../codes.js';
import { api } from '../api.js';
import { LIBELLES_UNITE } from '../ressources/compteurs.js';
import { jourRessource } from '../ressources/ressources-ui.js';

/**
 * Relevés de compteurs saisis à la borne pour un matériel non affecté au salarié ce jour (lot 4b du plan materiel-suites) :
 * acceptation, ou refus avec motif (le relevé est alors supprimé). Le serveur ne renvoie que les relevés que l'utilisateur
 * peut traiter (administrateur ou responsable du service du salarié). `/ressources/releves-a-valider`.
 */
export class PageRelevesAValider extends PageBase {
  icone = icone('navigation_btp_releves_a_valider');

  urlCourante() { return '/ressources/releves-a-valider'; }

  async ouvrir() {
    this.titre = texte('ressources_btp.releves_a_valider.titre');
    this.conteneur.innerHTML = `<div class="page-parametres pleine"><h1 class="page-titre">${iconeHtml('navigation_btp_releves_a_valider')} ${echapper(this.titre)}</h1>
      <p class="aide">${texteHtml('ressources_btp.releves_a_valider.aide')}</p><div data-liste></div></div>`;
    await this.#charger();
  }

  async #charger() {
    const zone = this.conteneur.querySelector('[data-liste]');
    const l = await api.ressources.relevesAValider().catch((e) => { this.app.erreur(e); return []; });
    const c = (cle) => texteHtml(`ressources_btp.releves_a_valider.colonnes.${cle}`);
    zone.innerHTML = l.length ? `<table class="pleine-largeur"><thead><tr><th>${c('materiel')}</th><th>${c('salarie')}</th><th>${c('date')}</th><th>${c('compteur')}</th><th class="nombre">${c('valeur')}</th><th>${c('commentaire')}</th><th></th></tr></thead><tbody>
      ${l.map((r) => `<tr data-id="${r.id}"><td><a href="${urlFiche(TYPE_FICHE.MATERIEL, r.materiel)}">${iconeHtml('ressources_btp_materiel')} ${echapper(r.code)} ${echapper(r.designation ?? '')}</a></td>
        <td>${echapper(r.nom ?? '')}</td><td>${jourRessource(r.date)}</td><td>${echapper(LIBELLES_UNITE[r.unite] ?? r.unite)}</td>
        <td class="nombre">${echapper(String(r.valeur).replace('.', ','))}${r.remise ? ` <small class="aide">${texteHtml('ressources_btp.releves_a_valider.remise')}</small>` : ''}</td><td>${echapper(r.commentaire ?? '')}</td>
        <td><button type="button" data-accepter title="${texteHtml('ressources_btp.releves_a_valider.accepter_aide')}">${iconeHtml('ressources_btp_releve_accepter')} ${texteHtml('ressources_btp.releves_a_valider.accepter')}</button>
          <button type="button" data-refuser title="${texteHtml('ressources_btp.releves_a_valider.refuser_aide')}">${iconeHtml('ressources_btp_releve_refuser')} ${texteHtml('ressources_btp.releves_a_valider.refuser')}</button></td></tr>`).join('')}</tbody></table>`
      : `<p class="aide">${texteHtml('ressources_btp.releves_a_valider.aucun')}</p>`;
    zone.querySelectorAll('tr[data-id]').forEach((tr) => {
      const id = Number(tr.dataset.id);
      tr.querySelector('[data-accepter]').addEventListener('click', () => this.#traiter(id, true));
      tr.querySelector('[data-refuser]').addEventListener('click', () => this.#traiter(id, false));
    });
  }

  async #traiter(id, accepter) {
    let motif = null;
    if (!accepter) {
      motif = await saisir(texte('ressources_btp.releves_a_valider.motif'));
      if (motif === null) return;
      if (!motif.trim()) { this.app.message(texte('ressources_btp.releves_a_valider.motif_vide'), 'avertissement'); return; }
    }
    try {
      await api.ressources.traiterReleve(id, accepter, motif?.trim() ?? null);
      this.app.message(texte(`ressources_btp.releves_a_valider.${accepter ? 'accepte' : 'refuse'}`), 'succes');
      await this.#charger();
    } catch (e) { this.app.erreur(e); }
  }
}
