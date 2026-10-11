import { PageBase } from '@logibtp/navigation';
import { echapper } from '@logibtp/socle/ui';

export class PageIntrouvable extends PageBase {
  icone = '❓';

  async ouvrir() {
    this.conteneur.innerHTML = `<div class="page-simple"><h1>Page introuvable</h1>
      <p>L'adresse <code>${echapper(location.pathname)}</code> ne correspond à aucun écran.</p>
      <p><a href="/">⌂ Retour à l'accueil</a></p></div>`;
  }
}
