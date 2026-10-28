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
  icone = '🪪';

  urlCourante() { return `/ressources/habilitations?${new URLSearchParams({ element: this.element ?? '', jours: this.jours ?? 60 })}`; }

  async ouvrir() {
    const app = this.app;
    this.titre = 'Habilitations, entretiens et visites à surveiller';
    this.element = this.requete.element ?? '';
    this.jours = Number(this.requete.jours ?? 60);
    this.conteneur.innerHTML = `<div class="page-parametres pleine"><h1 class="page-titre">🪪 Habilitations, entretiens et visites à surveiller</h1>
      <p class="ligne">${[['', 'Tout'], ['salarie', 'Salariés'], ['materiel', 'Matériels']].map(([v, l]) => `<label class="ligne"><input type="radio" name="element" value="${v}" ${v === this.element ? 'checked' : ''}> ${l}</label>`).join(' ')}
        · échéance dans <input data-jours value="${this.jours}" size="4" inputmode="numeric"> jours</p><div data-liste></div></div>`;
    this.conteneur.querySelectorAll('[name="element"]').forEach((r) => r.addEventListener('change', () => { this.element = r.value; this.#charger(); }));
    this.conteneur.querySelector('[data-jours]').addEventListener('change', (e) => { this.jours = Math.max(0, Number(e.target.value) || 0); this.#charger(); });
    await this.#charger();
  }

  async #charger() {
    const zone = this.conteneur.querySelector('[data-liste]');
    const l = await api.ressources.aSurveiller({ element: this.element, jours: this.jours }).catch((e) => { this.app.erreur(e); return []; });
    const expirees = l.filter((h) => h.etat === 'EXPIREE').length;
    zone.innerHTML = l.length ? `<p class="aide">${l.length} habilitation(s), dont ${expirees} expirée(s).</p>
      <table class="pleine-largeur"><thead><tr><th>Élément</th><th>Habilitation</th><th>Obtenue le</th><th>Fin de validité</th><th>État</th><th>Organisme</th></tr></thead><tbody>
      ${l.map((h) => `<tr><td><a href="${urlFiche(h.type_element, h.id_element)}">${h.type_element === TYPE_FICHE.SALARIE ? '👷' : '🚜'} ${echapper(h.element ?? '')}</a></td>
        <td>${echapper(h.libelle)}</td><td>${jourRessource(h.obtenue_le)}</td><td>${jourRessource(h.fin)}</td><td>${pastilleHabilitation(h)}</td><td>${echapper(h.organisme ?? '')}</td></tr>`).join('')}
      </tbody></table>` : '<p class="aide">Aucune habilitation expirée ni à renouveler dans ce délai.</p>';
    // Matériels : fins de location et de garantie (db/230) dans le même délai.
    if (this.element === 'salarie') return;
    // Entretiens des plans (lot 5c-4) : en retard ou date estimée dans le délai.
    const ent = await api.ressources.echeancesEntretiens(this.jours).catch(() => []);
    zone.insertAdjacentHTML('beforeend', `<h2>Matériels : entretiens en retard ou à prévoir</h2>${tableauEcheances(ent, { materiel: true })}`);
    const e = await api.ressources.echeancesMateriels(this.jours).catch(() => []);
    if (!e.length) return;
    const aujourdhui = dateLocale();
    zone.insertAdjacentHTML('beforeend', `<h2>Matériels : fins de location et de garantie</h2>
      <table class="tableau-compact largeur-contenu"><thead><tr><th>Matériel</th><th>Échéance</th><th>Date</th><th>Loueur</th></tr></thead><tbody>
      ${e.map((x) => `<tr><td><a href="${urlFiche(TYPE_FICHE.MATERIEL, x.id)}">🚜 ${echapper(x.code)} ${echapper(x.designation ?? '')}</a></td>
        <td>${x.genre === 'LOCATION' ? 'Fin de location' : 'Fin de garantie'}</td>
        <td class="${x.date < aujourdhui ? 'erreur' : ''}">${jourRessource(x.date)}</td><td>${echapper(x.tiers ?? '')}</td></tr>`).join('')}</tbody></table>`);
  }
}
