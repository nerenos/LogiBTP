import { PageBase } from '@logibtp/navigation';
import { ParametrageAffichageDocument, FournisseurAffichageMemoire } from '@logibtp/document/ui';
import { api } from '../api.js';
import { ETIQUETTES_LIGNE, COULEURS_TYPE_PRIX } from '../vues-document.js';

/** Paramétrage de l'affichage des documents : étiquettes de lignes et couleurs des modes de vente. */
export class PageParametresDocuments extends PageBase {
  icone = '🏷';

  async ouvrir() {
    const app = this.app;
    this.titre = 'Paramétrage des documents';
    this.conteneur.innerHTML = '<div class="page-parametres"><h1 class="page-titre">🏷 Étiquettes et couleurs des lignes</h1><div class="corps"></div></div>';
    // Hors ligne : les listes de la définition de démonstration sont modifiées en place (visibles dans le devis de démo).
    const fournisseur = app.enLigne
      ? {
        etiquettes: () => api.etiquettesLigne(), enregistrerEtiquettes: (l) => api.enregistrerEtiquettesLigne(l),
        couleursTypePrix: () => api.couleursTypePrix(), enregistrerCouleurs: (l) => api.enregistrerCouleursTypePrix(l),
      }
      : new FournisseurAffichageMemoire({ etiquettes: ETIQUETTES_LIGNE, couleurs: COULEURS_TYPE_PRIX, admin: () => app.estAdmin() });
    const p = new ParametrageAffichageDocument(this.conteneur.querySelector('.corps'), { fournisseur, admin: app.estAdmin(), message: (t, n) => app.message(t, n) });
    await p.ouvrir();
  }
}
