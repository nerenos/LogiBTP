import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { GestionReferentiels } from '@logibtp/bibliotheque/ui';

/** Paramétrage de la bibliothèque : bibliothèques, familles, natures, regroupements, scénarios de prix d'achat. */
export class PageParametresBibliotheque extends PageBase {
  icone = icone('parametres_btp_bibliotheque');

  async ouvrir() {
    const app = this.app;
    this.titre = texte('parametres_btp.bibliotheque.titre');
    this.conteneur.innerHTML = `<div class="page-parametres page-bibliotheque"><h1 class="page-titre">${iconeHtml('parametres_btp_bibliotheque')} ${texteHtml('parametres_btp.bibliotheque.titre')}</h1><div class="page-bibliotheque-corps"></div></div>`;
    const s = await app.services();
    const gestion = new GestionReferentiels(this.conteneur.querySelector('.page-bibliotheque-corps'), {
      fournisseur: s.bibliotheque, message: (t, n) => app.message(t, n), admin: app.estAdmin(),
      // Comptes des natures : ventilation du module Comptabilité (/comptabilite/ventilation).
      sansComptesNatures: true,
    });
    await gestion.ouvrir();
  }
}
