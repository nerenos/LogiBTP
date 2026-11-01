import { texte, texteHtml, pluriel, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { urlFiche, TYPE_FICHE } from '../codes.js';
import { dateLocale } from '@logibtp/socle';
import { PageBase } from '@logibtp/navigation';
import { echapper } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { pastilleHabilitation, jourRessource } from '../ressources/ressources-ui.js';
import { tableauEcheances } from '../ressources/entretiens-ui.js';

/**
 * Habilitations, entretiens et visites à surveiller (référentiel des ressources) : expirées ou arrivant à échéance dans les N jours, salariés
 * et matériels (la dernière de chaque type et élément) ; lien vers la fiche. `/ressources/habilitations?element=&jours=`.
 */
export class PageHabilitations extends PageBase {
  icone = icone('ressources_btp_surveiller');

  urlCourante() { return `/ressources/habilitations?${new URLSearchParams({ element: this.element ?? '', jours: this.jours ?? 60 })}`; }

  async ouvrir() {
    const app = this.app;
    this.titre = texte('ressources_btp.surveiller.titre');
    this.element = this.requete.element ?? '';
    this.jours = Number(this.requete.jours ?? 60);
    this.conteneur.innerHTML = `<div class="page-parametres pleine"><h1 class="page-titre">${iconeHtml('ressources_btp_surveiller')} ${echapper(this.titre)}</h1>
      <p class="ligne">${[['', 'tout'], ['salarie', 'salarie'], ['materiel', 'materiel']].map(([v, c]) => `<label class="ligne"><input type="radio" name="element" value="${v}" ${v === this.element ? 'checked' : ''}> ${texteHtml(`ressources_btp.surveiller.filtres.${c}`)}</label>`).join(' ')}
        · ${texteHtml('ressources_btp.surveiller.echeance_dans')} <input data-jours value="${this.jours}" size="4" inputmode="numeric"> ${texteHtml('ressources_btp.surveiller.jours')}</p><div data-liste></div></div>`;
    this.conteneur.querySelectorAll('[name="element"]').forEach((r) => r.addEventListener('change', () => { this.element = r.value; this.#charger(); }));
    this.conteneur.querySelector('[data-jours]').addEventListener('change', (e) => { this.jours = Math.max(0, Number(e.target.value) || 0); this.#charger(); });
    await this.#charger();
  }

  async #charger() {
    const zone = this.conteneur.querySelector('[data-liste]');
    const l = await api.ressources.aSurveiller({ element: this.element, jours: this.jours }).catch((e) => { this.app.erreur(e); return []; });
    const expirees = l.filter((h) => h.etat === 'EXPIREE').length;
    zone.innerHTML = l.length ? `<p class="aide">${texteHtml('ressources_btp.surveiller.compte', { habilitations: pluriel('ressources_btp.surveiller.habilitations', l.length), expirees: pluriel('ressources_btp.surveiller.expirees', expirees) })}</p>
      <table class="pleine-largeur"><thead><tr><th>${texteHtml('ressources_btp.surveiller.colonnes.element')}</th><th>${texteHtml('ressources_btp.surveiller.colonnes.habilitation')}</th><th>${texteHtml('ressources_btp.habilitations.colonnes.obtenue')}</th><th>${texteHtml('ressources_btp.habilitations.colonnes.fin')}</th><th>${texteHtml('ressources_btp.habilitations.colonnes.etat')}</th><th>${texteHtml('ressources_btp.habilitations.colonnes.organisme')}</th></tr></thead><tbody>
      ${l.map((h) => `<tr><td><a href="${urlFiche(h.type_element, h.id_element)}">${iconeHtml(h.type_element === TYPE_FICHE.SALARIE ? 'ressources_btp_salarie' : 'ressources_btp_materiel')} ${echapper(h.element ?? '')}</a></td>
        <td>${echapper(h.libelle)}</td><td>${jourRessource(h.obtenue_le)}</td><td>${jourRessource(h.fin)}</td><td>${pastilleHabilitation(h)}</td><td>${echapper(h.organisme ?? '')}</td></tr>`).join('')}
      </tbody></table>` : `<p class="aide">${texteHtml('ressources_btp.surveiller.aucune')}</p>`;
    // Matériels : fins de location et de garantie (db/230) dans le même délai.
    if (this.element === 'salarie') return;
    // Entretiens des plans (lot 5c-4) : en retard ou date estimée dans le délai.
    const ent = await api.ressources.echeancesEntretiens(this.jours).catch(() => []);
    zone.insertAdjacentHTML('beforeend', `<h2>${texteHtml('ressources_btp.surveiller.entretiens')}</h2>${tableauEcheances(ent, { materiel: true })}`);
    const e = await api.ressources.echeancesMateriels(this.jours).catch(() => []);
    if (!e.length) return;
    const aujourdhui = dateLocale();
    zone.insertAdjacentHTML('beforeend', `<h2>${texteHtml('ressources_btp.surveiller.fins')}</h2>
      <table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('ressources_btp.materiel_affecte.colonnes.materiel')}</th><th>${texteHtml('ressources_btp.surveiller.colonnes.echeance')}</th><th>${texteHtml('ressources_btp.surveiller.colonnes.date')}</th><th>${texteHtml('ressources_btp.surveiller.colonnes.loueur')}</th></tr></thead><tbody>
      ${e.map((x) => `<tr><td><a href="${urlFiche(TYPE_FICHE.MATERIEL, x.id)}">${iconeHtml('ressources_btp_materiel')} ${echapper(x.code)} ${echapper(x.designation ?? '')}</a></td>
        <td>${texteHtml(x.genre === 'LOCATION' ? 'ressources_btp.surveiller.fin_location' : 'ressources_btp.surveiller.fin_garantie')}</td>
        <td class="${x.date < aujourdhui ? 'erreur' : ''}">${jourRessource(x.date)}</td><td>${echapper(x.tiers ?? '')}</td></tr>`).join('')}</tbody></table>`);
  }
}
