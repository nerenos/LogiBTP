import { PageBase } from '@logibtp/navigation';
import { ExplorateurGed } from '@logibtp/ged/ui';
import { ArborescenceBtp } from '../ged/arborescence.js';

/**
 * GED complète (module GED) : /ged, /ged/<id> (document ouvert), /ged?coffre=1 (coffre-fort). Arborescence : documents
 * sans élément, affaires et projets (structure, documents rattachés et leurs pièces) ; la recherche couvre toute la GED.
 */
export class PageGed extends PageBase {
  icone = '📎';

  async ouvrir() {
    const app = this.app;
    const coffre = Boolean(this.requete.coffre);
    this.titre = coffre ? 'Coffre-fort' : 'Documents (GED)';
    this.icone = coffre ? '🔒' : '📎';
    this.conteneur.innerHTML = `<div class="page-ged"><h1 class="page-titre">${this.icone} ${this.titre}</h1><div class="page-ged-corps"></div></div>`;
    const s = await app.services();
    this.explorateur = new ExplorateurGed(this.conteneur.querySelector('.page-ged-corps'), {
      fournisseur: s.ged, documentInitial: this.params.id ? Number(this.params.id) : null, modifiable: true, admin: app.estAdmin(),
      utilisateur: app.utilisateur(), message: (t, n) => app.message(t, n), coffre,
      arborescence: s.structure ? new ArborescenceBtp(null, { structure: s.structure }) : null,
      ouvrirUrl: (url) => app.naviguer(url, { nouvelleFenetre: true }),
    });
  }
}
