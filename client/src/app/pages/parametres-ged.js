import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { ParametrageReglesGed } from '@logibtp/ged/ui';

/** Paramétrage de la GED (administrateur) : règles de rétention et de classification automatique. */
export class PageParametresGed extends PageBase {
  icone = icone('parametres_btp_ged');

  get modifiee() { return Boolean(this.parametrage?.modifie); }

  async ouvrir() {
    const app = this.app;
    this.titre = texte('parametres_btp.ged.titre');
    this.conteneur.innerHTML = `<div class="page-parametres page-parametres-ged"><h1 class="page-titre">${iconeHtml('parametres_btp_ged')} ${texteHtml('parametres_btp.ged.entete')}</h1><div class="corps"></div></div>`;
    // Routes /api/ged/regles.
    const s = await app.services();
    this.parametrage = new ParametrageReglesGed(this.conteneur.querySelector('.corps'), {
      fournisseur: s.ged, admin: app.estAdmin(), message: (t, n) => app.message(t, n),
    });
    await this.parametrage.ouvrir();
  }
}
