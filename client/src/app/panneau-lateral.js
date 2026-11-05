// Panneau latéral réductible des pages de saisie et de synthèse (référence : pages du Pointage) : panneau à gauche,
// réduit en bouton, largeur au glisser du séparateur ; état et largeur dans les préférences du navigateur
// (`<cle>Reduite`, `<cle>Largeur`).
import { lirePreferences, ecrirePreferences, separateur } from '@logibtp/socle/ui';
import { texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';

/**
 * Présentation de référence du module (synthèse) : corps à panneau latéral. Panneau à gauche (barre : titre, filtres,
 * actions à droite et « pour réduire ; liste ; légende fixée en bas), séparateur à glisser (largeur), bouton 👥 quand il
 * est réduit, détail à droite. Préférences `<cle>Reduite` et `<cle>Largeur` (navigateur).
 */
export function gabaritPanneau(cle, { titre, objet, filtres = '', actions = '' }) {
  const prefs = lirePreferences();
  const reduit = prefs[`${cle}Reduite`] ?? window.matchMedia('(max-width: 900px)').matches;
  return `<div class="corps-panneau${reduit ? ' panneau-reduit' : ''}" data-panneau="${cle}">
      <aside class="panneau-lateral" style="width: ${Number(prefs[`${cle}Largeur`]) || 560}px">
        <div class="panneau-lateral-barre"><b>${titre}</b> ${filtres}
          <span class="panneau-actions">${actions}<button type="button" class="bouton-icone" data-replier title="${texteHtml('navigation_btp.panneau_lateral.reduire', { objet })}" aria-label="${texteHtml('navigation_btp.panneau_lateral.reduire', { objet })}">${iconeHtml('navigation_btp_panneau_replier')}</button></span></div>
        <div data-corrections></div><div data-liste class="panneau-lateral-liste"></div><div class="panneau-legende" data-legende></div></aside>
      <div class="panneau-separateur" data-separateur title="${texteHtml('navigation_btp.panneau_lateral.separateur')}"></div>
      <button type="button" class="bouton-icone panneau-deplier" data-deplier title="${texteHtml('navigation_btp.panneau_lateral.afficher', { objet })}" aria-label="${texteHtml('navigation_btp.panneau_lateral.afficher', { objet })}">${iconeHtml('navigation_btp_panneau_deplier')}</button>
      <div data-detail class="panneau-detail"></div></div>`;
}

/** Comportement du panneau latéral : réduire / déplier, largeur au glisser du séparateur (préférences du navigateur). */
export function brancherPanneau(conteneur) {
  const corps = conteneur.querySelector('[data-panneau]');
  const cle = corps.dataset.panneau;
  const panneau = corps.querySelector('.panneau-lateral');
  const reduire = (r) => { corps.classList.toggle('panneau-reduit', r); ecrirePreferences({ [`${cle}Reduite`]: r }); };
  corps.querySelector('[data-replier]').addEventListener('click', () => reduire(true));
  corps.querySelector('[data-deplier]').addEventListener('click', () => reduire(false));
  separateur(corps.querySelector('[data-separateur]'), {
    cible: panneau, min: 280, max: () => window.innerWidth - 320,
    appliquer: (p, v) => { p.style.width = `${v}px`; },
    surFin: (v) => ecrirePreferences({ [`${cle}Largeur`]: v }),
  });
}
