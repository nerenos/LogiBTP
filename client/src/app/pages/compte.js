import { PageBase } from '@logibtp/navigation';
import { echapper, confirmer } from '@logibtp/socle/ui';
import { controlerMotDePasse, MESSAGES_AUTH } from '@logibtp/authentification';
import { api } from '../api.js';
import { urlPhotoIndividu, vignette } from '../annuaire/photo.js';

/**
 * Mon compte (module Authentification) : identité de la session, changement du mot de passe (imposé tant que le mot de
 * passe est provisoire : `?changer=1`), déconnexion de toutes les fenêtres.
 */
export class PageCompte extends PageBase {
  icone = '👤';

  async ouvrir() {
    const app = this.app;
    this.titre = 'Mon compte';
    const s = app.session;
    if (!app.enLigne || !s?.connecte) {
      this.conteneur.innerHTML = `<div class="page-simple"><h1>👤 Mon compte</h1><p class="aide">${app.enLigne ? 'Non connecté.' : 'Démonstration hors ligne : pas de compte.'}</p>
        <p><a href="${app.enLigne ? '/connexion' : '/'}">${app.enLigne ? '🔑 Se connecter' : '⌂ Accueil'}</a></p></div>`;
      return;
    }
    this.politique = await api.auth.politique().catch(() => ({ longueur_min: 12, courants: [] }));
    // Photo de l'individu du compte (fiche de l'annuaire), affichée dans la carte Session une fois lue.
    if (s.type_element === 'individu' && s.id_element) {
      app.services().then((sv) => urlPhotoIndividu(sv.fiche, sv.ged, s.id_element)).then((url) => {
        const z = this.conteneur.querySelector('[data-photo]');
        if (z && url) z.innerHTML = vignette(url);
      }).catch(() => {});
    }
    const impose = s.mdp_a_changer;
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">👤 Mon compte</h1>
      ${impose ? '<p class="carte avertissement">🔐 Mot de passe provisoire : choisissez votre mot de passe pour continuer.</p>' : ''}
      <section class="carte"><h2>Session</h2><span data-photo></span>
        <dl class="definitions"><dt>Identifiant</dt><dd><b>${echapper(s.code)}</b></dd>
        <dt>Nom</dt><dd>${echapper(s.libelle ?? '')}</dd><dt>Profil</dt><dd>${echapper(s.profil)}</dd>
        <dt>Société</dt><dd>${echapper(app.societe?.libelle ?? '')}</dd>
        ${s.expire_le ? `<dt>Expire</dt><dd>${new Date(s.expire_le).toLocaleString('fr-FR')} (prolongée à chaque utilisation, sauf « Rester connecté »)</dd>` : ''}</dl>
        ${impose ? '' : '<p><button type="button" data-action="deconnecter" class="danger">⏻ Se déconnecter</button></p>'}
      </section>
      <form class="carte" data-form autocomplete="on"><h2>Changer mon mot de passe</h2>
        <input type="text" name="identifiant" autocomplete="username" value="${echapper(s.code)}" hidden>
        <p><label>Mot de passe actuel${impose ? ' (provisoire)' : ''}<br><input type="password" name="actuel" autocomplete="current-password" required></label></p>
        <p><label>Nouveau mot de passe<br><input type="password" name="nouveau" autocomplete="new-password" required minlength="${this.politique.longueur_min}"></label></p>
        <p><label>Confirmation<br><input type="password" name="confirmation" autocomplete="new-password" required></label></p>
        <p class="aide">${this.politique.longueur_min} caractères au moins, sans votre identifiant ; une phrase de plusieurs mots est plus sûre et plus facile à retenir.</p>
        <p class="connexion-erreur" data-erreur hidden></p>
        <p><button type="submit" class="principal">Enregistrer le mot de passe</button>${impose ? ' <button type="button" data-action="deconnecter">⏻ Se déconnecter</button>' : ''}</p>
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
    const date = (d) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    zone.innerHTML = `<h2 class="titre-actions">Mes sessions <span>${sessions.length > 1 ? '<button type="button" data-fermer-autres>⏻ Fermer les autres sessions</button>' : ''}</span></h2>
      <table class="tableau-compact"><thead><tr><th>Navigateur</th><th>Adresse</th><th>Ouverte</th><th>Dernière activité</th><th>Expire</th><th></th></tr></thead><tbody>
      ${sessions.map((s) => `<tr><td>${echapper(s.navigateur ?? '')}${s.machine ? ` <span class="pastille" title="Machine connue : ${echapper(s.machine)}">💻</span>` : ''}${s.api ? ' <span class="pastille">API</span>' : ''}</td>
        <td>${echapper(s.adresse ?? '')}</td><td>${date(s.cree_le)}</td><td>${date(s.vu_le)}</td><td>${date(s.expire_le)}</td>
        <td class="cellule-boutons">${s.courante ? '<span class="aide">celle-ci</span>' : `<button type="button" class="bouton-icone" data-fermer="${s.id}" title="Fermer cette session">⏻</button>`}</td></tr>`).join('')}</tbody></table>
      <h2>Mes machines connues</h2>
      <p class="aide">Une machine connue permet « Rester connecté » (7 jours) et la connexion sans code. Oubliez une machine perdue ou partagée.</p>
      ${machines.length ? `<table class="tableau-compact"><thead><tr><th>Machine</th><th>Adresse</th><th>Connue depuis</th><th>Dernière connexion</th><th></th></tr></thead><tbody>
        ${machines.map((m) => `<tr><td>${echapper(m.nom ?? '')}</td><td>${echapper(m.adresse ?? '')}</td><td>${date(m.cree_le)}</td><td>${date(m.vu_le)}</td>
          <td class="cellule-boutons"><button type="button" class="bouton-icone" data-oublier="${m.id}" title="Oublier cette machine (ses sessions sont fermées)">✕</button></td></tr>`).join('')}</tbody></table>`
        : '<p class="aide">Aucune machine connue.</p>'}
      <p><label class="ligne"><input type="checkbox" data-double ${double ? 'checked' : ''}> Me demander un code par courriel à chaque connexion depuis une machine inconnue</label></p>`;
    const recharger = () => this.#rendreSessions(zone).catch((e) => this.app.erreur(e));
    zone.querySelector('[data-fermer-autres]')?.addEventListener('click', () => api.auth.fermerSessions().then(recharger).catch((e) => this.app.erreur(e)));
    zone.querySelectorAll('[data-fermer]').forEach((b) => b.addEventListener('click', () => api.auth.fermerSession(b.dataset.fermer).then(recharger).catch((e) => this.app.erreur(e))));
    zone.querySelectorAll('[data-oublier]').forEach((b) => b.addEventListener('click', async () => {
      if (await confirmer('Oublier cette machine ? Ses sessions sont fermées.')) api.auth.oublierMachine(b.dataset.oublier).then(recharger).catch((e) => this.app.erreur(e));
    }));
    zone.querySelector('[data-double]').addEventListener('change', (e) => api.auth.doubleFacteur(e.target.checked).catch((x) => this.app.erreur(x)));
  }

  async #changer(form) {
    const f = new FormData(form);
    const erreur = this.conteneur.querySelector('[data-erreur]');
    const afficher = (texte) => { erreur.textContent = texte; erreur.hidden = !texte; };
    const nouveau = f.get('nouveau');
    const codes = controlerMotDePasse(nouveau, this.politique, this.app.session.code);
    if (nouveau !== f.get('confirmation')) codes.push('CONFIRMATION');
    if (codes.length) { afficher(codes.map((c) => MESSAGES_AUTH[c] ?? 'La confirmation diffère du nouveau mot de passe').join(' · ')); return; }
    afficher('');
    try {
      const etaitProvisoire = this.app.session.mdp_a_changer;
      this.app.session = await api.auth.changerMotDePasse(f.get('actuel'), nouveau);
      this.app.message('Mot de passe enregistré ; vos autres sessions sont fermées', 'succes');
      if (etaitProvisoire) { this.app.fermetureForcee = true; location.assign('/'); return; }
      form.reset();
    } catch (e) { afficher(e.message); }
  }
}
