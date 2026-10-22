import { PageBase } from '@logibtp/navigation';
import { echapper } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { lienElement } from '../crm/crm.js';
import { FilCrm, GENRES_FIL } from '../crm/fil.js';

/**
 * Fil d'actualité (module CRM) : `/crm/fil?type=&id=&genres=` d'un élément ou global (composant `FilCrm`), centré dans
 * la page.
 */
export class PageFilCrm extends PageBase {
  icone = '📰';

  async ouvrir() {
    const app = this.app;
    this.element = this.requete.type && this.requete.id ? { type: this.requete.type, id: String(this.requete.id) } : null;
    this.genres = new Set(this.requete.genres ? this.requete.genres.split(',') : GENRES_FIL.map((g) => g.code));
    if (!app.enLigne) { this.conteneur.innerHTML = '<p class="aide">Suivi (CRM) disponible en ligne seulement.</p>'; return; }
    const e = this.element ? (await api.crm.elements([this.element]))[0] : null;
    this.titre = e ? `Fil : ${e.libelle}` : 'Fil d\'actualité';
    this.conteneur.innerHTML = `<div class="page-parametres page-crm-fil"><h1 class="page-titre">📰 Fil d'actualité${e ? ` : ${lienElement(e)}` : ''}</h1><div data-hote></div></div>`;
    this.fil = new FilCrm(this.conteneur.querySelector('[data-hote]'), {
      app, element: this.element, libelle: e?.libelle, genres: this.genres,
      surGenres: () => app.routeur.remplacerUrl(this.urlCourante()),
    });
    await this.fil.ouvrir();
  }

  urlCourante() {
    const p = new URLSearchParams(Object.entries({ type: this.element?.type, id: this.element?.id, genres: this.genres?.size === GENRES_FIL.length ? '' : [...(this.genres ?? [])].join(',') }).filter(([, v]) => v));
    return `/crm/fil${p.toString() ? `?${p}` : ''}`;
  }

  async reprendre() { await this.fil?.charger(true); }

  fermer() { this.fil?.fermer(); }
}
