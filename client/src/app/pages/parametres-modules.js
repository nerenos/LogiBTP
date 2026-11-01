import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, formatDateHeure } from '@logibtp/socle/ui';
import { api } from '../api.js';

/**
 * Modules de la société (db/193 : module_societe ; ANALYSE-MODULES-TRANSVERSE.md § 3) : un module facultatif s'active
 * ou se désactive par société (administrateur). Désactivé : menus et écrans masqués, routes refusées
 * (409 MODULE_INACTIF), données conservées et rendues à la réactivation.
 */
export class PageParametresModules extends PageBase {
  icone = icone('parametres_btp_modules');

  async ouvrir() {
    const app = this.app;
    this.titre = texte('parametres_btp.modules.titre');
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">${iconeHtml('parametres_btp_modules')} ${texteHtml('parametres_btp.modules.titre')}</h1>
      <p class="aide">${texteHtml('parametres_btp.modules.aide')}</p><div data-corps></div></div>`;
    await this.rendre(await api.modules());
  }

  async rendre(modules) {
    const app = this.app;
    const admin = app.estAdmin();
    const corps = this.conteneur.querySelector('[data-corps]');
    corps.innerHTML = `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('parametres_btp.modules.module')}</th><th>${texteHtml('parametres_btp.modules.description')}</th><th>${texteHtml('parametres_btp.documents.actif')}</th><th>${texteHtml('parametres_btp.modules.modifie')}</th></tr></thead><tbody>
      ${modules.map((m) => `<tr><td><b>${echapper(m.libelle)}</b></td><td>${echapper(m.description ?? '')}
        ${m.dependances?.length ? `<br><small class="aide">${texteHtml('parametres_btp.modules.necessite', { modules: m.dependances.join(', ') })}</small>` : ''}</td>
        <td><input type="checkbox" data-module="${echapper(m.code)}" ${m.actif ? 'checked' : ''} ${admin ? '' : 'disabled'}></td>
        <td><small class="aide">${m.maj_par ? `${echapper(m.maj_par)}, ` : ''}${m.maj_le ? formatDateHeure(m.maj_le) : ''}</small></td></tr>`).join('')}
      </tbody></table>${admin ? '' : `<p class="aide">${texteHtml('parametres_btp.modules.lecture')}</p>`}`;
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
