import { PageBase } from '@logibtp/navigation';
import { ParametrageReglesGed } from '@logibtp/ged/ui';

/** Paramétrage de la GED (administrateur) : règles de rétention et de classification automatique. */
export class PageParametresGed extends PageBase {
  icone = '⏳';

  get modifiee() { return Boolean(this.parametrage?.modifie); }

  async ouvrir() {
    const app = this.app;
    this.titre = 'Paramétrage de la GED';
    this.conteneur.innerHTML = '<div class="page-parametres page-parametres-ged"><h1 class="page-titre">⏳ Rétention et classification des documents</h1><div class="corps"></div></div>';
    // Routes /api/ged/regles.
    const s = await app.services();
    this.parametrage = new ParametrageReglesGed(this.conteneur.querySelector('.corps'), {
      fournisseur: s.ged, admin: app.estAdmin(), message: (t, n) => app.message(t, n),
    });
    await this.parametrage.ouvrir();
  }
}
