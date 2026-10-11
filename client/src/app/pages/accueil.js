import { PageBase, Preferences } from '@logibtp/navigation';
import { AccueilBase } from '@logibtp/navigation/ui';
import { echapper } from '@logibtp/socle/ui';
import { catalogueRaccourcis, RACCOURCIS_DEFAUT } from '../navigation/menus.js';
import { catalogueWidgets, WIDGETS_DEFAUT } from '../navigation/widgets.js';

/** Accueil : session précédente à restaurer, raccourcis personnalisables, tableau de bord. */
export class PageAccueil extends PageBase {
  icone = '⌂';

  async ouvrir() {
    const app = this.app;
    this.titre = 'Accueil';
    const heure = new Date().getHours();
    const salut = heure < 18 ? 'Bonjour' : 'Bonsoir';
    const session = new URLSearchParams(location.search).get('session') === 'fermee';
    this.accueil = new AccueilBase(this.conteneur, {
      catalogueRaccourcis: catalogueRaccourcis(),
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
      entete: `<h1>${salut} ${echapper(app.utilisateur())}</h1>
        <p>${echapper(app.societe?.libelle ?? '')} · ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        ${session ? ' · <b>Session fermée</b> : cette fenêtre a été conservée par le navigateur.' : ''}</p>`,
    });
    this.accueil.ouvrir();
    if (this.requete.restaurer) this.restaurerSession();
  }

  restaurerSession() {
    this.accueil.racine.querySelector('[data-action="restaurer"]')?.click();
  }

  async reprendre() { this.accueil.rendreSession(); }
}
