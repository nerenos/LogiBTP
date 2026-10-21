import { PageBase } from '@logibtp/navigation';
import { echapper } from '@logibtp/socle/ui';
import { controlerMotDePasse, MESSAGES_AUTH } from '@logibtp/authentification';
import { api } from '../api.js';

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
    const impose = s.mdp_a_changer;
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">👤 Mon compte</h1>
      ${impose ? '<p class="carte avertissement">🔐 Mot de passe provisoire : choisissez votre mot de passe pour continuer.</p>' : ''}
      <section class="carte"><h2>Session</h2>
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
    this.conteneur.querySelectorAll('[data-action="deconnecter"]').forEach((b) => b.addEventListener('click', () => app.deconnecter()));
    const form = this.conteneur.querySelector('[data-form]');
    form.addEventListener('submit', (e) => { e.preventDefault(); this.#changer(form); });
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
