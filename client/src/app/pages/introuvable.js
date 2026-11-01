import { texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';

export class PageIntrouvable extends PageBase {
  icone = icone('pages_btp_introuvable');

  async ouvrir() {
    this.conteneur.innerHTML = `<div class="page-simple"><h1>${texteHtml('pages_btp.introuvable.titre')}</h1>
      <p>${texteHtml('pages_btp.introuvable.adresse_html', { adresse: location.pathname })}</p>
      <p><a href="/">${iconeHtml('pages_btp_accueil')} ${texteHtml('pages_btp.introuvable.retour')}</a></p></div>`;
  }
}
