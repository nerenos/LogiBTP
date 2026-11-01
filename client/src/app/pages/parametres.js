import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, THEMES, DENSITES, lirePreferences, ecrirePreferences, creerCombo } from '@logibtp/socle/ui';
import { MODES_REMISE } from '@logibtp/document/ui';
import { DISPOSITION_MENU, LARGEUR_MENU } from '@logibtp/navigation/ui';
import { VERSION_MOTEUR } from '../../calcul/index.js';
import { NAVIGATIONS } from '../terrain/terrain.js';
import { MODULE_FACULTATIF } from '../codes.js';

/** Paramètres : préférences de navigation, profil (démo), listes, fiches, GED, société, à propos. */
export class PageParametres extends PageBase {
  icone = icone('parametres_btp_page');

  async ouvrir() {
    const app = this.app;
    this.titre = texte('parametres_btp.general.titre');
    const s = await app.services();
    const parametresGed = await s.ged.parametres().catch(() => null);
    const societe = app.societe ?? {};
    const menu = app.bandeau.disposition;
    const remisesPct = lirePreferences().remises === MODES_REMISE.POURCENTAGE;
    // Application de terrain (préférences du navigateur) : même condition que le menu « Mon terrain ».
    const terrain = app.moduleActif(MODULE_FACULTATIF.PLANNING) !== false && app.acces('terrain');
    this.conteneur.innerHTML = `<div class="page-parametres">
      <h1 class="page-titre">${iconeHtml('parametres_btp_page')} ${texteHtml('parametres_btp.general.titre')}</h1>
      <section class="carte"><h2>${texteHtml('parametres_btp.general.affichage')}</h2>
        <div class="ligne" role="radiogroup" aria-label="${texteHtml('parametres_btp.general.theme')}">${THEMES.map((t) => `<label class="ligne"><input type="radio" name="theme" value="${t.code}"
          ${app.preferences.get('theme') === t.code ? 'checked' : ''}> ${t.icone} ${echapper(t.libelle)}</label>`).join('')}</div>
        <p class="aide">${texteHtml('parametres_btp.general.theme_aide')}</p>
        <h3>${texteHtml('parametres_btp.general.densite.titre')}</h3>
        <div class="ligne" role="radiogroup" aria-label="${texteHtml('parametres_btp.general.densite.titre')}">${DENSITES.map((d) => `<label class="ligne"><input type="radio" name="densite" value="${d.code}"
          ${(app.preferences.get('densite') ?? 'confortable') === d.code ? 'checked' : ''}> ${d.icone} ${echapper(d.libelle)}</label>`).join('')}</div>
        <p class="aide">${texteHtml('parametres_btp.general.densite.aide')}</p>
        <h3>${texteHtml('parametres_btp.general.menu.titre')}</h3>
        <div class="ligne" role="radiogroup" aria-label="${texteHtml('parametres_btp.general.menu.position')}">
          <label class="ligne"><input type="radio" name="menu-mode" value="${DISPOSITION_MENU.HAUT}" ${menu.mode !== DISPOSITION_MENU.DROITE ? 'checked' : ''}> ${iconeHtml('parametres_btp_menu_haut')} ${texteHtml('parametres_btp.general.menu.haut')}</label>
          <label class="ligne"><input type="radio" name="menu-mode" value="${DISPOSITION_MENU.GAUCHE}" ${menu.mode === DISPOSITION_MENU.GAUCHE ? 'checked' : ''}> ${iconeHtml('parametres_btp_menu_gauche')} ${texteHtml('parametres_btp.general.menu.gauche')}</label>
          <label class="ligne"><input type="radio" name="menu-mode" value="${DISPOSITION_MENU.DROITE}" ${menu.mode === DISPOSITION_MENU.DROITE ? 'checked' : ''}> ${iconeHtml('parametres_btp_menu_droite')} ${texteHtml('parametres_btp.general.menu.droite')}</label>
        </div>
        <div class="options-menu-lateral"${menu.mode === DISPOSITION_MENU.HAUT ? ' hidden' : ''}>
          <label class="ligne">${texteHtml('parametres_btp.general.menu.largeur')} <input type="number" data-menu="largeur" min="${LARGEUR_MENU.min}" max="${LARGEUR_MENU.max}" step="10" size="5" value="${menu.largeur}"> ${texteHtml('parametres_btp.general.menu.px')}</label>
          <label class="ligne"><input type="checkbox" data-menu="masque" ${menu.masque ? 'checked' : ''}> ${texteHtml('parametres_btp.general.menu.masquer', { icone: icone('parametres_btp_menu_haut') })}</label>
          <label class="ligne"><input type="checkbox" data-menu="masquageAuto" ${menu.masquageAuto ? 'checked' : ''}> ${texteHtml('parametres_btp.general.menu.masquage_auto')}</label>
        </div>
        <p class="aide">${texteHtml('parametres_btp.general.menu.aide')}</p>
        <h3>${texteHtml('parametres_btp.general.remises.titre')}</h3>
        <div class="ligne" role="radiogroup" aria-label="${texteHtml('parametres_btp.general.remises.libelle')}">
          <label class="ligne"><input type="radio" name="remises" value="${MODES_REMISE.COEFFICIENT}" ${remisesPct ? '' : 'checked'}> ${iconeHtml('parametres_btp_coefficient')} ${texteHtml('parametres_btp.general.remises.coefficient')}</label>
          <label class="ligne"><input type="radio" name="remises" value="${MODES_REMISE.POURCENTAGE}" ${remisesPct ? 'checked' : ''}> ${iconeHtml('parametres_btp_pourcentage')} ${texteHtml('parametres_btp.general.remises.pourcentage')}</label>
        </div>
        <p class="aide">${texteHtml('parametres_btp.general.remises.aide')}</p>
      </section>
      <section class="carte"><h2>${texteHtml('parametres_btp.general.raccourcis.titre')}</h2>
        <p class="aide">${texteHtml('parametres_btp.general.raccourcis.aide')}</p>
        <p><a href="/parametres/raccourcis">${iconeHtml('parametres_btp_raccourcis')} ${texteHtml('parametres_btp.general.raccourcis.lien')}</a></p>
      </section>
      ${terrain ? `<section class="carte" id="terrain"><h2>${iconeHtml('terrain_btp_page')} ${texteHtml('terrain_btp.reglages.titre')}</h2>
        <p class="ligne">${texteHtml('terrain_btp.page.navigation')} <span data-navigation-terrain></span></p>
        <p class="aide">${texteHtml('terrain_btp.page.navigation_aide')}</p>
        <label class="ligne"><input type="checkbox" data-presaisie-terrain ${lirePreferences().terrainPresaisie ? 'checked' : ''}> ${texteHtml('terrain_btp.page.presaisie')}</label>
        <p><a href="/terrain">${iconeHtml('terrain_btp_page')} ${texteHtml('terrain_btp.reglages.retour')}</a></p>
      </section>` : ''}
      <section class="carte"><h2>${texteHtml('parametres_btp.general.navigation.titre')}</h2>
        <label class="ligne"><input type="checkbox" data-pref="nouvelleFenetre" ${app.preferences.get('nouvelleFenetre') ? 'checked' : ''}>
          ${texteHtml('parametres_btp.general.navigation.nouvelle_fenetre')}</label>
        <p class="aide">${texteHtml('parametres_btp.general.navigation.aide')}</p>
        <p><button type="button" data-action="fenetres">${iconeHtml('parametres_btp_fenetres')} ${texteHtml('parametres_btp.general.navigation.fenetres')}</button>
          <button type="button" data-action="oublier" ${app.fenetres.sessionPrecedente() ? '' : 'disabled'}>${texteHtml('parametres_btp.general.navigation.oublier')}</button>
          <button type="button" data-action="session" class="danger">${iconeHtml('parametres_btp_session')} ${texteHtml('parametres_btp.general.navigation.session')}</button></p>
      </section>
      <section class="carte"><h2>${texteHtml('parametres_btp.general.utilisateur.titre')}</h2>
        <p>${texteHtml('parametres_btp.general.utilisateur.texte_html', { utilisateur: app.utilisateur(), profil: app.profil() })} <a href="/compte">${iconeHtml('parametres_btp_compte')} ${texteHtml('parametres_btp.general.utilisateur.compte')}</a></p>
      </section>
      <section class="carte"><h2>${texteHtml('parametres_btp.general.listes.titre')}</h2>
        <p><button type="button" data-action="themes" ${app.peutGererThemes() ? '' : 'disabled'}>${iconeHtml('parametres_btp_themes')} ${texteHtml('parametres_btp.general.listes.themes')}</button>
          <button type="button" data-action="fiche" data-type="salarie" ${app.estAdmin() ? '' : 'disabled'}>${iconeHtml('parametres_btp_salarie')} ${texteHtml('parametres_btp.general.listes.salarie')}</button>
          <button type="button" data-action="fiche" data-type="materiel" ${app.estAdmin() ? '' : 'disabled'}>${iconeHtml('parametres_btp_materiel')} ${texteHtml('parametres_btp.general.listes.materiel')}</button></p>
      </section>
      ${parametresGed ? `<section class="carte"><h2>${texteHtml('parametres_btp.general.ged.titre')}</h2>
        <dl class="definitions"><dt>${texteHtml('parametres_btp.general.ged.editions')}</dt><dd>${texteHtml('parametres_btp.general.ged.editions_valeur', { nombre: parametresGed.editions_conservees })}</dd>
        <dt>${texteHtml('parametres_btp.general.ged.apercu')}</dt><dd>${texteHtml('terrain_btp.page.taille_mo', { taille: Math.round(parametresGed.taille_apercu_max / 1048576) })}</dd>
        <dt>${texteHtml('parametres_btp.general.ged.copie')}</dt><dd>${echapper(parametresGed.adresse_copie_cachee || texte('parametres_btp.general.ged.copie_vide'))}</dd>
        <dt>${texteHtml('parametres_btp.general.ged.categories')}</dt><dd>${parametresGed.categories.map((c) => `${echapper(c.libelle)}${c.coffre ? ` ${iconeHtml('verrou')}` : ''}`).join(' · ')}</dd></dl>
      </section>` : ''}
      <section class="carte"><h2>${texteHtml('parametres_btp.general.societe.titre')}</h2>
        <dl class="definitions"><dt>${texteHtml('parametres_btp.general.societe.titre')}</dt><dd>${echapper(societe.libelle ?? '')}${societe.principale ? ` ${texteHtml('parametres_btp.general.societe.principale')}` : ''}</dd>
        <dt>${texteHtml('parametres_btp.general.societe.adresse')}</dt><dd><code>${echapper(location.host)}</code></dd></dl>
        <p class="aide">${texteHtml('parametres_btp.general.societe.aide_html', { exemple: `acme.${location.host.replace(/^[^.]+\.(?=.*\.)/, '')}` })}</p>
      </section>
      <section class="carte" id="apropos"><h2>${texteHtml('parametres_btp.general.apropos.titre')}</h2>
        <dl class="definitions"><dt>${texteHtml('parametres_btp.general.apropos.application')}</dt><dd>${texteHtml('parametres_btp.general.apropos.nom')}</dd><dt>${texteHtml('parametres_btp.general.apropos.moteur')}</dt><dd>${echapper(VERSION_MOTEUR)}</dd></dl>
      </section>
    </div>`;
    this.conteneur.querySelectorAll('input[name="theme"]').forEach((r) => r.addEventListener('change', () => app.changerTheme(r.value)));
    this.conteneur.querySelectorAll('input[name="densite"]').forEach((r) => r.addEventListener('change', () => app.changerDensite(r.value)));
    this.conteneur.querySelectorAll('input[name="remises"]').forEach((r) => r.addEventListener('change', () => ecrirePreferences({ remises: r.value })));
    const optionsLateral =this.conteneur.querySelector('.options-menu-lateral');
    this.conteneur.querySelectorAll('input[name="menu-mode"]').forEach((r) => r.addEventListener('change', () => {
      app.changerMenu({ mode: r.value });
      optionsLateral.hidden = r.value === DISPOSITION_MENU.HAUT;
    }));
    optionsLateral.addEventListener('change', (e) => {
      const champ = e.target.closest('[data-menu]');
      if (!champ) return;
      app.changerMenu({ [champ.dataset.menu]: champ.type === 'checkbox' ? champ.checked : Number(champ.value) });
      champ.value = champ.type === 'checkbox' ? champ.value : app.bandeau.disposition.largeur;
    });
    if (terrain) {
      const n = lirePreferences().terrainNavigation;
      const nav = creerCombo({ options: Object.entries(NAVIGATIONS).map(([valeur, libelle]) => ({ valeur, libelle })), valeur: NAVIGATIONS[n] ? n : 'AUTO', vide: false });
      nav.addEventListener('change', () => ecrirePreferences({ terrainNavigation: nav.valeurCombo }));
      this.conteneur.querySelector('[data-navigation-terrain]').append(nav);
      this.conteneur.querySelector('[data-presaisie-terrain]').addEventListener('change', (e) => ecrirePreferences({ terrainPresaisie: e.target.checked }));
    }
    this.conteneur.querySelector('[data-pref="nouvelleFenetre"]').addEventListener('change', (e) => app.preferences.set('nouvelleFenetre', e.target.checked));
    this.conteneur.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-action]');
      if (!b) return;
      const actions = {
        fenetres: () => app.listeFenetres(),
        oublier: () => { app.fenetres.oublierSessionPrecedente(); b.disabled = true; app.message(texte('parametres_btp.general.navigation.oubliee')); },
        session: () => app.fermerSession(),
        themes: () => app.gererThemes(),
        fiche: () => app.parametrerFiche(b.dataset.type),
      };
      Promise.resolve(actions[b.dataset.action]?.()).catch((x) => app.erreur(x));
    });
    if (location.hash) this.conteneur.querySelector(location.hash)?.scrollIntoView();
  }
}
