import { PageBase } from '@logibtp/navigation';
import { echapper } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { pastilleHabilitation, jourRessource } from '../ressources/ressources-ui.js';

/**
 * Habilitations à surveiller (référentiel des ressources) : expirées ou arrivant à échéance dans les N jours, salariés
 * et matériels (la dernière de chaque type et élément) ; lien vers la fiche. `/ressources/habilitations?element=&jours=`.
 */
export class PageHabilitations extends PageBase {
  icone = '🪪';

  urlCourante() { return `/ressources/habilitations?${new URLSearchParams({ element: this.element ?? '', jours: this.jours ?? 60 })}`; }

  async ouvrir() {
    const app = this.app;
    this.titre = 'Habilitations à surveiller';
    this.element = this.requete.element ?? '';
    this.jours = Number(this.requete.jours ?? 60);
    this.conteneur.innerHTML = `<div class="page-parametres pleine"><h1 class="page-titre">🪪 Habilitations à surveiller</h1>
      <p class="ligne">${[['', 'Tout'], ['salarie', 'Salariés'], ['materiel', 'Matériels']].map(([v, l]) => `<label class="ligne"><input type="radio" name="element" value="${v}" ${v === this.element ? 'checked' : ''}> ${l}</label>`).join(' ')}
        · échéance dans <input data-jours value="${this.jours}" size="4" inputmode="numeric"> jours</p><div data-liste></div></div>`;
    if (!app.enLigne) { this.conteneur.querySelector('[data-liste]').innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
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
      ${l.map((h) => `<tr><td><a href="/fiche/${h.type_element}/${h.id_element}">${h.type_element === 'salarie' ? '👷' : '🚜'} ${echapper(h.element ?? '')}</a></td>
        <td>${echapper(h.libelle)}</td><td>${jourRessource(h.obtenue_le)}</td><td>${jourRessource(h.fin)}</td><td>${pastilleHabilitation(h)}</td><td>${echapper(h.organisme ?? '')}</td></tr>`).join('')}
      </tbody></table>` : '<p class="aide">Aucune habilitation expirée ni à renouveler dans ce délai.</p>';
  }
}
