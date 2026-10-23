import { PageBase } from '@logibtp/navigation';
import { echapper } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { controlerMotDePasse, MESSAGES_AUTH } from '@logibtp/authentification';

/**
 * Connexion (module Authentification) : identifiant (pseudo du compte) et mot de passe, « Rester connecté » si la
 * société le permet. Seule page accessible sans session. En développement (ComptesTest), connexion à un compte choisi
 * sans mot de passe. `?retour=` : page à rouvrir après la connexion ; `?fenetre=1` : fenêtre ouverte pendant une saisie
 * (session expirée), refermée après la connexion. Mot de passe oublié (messagerie configurée) : lien envoyé par courriel ;
 * `?jeton=` : choix du nouveau mot de passe depuis ce lien.
 */
export class PageConnexion extends PageBase {
  icone = '🔑';

  get fenetreSeule() { return this.requete.fenetre === '1'; }

  async ouvrir() {
    const app = this.app;
    this.titre = 'Connexion';
    if (!app.enLigne) {
      this.conteneur.innerHTML = `<div class="page-simple"><h1>🔑 Connexion</h1>
        <p class="aide">Démonstration hors ligne : pas de connexion ; le profil de démonstration se choisit dans les <a href="/parametres">paramètres</a>.</p>
        <p><a href="/">⌂ Accueil</a></p></div>`;
      return;
    }
    const session = app.session ?? {};
    if (this.requete.jeton) { await this.#rendreReinitialisation(); return; }
    if (session.connecte && !this.fenetreSeule) { this.#poursuivre(session); return; }
    const societe = app.societe;
    this.conteneur.innerHTML = `<div class="page-connexion"><form class="carte connexion" data-form autocomplete="on">
        <h1>🔑 Connexion</h1>
        ${societe ? `<p class="aide">🏢 ${echapper(societe.libelle)}</p>` : ''}
        <label>Identifiant<input name="identifiant" autocomplete="username" required autofocus spellcheck="false" autocapitalize="none"></label>
        <label>Mot de passe<input name="mdp" type="password" autocomplete="current-password" required></label>
        ${session.rester_connecte_permis !== false ? `<label class="ligne"><input type="checkbox" name="rester"> Rester connecté sur ce poste</label>
          <p class="aide">À éviter sur un poste partagé.</p>` : ''}
        <p class="connexion-erreur" data-erreur hidden></p>
        <p><button type="submit" class="principal">Se connecter</button></p>
        <p class="aide" data-oubli>Mot de passe oublié : un administrateur vous en donne un provisoire.</p>
      </form><div data-test></div></div>`;
    api.auth.politique().then((p) => { if (p.oubli_courriel) this.#proposerOubli(); }).catch(() => {});
    const form = this.conteneur.querySelector('[data-form]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      await this.#connecter(() => api.auth.connexion(f.get('identifiant'), f.get('mdp'), f.get('rester') === 'on'));
    });
    if (session.comptes_test) await this.#rendreComptesTest();
  }

  /** Mot de passe oublié : identifiant → lien envoyé par courriel (réponse identique que le compte existe ou non). */
  #proposerOubli() {
    const zone = this.conteneur.querySelector('[data-oubli]');
    zone.innerHTML = '<button type="button" class="lien" data-ouvrir-oubli>Mot de passe oublié ?</button>';
    zone.querySelector('[data-ouvrir-oubli]').addEventListener('click', () => {
      const identifiant = this.conteneur.querySelector('[name="identifiant"]').value;
      zone.innerHTML = `<span>Recevoir par courriel un lien pour choisir un nouveau mot de passe :</span>
        <span class="ligne"><input data-identifiant-oubli value="${echapper(identifiant)}" placeholder="identifiant" autocapitalize="none" spellcheck="false">
        <button type="button" data-envoyer-oubli>Envoyer le lien</button></span>`;
      zone.querySelector('[data-envoyer-oubli]').addEventListener('click', async () => {
        const id = zone.querySelector('[data-identifiant-oubli]').value.trim();
        if (!id) return;
        try { zone.textContent = (await api.auth.oubli(id)).message; } catch (e) { zone.textContent = e.message; }
      });
    });
  }

  /** Nouveau mot de passe depuis le lien reçu par courriel (`?jeton=`), contrôlé par la politique avant l'envoi. */
  async #rendreReinitialisation() {
    const politique = await api.auth.politique().catch(() => null);
    this.titre = 'Nouveau mot de passe';
    this.conteneur.innerHTML = `<div class="page-connexion"><form class="carte connexion" data-form>
        <h1>🔑 Nouveau mot de passe</h1>
        <label>Nouveau mot de passe<input name="nouveau" type="password" autocomplete="new-password" required autofocus></label>
        <label>Confirmation<input name="confirmation" type="password" autocomplete="new-password" required></label>
        ${politique ? `<p class="aide">${politique.longueur_min} caractères au moins.</p>` : ''}
        <p class="connexion-erreur" data-erreur hidden></p>
        <p><button type="submit" class="principal">Enregistrer</button></p></form></div>`;
    const form = this.conteneur.querySelector('[data-form]');
    const erreur = this.conteneur.querySelector('[data-erreur]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const nouveau = String(f.get('nouveau'));
      const codes = politique ? controlerMotDePasse(nouveau, politique) : [];
      const message = nouveau !== f.get('confirmation') ? 'Les deux saisies diffèrent'
        : codes.length ? codes.map((c) => MESSAGES_AUTH[c] ?? c).join(' · ') : null;
      if (message) { erreur.textContent = message; erreur.hidden = false; return; }
      try {
        await api.auth.reinitialiser(this.requete.jeton, nouveau);
        this.conteneur.innerHTML = '<div class="page-simple"><h1>✔ Mot de passe enregistré</h1><p><a href="/connexion">Se connecter</a></p></div>';
      } catch (x) { erreur.textContent = x.message; erreur.hidden = false; }
    });
  }

  /** Développement : comptes proposés à la connexion sans mot de passe (A10, A11). */
  async #rendreComptesTest() {
    const comptes = await api.auth.comptesTest().catch(() => []);
    const zone = this.conteneur.querySelector('[data-test]');
    zone.innerHTML = `<section class="carte connexion"><h2>🧪 Développement : se connecter sans mot de passe</h2>
      ${comptes.length ? `<p>${comptes.map((c) => `<button type="button" data-compte="${echapper(c.code)}" title="${echapper(c.libelle ?? '')}">👤 ${echapper(c.code)} · ${echapper(c.profil)}</button>`).join(' ')}</p>`
        : '<p class="aide">Aucun compte : créez un administrateur avec <code>dotnet run --project src/LogiBTP.Api -- comptes creer-admin &lt;pseudo&gt;</code>.</p>'}
      <p class="aide">Réservé à l'environnement de développement (réglage Authentification:ComptesTest).</p></section>`;
    zone.querySelectorAll('[data-compte]').forEach((b) => b.addEventListener('click', () => this.#connecter(() => api.auth.connexionTest(b.dataset.compte))));
  }

  async #connecter(appel) {
    const erreur = this.conteneur.querySelector('[data-erreur]');
    erreur.hidden = true;
    try {
      const session = await appel();
      this.app.session = session;
      this.app.publier('session', { connecte: true });
      this.#poursuivre(session);
    } catch (e) {
      erreur.textContent = e.message;
      erreur.hidden = false;
    }
  }

  #poursuivre(session) {
    if (this.fenetreSeule && !session.mdp_a_changer) {
      this.conteneur.innerHTML = '<div class="page-simple"><h1>✔ Connecté</h1><p>Vous pouvez fermer cette fenêtre et enregistrer votre saisie.</p></div>';
      setTimeout(() => window.close(), 800);
      return;
    }
    this.app.fermetureForcee = true;
    location.assign(session.mdp_a_changer ? '/compte?changer=1' : (this.requete.retour || '/'));
  }
}
