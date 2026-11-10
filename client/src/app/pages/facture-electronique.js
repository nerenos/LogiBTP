import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, lireStockage, ecrireStockage } from '@logibtp/socle/ui';
import { ACTION_DROIT } from '@logibtp/socle';
import { ParametresFe, TableauFlux, DetailFlux, PanneauDepotManuel } from '@logibtp/facture-electronique/ui';
import { TYPE_ELEMENT_FE, urlDocument } from '../codes.js';
import { apiFe } from '../facture-electronique/api-fe.js';
import { libelleElementFe, NOEUD_FE } from '../documents/chronologie-document.js';
import { api } from '../api.js';

// Module Facturation électronique, lot 11 du cœur (plans/facturation-electronique.md) : page /facture-electronique qui
// monte les écrans du module (tableau des flux et détail avec sa chronologie, dépôt et import manuels, paramètres de la
// plateforme). Les droits viennent du nœud « facture_electronique » (Modifier : actions sur un flux) et du nœud
// « parametres » (paramètres de la plateforme) ; la page fournit le transport, les connexions OAuth, les libellés des
// éléments et l'ouverture d'une pièce. /facture-electronique?flux=<id> ouvre le détail d'un flux. Onglet retenu dans le
// navigateur.

const CLE_ONGLET = 'factureElectroniqueOnglet';
const ONGLETS = Object.freeze(['flux', 'depot', 'parametres']);

export class PageFactureElectronique extends PageBase {
  icone = icone('facture_electronique_btp_page');
  #connexions = [];

  urlCourante() { return '/facture-electronique'; }

  /** Connexions OAuth proposées dans les paramètres ; liste vide si la lecture est refusée. */
  async #chargerConnexions() {
    try {
      this.#connexions = ((await api.oauth.connexions()) ?? []).map((c) => ({ id: c.id, libelle: c.nom ?? c.code }));
    } catch { this.#connexions = []; }
  }

  async ouvrir() {
    this.titre = texte('facture_electronique_btp.routes.page');
    const modifier = this.app.peut(NOEUD_FE, ACTION_DROIT.MODIFIER);
    const parametrer = this.app.estAdmin() || this.app.peut('parametres', ACTION_DROIT.MODIFIER);
    let onglet = lireStockage(CLE_ONGLET, 'flux');
    if (!ONGLETS.includes(onglet)) onglet = 'flux';
    this.conteneur.innerHTML = `<div class="page-parametres page-facture-electronique"><div class="entete-page"><h1 class="page-titre">${iconeHtml('facture_electronique_btp_page')} ${texteHtml('facture_electronique_btp.routes.page')}</h1>
        <div class="barre-outils"><div class="groupe-outils" role="tablist">${ONGLETS.map((o) => `<button type="button" role="tab" data-onglet="${o}" title="${echapper(texte(`facture_electronique_btp.onglets.${o}_titre`))}">${iconeHtml(`facture_electronique_btp_${o}`)} ${texteHtml(`facture_electronique_btp.onglets.${o}`)}</button>`).join('')}</div></div></div>
      <p class="aide">${texteHtml('facture_electronique_btp.aide')}</p>
      <section data-zone="flux" hidden><div data-zone-tableau></div><div data-zone-detail hidden></div></section>
      <section data-zone="depot" hidden></section>
      <section data-zone="parametres" hidden></section></div>`;
    const zone = (o) => this.conteneur.querySelector(`[data-zone="${o}"]`);
    const zoneDetail = this.conteneur.querySelector('[data-zone-detail]');
    const erreur = (e) => this.app.erreur(e);
    const ouvrirElement = (type, id, nouvelleFenetre) => {
      if (type === TYPE_ELEMENT_FE.DOCUMENT) this.app.naviguer(urlDocument(id), { nouvelleFenetre });
    };
    const ouvrirFlux = async (id, nouvelleFenetre = false) => {
      if (nouvelleFenetre) { this.app.naviguer(`/facture-electronique?flux=${id}`, { nouvelleFenetre: true }); return; }
      await afficher('flux');
      zoneDetail.hidden = false;
      await this.detail.ouvrir(id);
      zoneDetail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const commun = { peut: { modifier }, api: apiFe, libelleElement: libelleElementFe, ouvrirElement, ouvrirFlux, erreur };

    this.tableau = new TableauFlux(this.conteneur.querySelector('[data-zone-tableau]'), { ...commun, apresEcriture: () => this.depot.charger() });
    this.detail = new DetailFlux(zoneDetail, { ...commun, apresEcriture: () => Promise.all([this.tableau.charger(), this.depot.charger()]) });
    this.depot = new PanneauDepotManuel(zone('depot'), { ...commun, apresEcriture: () => this.tableau.charger() });
    this.parametres = new ParametresFe(zone('parametres'), {
      peut: { modifier: parametrer }, api: apiFe, connexions: () => this.#connexions, erreur,
    });

    const charges = new Set();
    const afficher = async (o) => {
      ecrireStockage(CLE_ONGLET, o);
      this.conteneur.querySelectorAll('[data-onglet]').forEach((b) => {
        b.classList.toggle('actif', b.dataset.onglet === o);
        b.setAttribute('aria-selected', String(b.dataset.onglet === o));
      });
      ONGLETS.forEach((x) => { zone(x).hidden = x !== o; });
      if (charges.has(o)) return;
      charges.add(o);
      if (o === 'parametres') await this.#chargerConnexions();
      await { flux: this.tableau, depot: this.depot, parametres: this.parametres }[o].charger();
    };
    this.conteneur.querySelectorAll('[data-onglet]').forEach((b) => b.addEventListener('click', () => afficher(b.dataset.onglet)));
    const flux = Number(this.requete?.flux);
    if (Number.isInteger(flux) && flux > 0) { await ouvrirFlux(flux); return; }
    await afficher(onglet);
  }
}
