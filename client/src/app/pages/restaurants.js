import { PageBase } from '@logibtp/navigation';
import { echapper, lirePreferences } from '@logibtp/socle/ui';
import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { api } from '../api.js';
import { NAVIGATIONS, lienItineraire } from '../terrain/terrain.js';

// Restaurants du module Pointage (plan restaurants-suites, lot 5) : liste des tiers de relation RESTAURANT avec leur
// adresse et un lien d'itinéraire (même fonction que le terrain, préférence de navigation du terrain). Pas de carte.

/** Ligne du tableau : nom, adresse (ou mention), ville, lien d'itinéraire quand l'adresse est connue. */
export function ligneRestaurant(r, navigation = 'AUTO', agent = '') {
  const lien = r.adresse
    ? `<a href="${echapper(lienItineraire(r.adresse, navigation, agent))}" target="_blank" rel="noopener">${iconeHtml('terrain_btp_itineraire')} ${texteHtml('pointage.restaurants_page.itineraire')}</a>`
    : '';
  return `<tr><td>${echapper(r.nom)}</td><td>${r.adresse ? echapper(r.adresse) : `<span class="aide">${texteHtml('pointage.restaurants_page.sans_adresse')}</span>`}</td>
    <td>${echapper(r.ville ?? '')}</td><td>${lien}</td></tr>`;
}

export class PageRestaurantsPointage extends PageBase {
  urlCourante() { return this.recherche ? `/pointage/restaurants?recherche=${encodeURIComponent(this.recherche)}` : '/pointage/restaurants'; }

  async ouvrir() {
    this.titre = texte('pointage.restaurants_page.titre');
    this.recherche = this.requete.recherche ?? '';
    this.conteneur.innerHTML = `<div class="page-parametres page-pointage"><div class="entete-page"><h1 class="page-titre">${iconeHtml('navigation_btp_pointage_restaurants')} ${texteHtml('pointage.restaurants_page.titre')}</h1>
      <p class="ligne"><input type="search" data-recherche placeholder="${texteHtml('pointage.restaurants_page.recherche')}" value="${echapper(this.recherche)}"> <span class="aide" data-nombre></span></p></div>
      <div data-resultat></div></div>`;
    this.conteneur.querySelector('[data-recherche]').addEventListener('change', (e) => { this.recherche = e.target.value.trim(); this.#charger(); });
    await this.#charger();
  }

  async #charger() {
    const l = await api.pointage.restaurants(null, this.recherche);
    const n = lirePreferences().terrainNavigation;
    const navigation = NAVIGATIONS[n] ? n : 'AUTO';
    this.conteneur.querySelector('[data-nombre]').textContent = texte('pointage.restaurants_page.nombre', { n: l.length });
    this.conteneur.querySelector('[data-resultat]').innerHTML = l.length
      ? `<table class="tableau"><thead><tr><th>${texteHtml('pointage.restaurants_page.nom')}</th><th>${texteHtml('pointage.restaurants_page.adresse')}</th><th>${texteHtml('pointage.restaurants_page.ville')}</th><th></th></tr></thead>
        <tbody>${l.map((r) => ligneRestaurant(r, navigation, navigator.userAgent)).join('')}</tbody></table>`
      : `<p class="aide">${texteHtml('pointage.restaurants_page.vide')}</p>`;
  }
}
