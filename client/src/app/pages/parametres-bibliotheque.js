import { PageBase } from '@logibtp/navigation';
import { GestionReferentiels } from '@logibtp/bibliotheque/ui';

/** Paramétrage de la bibliothèque : bibliothèques, familles, natures, regroupements, scénarios de prix d'achat. */
export class PageParametresBibliotheque extends PageBase {
  icone = '📚';

  async ouvrir() {
    const app = this.app;
    this.titre = 'Paramétrage de la bibliothèque';
    this.conteneur.innerHTML = '<div class="page-parametres page-bibliotheque"><h1 class="page-titre">📚 Paramétrage de la bibliothèque</h1><div class="page-bibliotheque-corps"></div></div>';
    const s = await app.services();
    const gestion = new GestionReferentiels(this.conteneur.querySelector('.page-bibliotheque-corps'), {
      fournisseur: s.bibliotheque, message: (t, n) => app.message(t, n), admin: app.estAdmin(),
      // Comptes des natures : ventilation du module Comptabilité (/comptabilite/ventilation).
      sansComptesNatures: app.enLigne,
    });
    await gestion.ouvrir();
  }
}
