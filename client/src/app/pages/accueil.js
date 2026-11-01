import { texte, texteHtml, icone, langue } from '@logibtp/socle/dictionnaire';
import { PageBase, Preferences } from '@logibtp/navigation';
import { AccueilBase } from '@logibtp/navigation/ui';
import { echapper } from '@logibtp/socle/ui';
import { catalogueRaccourcis, RACCOURCIS_DEFAUT } from '../navigation/menus.js';
import { catalogueWidgets, WIDGETS_DEFAUT } from '../navigation/widgets.js';

/** Accueil : session précédente à restaurer, raccourcis personnalisables, tableau de bord. */
export class PageAccueil extends PageBase {
  icone = icone('pages_btp_accueil');

  async ouvrir() {
    const app = this.app;
    this.titre = texte('pages_btp.accueil.titre');
    const heure = new Date().getHours();
    const salut = texte(heure < 18 ? 'pages_btp.accueil.bonjour' : 'pages_btp.accueil.bonsoir');
    const session = new URLSearchParams(location.search).get('session') === 'fermee';
    this.accueil = new AccueilBase(this.conteneur, {
      catalogueRaccourcis: catalogueRaccourcis(this.app),
      catalogueWidgets: catalogueWidgets(app),
      preferences: new Preferences('logibtp.accueil', { raccourcis: RACCOURCIS_DEFAUT, widgets: WIDGETS_DEFAUT }),
      session: {
        precedente: () => app.fenetres.sessionPrecedente(),
        restaurer: (s) => app.fenetres.restaurer(s),
        ouvrir: (f) => app.fenetres.ouvrir(f.url, { position: f.position }),
        oublier: () => app.fenetres.oublierSessionPrecedente(),
      },
      naviguer: (url, o) => app.naviguer(url, o),
      message: (t, n) => app.message(t, n),
      entete: `<h1>${echapper(salut)} ${echapper(app.utilisateur())}</h1>
        <p>${echapper(app.societe?.libelle ?? '')} · ${new Date().toLocaleDateString(langue(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        ${session ? ` · ${texteHtml('pages_btp.accueil.session_fermee_html')}` : ''}</p>`,
    });
    this.accueil.ouvrir();
    if (this.requete.restaurer) this.restaurerSession();
  }

  restaurerSession() {
    this.accueil.racine.querySelector('[data-action="restaurer"]')?.click();
  }

  async reprendre() { this.accueil.rendreSession(); }
}
