import { PageBase } from '@logibtp/navigation';
import { echapper } from '@logibtp/socle/ui';
import { api } from '../api.js';

/**
 * Modules de la société (db/193 : module_societe ; ANALYSE-MODULES-TRANSVERSE.md § 3) : un module facultatif s'active
 * ou se désactive par société (administrateur). Désactivé : menus et écrans masqués, routes refusées
 * (409 MODULE_INACTIF), données conservées et rendues à la réactivation.
 */
export class PageParametresModules extends PageBase {
  icone = '🧩';

  async ouvrir() {
    const app = this.app;
    this.titre = 'Modules de la société';
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">🧩 Modules de la société</h1>
      <p class="aide">Un module désactivé disparaît des menus et ses écrans sont refusés ; ses données sont conservées et
      reviennent à la réactivation.</p><div data-corps></div></div>`;
    if (!app.enLigne) { this.conteneur.querySelector('[data-corps]').innerHTML = '<p class="aide">Hors ligne, tous les modules sont actifs.</p>'; return; }
    await this.rendre(await api.modules());
  }

  async rendre(modules) {
    const app = this.app;
    const admin = app.estAdmin();
    const corps = this.conteneur.querySelector('[data-corps]');
    corps.innerHTML = `<table class="tableau-compact largeur-contenu"><thead><tr><th>Module</th><th>Description</th><th>Actif</th><th>Modifié</th></tr></thead><tbody>
      ${modules.map((m) => `<tr><td><b>${echapper(m.libelle)}</b></td><td>${echapper(m.description ?? '')}
        ${m.dependances?.length ? `<br><small class="aide">Nécessite : ${m.dependances.map(echapper).join(', ')}</small>` : ''}</td>
        <td><input type="checkbox" data-module="${echapper(m.code)}" ${m.actif ? 'checked' : ''} ${admin ? '' : 'disabled'}></td>
        <td><small class="aide">${m.maj_par ? `${echapper(m.maj_par)}, ` : ''}${m.maj_le ? new Date(m.maj_le).toLocaleString('fr-FR') : ''}</small></td></tr>`).join('')}
      </tbody></table>${admin ? '' : '<p class="aide">Seul un administrateur change l\'activation des modules.</p>'}`;
    corps.querySelectorAll('[data-module]').forEach((c) => c.addEventListener('change', async () => {
      try {
        const liste = await api.activerModule(c.dataset.module, c.checked);
        await app.chargerModules();
        app.message(`Module ${c.checked ? 'activé' : 'désactivé'}`, 'succes');
        await this.rendre(liste);
      } catch (e) { c.checked = !c.checked; app.erreur(e); }
    }));
  }
}
