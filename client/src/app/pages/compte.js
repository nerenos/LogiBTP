import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { TYPE_FICHE } from '../codes.js';
import { PageBase } from '@logibtp/navigation';
import { echapper, confirmer, formatDateHeure } from '@logibtp/socle/ui';
import { controlerMotDePasse, MESSAGES_AUTH } from '@logibtp/authentification';
import { api } from '../api.js';
import { urlPhotoIndividu, vignette } from '../annuaire/photo.js';

/**
 * Mon compte (module Authentification) : identité de la session, changement du mot de passe (imposé tant que le mot de
 * passe est provisoire : `?changer=1`), déconnexion de toutes les fenêtres.
 */
export class PageCompte extends PageBase {
  icone = icone('authentification_btp_compte');

  async ouvrir() {
    const app = this.app;
    this.titre = texte('authentification_btp.mon_compte.titre');
    const s = app.session;
    if (!s?.connecte) {
      this.conteneur.innerHTML = `<div class="page-simple"><h1>${iconeHtml('authentification_btp_compte')} ${texteHtml('authentification_btp.mon_compte.titre')}</h1><p class="aide">${texteHtml('authentification_btp.mon_compte.non_connecte')}</p>
        <p><a href="/connexion">${iconeHtml('authentification_btp_connexion')} ${texteHtml('authentification_btp.connexion.se_connecter')}</a></p></div>`;
      return;
    }
    this.politique = await api.auth.politique().catch(() => ({ longueur_min: 12, courants: [] }));
    // Photo de l'individu du compte (fiche de l'annuaire), affichée dans la carte Session une fois lue.
    if (s.type_element === TYPE_FICHE.INDIVIDU && s.id_element) {
      app.services().then((sv) => urlPhotoIndividu(sv.fiche, sv.ged, s.id_element)).then((url) => {
        const z = this.conteneur.querySelector('[data-photo]');
        if (z && url) z.innerHTML = vignette(url);
      }).catch(() => {});
    }
    const impose = s.mdp_a_changer;
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">${iconeHtml('authentification_btp_compte')} ${texteHtml('authentification_btp.mon_compte.titre')}</h1>
      ${impose ? `<p class="carte avertissement">${iconeHtml('authentification_btp_mdp')} ${texteHtml('authentification_btp.mon_compte.provisoire')}</p>` : ''}
      <section class="carte"><h2>${texteHtml('authentification_btp.mon_compte.session')}</h2><span data-photo></span>
        <dl class="definitions"><dt>${texteHtml('authentification_btp.connexion.identifiant')}</dt><dd><b>${echapper(s.code)}</b></dd>
        <dt>${texteHtml('authentification_btp.mon_compte.nom')}</dt><dd>${echapper(s.libelle ?? '')}</dd><dt>${texteHtml('authentification_btp.compte.profil')}</dt><dd>${echapper(s.profil)}</dd>
        <dt>${texteHtml('authentification_btp.mon_compte.societe')}</dt><dd>${echapper(app.societe?.libelle ?? '')}</dd>
        ${s.expire_le ? `<dt>${texteHtml('authentification_btp.mon_compte.expire')}</dt><dd>${texteHtml('authentification_btp.mon_compte.expire_valeur', { date: formatDateHeure(s.expire_le) })}</dd>` : ''}</dl>
        ${impose ? '' : `<p><button type="button" data-action="deconnecter" class="danger">${iconeHtml('authentification_btp_deconnecter')} ${texteHtml('authentification_btp.mon_compte.deconnecter')}</button></p>`}
      </section>
      <form class="carte" data-form autocomplete="on"><h2>${texteHtml('authentification_btp.mon_compte.changer')}</h2>
        <input type="text" name="identifiant" autocomplete="username" value="${echapper(s.code)}" hidden>
        <p><label>${impose ? texteHtml('authentification_btp.mon_compte.actuel_provisoire') : texteHtml('authentification_btp.mon_compte.actuel')}<br><input type="password" name="actuel" autocomplete="current-password" required></label></p>
        <p><label>${texteHtml('authentification_btp.connexion.nouveau')}<br><input type="password" name="nouveau" autocomplete="new-password" required minlength="${this.politique.longueur_min}"></label></p>
        <p><label>${texteHtml('authentification_btp.connexion.confirmation')}<br><input type="password" name="confirmation" autocomplete="new-password" required></label></p>
        <p class="aide">${texteHtml('authentification_btp.mon_compte.regle_mdp', { n: this.politique.longueur_min })}</p>
        <p class="connexion-erreur" data-erreur hidden></p>
        <p><button type="submit" class="principal">${texteHtml('authentification_btp.mon_compte.enregistrer_mdp')}</button>${impose ? ` <button type="button" data-action="deconnecter">${iconeHtml('authentification_btp_deconnecter')} ${texteHtml('authentification_btp.mon_compte.deconnecter')}</button>` : ''}</p>
      </form></div>`;
    if (!impose) this.conteneur.querySelector('.page-parametres').insertAdjacentHTML('beforeend', '<section class="carte" data-sessions></section>');
    this.conteneur.querySelectorAll('[data-action="deconnecter"]').forEach((b) => b.addEventListener('click', () => app.deconnecter()));
    if (!impose) this.#rendreSessions(this.conteneur.querySelector('[data-sessions]')).catch((e) => app.erreur(e));
    const form = this.conteneur.querySelector('[data-form]');
    form.addEventListener('submit', (e) => { e.preventDefault(); this.#changer(form); });
  }

  /**
   * Mes sessions (déconnexion à distance), mes machines connues (« Rester connecté », pas de code de connexion) et le
   * double facteur choisi (module Droits, lot 3).
   */
  async #rendreSessions(zone) {
    const { sessions, machines, double_facteur: double } = await api.auth.sessions();
    zone.innerHTML = `<h2 class="titre-actions">${texteHtml('authentification_btp.mon_compte.sessions')} <span>${sessions.length > 1 ? `<button type="button" data-fermer-autres>${iconeHtml('authentification_btp_deconnecter')} ${texteHtml('authentification_btp.mon_compte.fermer_autres')}</button>` : ''}</span></h2>
      <table class="tableau-compact"><thead><tr><th>${texteHtml('authentification_btp.mon_compte.navigateur')}</th><th>${texteHtml('authentification_btp.mon_compte.adresse')}</th><th>${texteHtml('authentification_btp.mon_compte.ouverte')}</th><th>${texteHtml('authentification_btp.mon_compte.derniere_activite')}</th><th>${texteHtml('authentification_btp.mon_compte.expire')}</th><th></th></tr></thead><tbody>
      ${sessions.map((s) => `<tr><td>${echapper(s.navigateur ?? '')}${s.machine ? ` <span class="pastille" title="${texteHtml('authentification_btp.mon_compte.machine_connue', { machine: s.machine })}">${iconeHtml('authentification_btp_machine')}</span>` : ''}${s.api ? ` <span class="pastille">${texteHtml('authentification_btp.mon_compte.api')}</span>` : ''}</td>
        <td>${echapper(s.adresse ?? '')}</td><td>${formatDateHeure(s.cree_le)}</td><td>${formatDateHeure(s.vu_le)}</td><td>${formatDateHeure(s.expire_le)}</td>
        <td class="cellule-boutons">${s.courante ? `<span class="aide">${texteHtml('authentification_btp.mon_compte.celle_ci')}</span>` : `<button type="button" class="bouton-icone" data-fermer="${s.id}" title="${texteHtml('authentification_btp.mon_compte.fermer_session')}">${iconeHtml('authentification_btp_deconnecter')}</button>`}</td></tr>`).join('')}</tbody></table>
      <h2>${texteHtml('authentification_btp.mon_compte.machines')}</h2>
      <p class="aide">${texteHtml('authentification_btp.mon_compte.machines_aide')}</p>
      ${machines.length ? `<table class="tableau-compact"><thead><tr><th>${texteHtml('authentification_btp.mon_compte.machine')}</th><th>${texteHtml('authentification_btp.mon_compte.adresse')}</th><th>${texteHtml('authentification_btp.mon_compte.connue_depuis')}</th><th>${texteHtml('authentification_btp.compte.derniere_connexion')}</th><th></th></tr></thead><tbody>
        ${machines.map((m) => `<tr><td>${echapper(m.nom ?? '')}</td><td>${echapper(m.adresse ?? '')}</td><td>${formatDateHeure(m.cree_le)}</td><td>${formatDateHeure(m.vu_le)}</td>
          <td class="cellule-boutons"><button type="button" class="bouton-icone" data-oublier="${m.id}" title="${texteHtml('authentification_btp.mon_compte.oublier_aide')}">${iconeHtml('retirer')}</button></td></tr>`).join('')}</tbody></table>`
        : `<p class="aide">${texteHtml('authentification_btp.mon_compte.aucune_machine')}</p>`}
      <p><label class="ligne"><input type="checkbox" data-double ${double ? 'checked' : ''}> ${texteHtml('authentification_btp.mon_compte.double')}</label></p>`;
    const recharger = () => this.#rendreSessions(zone).catch((e) => this.app.erreur(e));
    zone.querySelector('[data-fermer-autres]')?.addEventListener('click', () => api.auth.fermerSessions().then(recharger).catch((e) => this.app.erreur(e)));
    zone.querySelectorAll('[data-fermer]').forEach((b) => b.addEventListener('click', () => api.auth.fermerSession(b.dataset.fermer).then(recharger).catch((e) => this.app.erreur(e))));
    zone.querySelectorAll('[data-oublier]').forEach((b) => b.addEventListener('click', async () => {
      if (await confirmer(texte('authentification_btp.mon_compte.confirmer_oubli'))) api.auth.oublierMachine(b.dataset.oublier).then(recharger).catch((e) => this.app.erreur(e));
    }));
    zone.querySelector('[data-double]').addEventListener('change', (e) => api.auth.doubleFacteur(e.target.checked).catch((x) => this.app.erreur(x)));
  }

  async #changer(form) {
    const f = new FormData(form);
    const erreur = this.conteneur.querySelector('[data-erreur]');
    const afficher = (message) => { erreur.textContent = message; erreur.hidden = !message; };
    const nouveau = f.get('nouveau');
    const codes = controlerMotDePasse(nouveau, this.politique, this.app.session.code);
    if (nouveau !== f.get('confirmation')) codes.push('CONFIRMATION');
    if (codes.length) { afficher(codes.map((c) => MESSAGES_AUTH[c] ?? texte('authentification_btp.mon_compte.confirmation_differe')).join(' · ')); return; }
    afficher('');
    try {
      const etaitProvisoire = this.app.session.mdp_a_changer;
      this.app.session = await api.auth.changerMotDePasse(f.get('actuel'), nouveau);
      this.app.message(texte('authentification_btp.mon_compte.mdp_enregistre'), 'succes');
      if (etaitProvisoire) { this.app.fermetureForcee = true; location.assign('/'); return; }
      form.reset();
    } catch (e) { afficher(e.message); }
  }
}
