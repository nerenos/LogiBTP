import { PageBase } from '@logibtp/navigation';
import { ParametrageAffichageDocument, FournisseurAffichageMemoire } from '@logibtp/document/ui';
import { echapper, lireNombre, formatLibre } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { ETIQUETTES_LIGNE, COULEURS_TYPE_PRIX } from '../vues-document.js';

/** Paramétrage des documents : étiquettes de lignes, couleurs des modes de vente, seuils de solde des lignes. */
export class PageParametresDocuments extends PageBase {
  icone = '🏷';

  async ouvrir() {
    const app = this.app;
    this.titre = 'Paramétrage des documents';
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">🏷 Étiquettes et couleurs des lignes</h1><div class="corps"></div>
      <h2>Solde des lignes</h2><div class="seuils-solde"></div></div>`;
    // Hors ligne : les listes de la définition de démonstration sont modifiées en place (visibles dans le devis de démo).
    const fournisseur = app.enLigne
      ? {
        etiquettes: () => api.etiquettesLigne(), enregistrerEtiquettes: (l) => api.enregistrerEtiquettesLigne(l),
        couleursTypePrix: () => api.couleursTypePrix(), enregistrerCouleurs: (l) => api.enregistrerCouleursTypePrix(l),
      }
      : new FournisseurAffichageMemoire({ etiquettes: ETIQUETTES_LIGNE, couleurs: COULEURS_TYPE_PRIX, admin: () => app.estAdmin() });
    const p = new ParametrageAffichageDocument(this.conteneur.querySelector('.corps'), { fournisseur, admin: app.estAdmin(), message: (t, n) => app.message(t, n) });
    await p.ouvrir();
    await this.ouvrirSeuils(this.conteneur.querySelector('.seuils-solde'));
  }

  /**
   * Seuils de solde automatique (achats, ventes) : à la validation d'un BL ou d'une facture, une ligne dont le reste
   * passe sous le seuil (en % de la quantité du parent, ou en quantité) solde la ligne du parent.
   */
  async ouvrirSeuils(zone) {
    const app = this.app;
    if (!app.enLigne) { zone.innerHTML = '<p class="aide">Seuils de solde disponibles en ligne seulement.</p>'; return; }
    const seuils = await api.seuilsSolde();
    const admin = app.estAdmin();
    const ro = admin ? '' : 'disabled';
    const ligne = (cle, libelle) => `<tr><th>${echapper(libelle)}</th>
      <td><input data-famille="${cle}" data-c="pct" inputmode="decimal" size="6" value="${formatLibre(seuils[cle]?.pct ?? 0)}" ${ro}> %</td>
      <td><input data-famille="${cle}" data-c="qte" inputmode="decimal" size="8" value="${formatLibre(seuils[cle]?.qte ?? 0)}" ${ro}></td></tr>`;
    zone.innerHTML = `<p class="aide">À la validation d'un bon de livraison ou d'une facture issu d'une commande, une ligne est soldée
      automatiquement quand son reste est inférieur ou égal à l'un des deux seuils (0 : soldée quand tout est livré ou facturé).
      La case « Soldée » de la ligne permet aussi de la solder à la main.</p>
      <table><thead><tr><th></th><th>% de la quantité du parent</th><th>Quantité</th></tr></thead>
      <tbody>${ligne('achat', 'Achats')}${ligne('vente', 'Ventes')}</tbody></table>
      ${admin ? '<div class="boutons"><button type="button" class="principal" data-enregistrer>Enregistrer les seuils</button></div>' : ''}`;
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      const valeurs = { achat: {}, vente: {} };
      for (const el of zone.querySelectorAll('[data-famille]')) {
        const v = lireNombre(el.value);
        if (v === undefined || v === null || Number(v) < 0) { app.message('Seuil invalide : nombre positif ou nul', 'avertissement'); el.focus(); return; }
        valeurs[el.dataset.famille][el.dataset.c] = v;
      }
      try {
        await api.enregistrerSeuilsSolde(valeurs);
        app.message('Seuils de solde enregistrés', 'succes');
      } catch (e) { app.message(e.message, 'erreur'); }
    });
  }
}
