import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { PanneauSuivi } from '../crm/panneau-suivi.js';

/** Suivi d'un élément dans sa propre fenêtre (module CRM) : `/crm/suivi?type=&id=` (ouvert depuis l'onglet Suivi). */
export class PageSuiviCrm extends PageBase {
  icone = icone('crm_btp_note');

  async ouvrir() {
    const app = this.app;
    const { type, id } = this.requete;
    const [e] = await api.crm.elements([{ type, id: String(id) }]).catch(() => [null]);
    this.titre = texte('crm_btp.page_suivi.titre', { libelle: e?.libelle ?? `${type} ${id}` });
    this.conteneur.innerHTML = `<div class="page-parametres page-crm-suivi"><h1 class="page-titre">${iconeHtml('crm_btp_note')} ${texteHtml('crm_btp.page_suivi.entete')} ${e?.url ? `<a href="${echapper(e.url)}">${echapper(e.libelle)}</a>` : echapper(e?.libelle ?? '')}</h1>
      <div data-suivi></div></div>`;
    this.panneau = new PanneauSuivi(this.conteneur.querySelector('[data-suivi]'), { app, type, id, libelle: e?.libelle ?? '', fenetre: false });
    await this.panneau.ouvrir();
  }

  urlCourante() { return `/crm/suivi?type=${encodeURIComponent(this.requete.type ?? '')}&id=${encodeURIComponent(this.requete.id ?? '')}`; }

  async reprendre() { await this.panneau?.charger(); }

  fermer() { this.panneau?.fermer(); }
}
