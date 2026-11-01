import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { SUJET_FENETRE } from '../codes.js';
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
  icone = icone('authentification_btp_connexion');

  get fenetreSeule() { return this.requete.fenetre === '1'; }

  async ouvrir() {
    const app = this.app;
    this.titre = texte('authentification_btp.connexion.titre');
    const session = app.session ?? {};
    if (this.requete.jeton) { await this.#rendreReinitialisation(); return; }
    if (session.connecte && !this.fenetreSeule) { this.#poursuivre(session); return; }
    const societe = app.societe;
    this.conteneur.innerHTML = `<div class="page-connexion"><form class="carte connexion" data-form autocomplete="on">
        <h1>${iconeHtml('authentification_btp_connexion')} ${texteHtml('authentification_btp.connexion.titre')}</h1>
        ${societe ? `<p class="aide">${iconeHtml('authentification_btp_societe')} ${echapper(societe.libelle)}</p>` : ''}
        <label>${texteHtml('authentification_btp.connexion.identifiant')}<input name="identifiant" autocomplete="username" required autofocus spellcheck="false" autocapitalize="none"></label>
        <label>${texteHtml('authentification_btp.connexion.mdp')}<input name="mdp" type="password" autocomplete="current-password" required></label>
        ${session.rester_connecte_permis !== false ? `<label class="ligne"><input type="checkbox" name="rester"> ${texteHtml('authentification_btp.connexion.rester')}</label>
          <p class="aide">${texteHtml('authentification_btp.connexion.rester_aide')}</p>` : ''}
        <p class="connexion-erreur" data-erreur hidden></p>
        <p><button type="submit" class="principal">${texteHtml('authentification_btp.connexion.se_connecter')}</button></p>
        <p class="aide" data-oubli>${texteHtml('authentification_btp.connexion.oubli_admin')}</p>
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
    zone.innerHTML = `<button type="button" class="lien" data-ouvrir-oubli>${texteHtml('authentification_btp.connexion.oubli')}</button>`;
    zone.querySelector('[data-ouvrir-oubli]').addEventListener('click', () => {
      const identifiant = this.conteneur.querySelector('[name="identifiant"]').value;
      zone.innerHTML = `<span>${texteHtml('authentification_btp.connexion.oubli_lien')}</span>
        <span class="ligne"><input data-identifiant-oubli value="${echapper(identifiant)}" placeholder="${texteHtml('authentification_btp.connexion.identifiant_indice')}" autocapitalize="none" spellcheck="false">
        <button type="button" data-envoyer-oubli>${texteHtml('authentification_btp.connexion.envoyer_lien')}</button></span>`;
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
    this.titre = texte('authentification_btp.connexion.nouveau_titre');
    this.conteneur.innerHTML = `<div class="page-connexion"><form class="carte connexion" data-form>
        <h1>${iconeHtml('authentification_btp_connexion')} ${texteHtml('authentification_btp.connexion.nouveau_titre')}</h1>
        <label>${texteHtml('authentification_btp.connexion.nouveau')}<input name="nouveau" type="password" autocomplete="new-password" required autofocus></label>
        <label>${texteHtml('authentification_btp.connexion.confirmation')}<input name="confirmation" type="password" autocomplete="new-password" required></label>
        ${politique ? `<p class="aide">${texteHtml('authentification_btp.connexion.longueur_min', { n: politique.longueur_min })}</p>` : ''}
        <p class="connexion-erreur" data-erreur hidden></p>
        <p><button type="submit" class="principal">${texteHtml('commun.enregistrer')}</button></p></form></div>`;
    const form = this.conteneur.querySelector('[data-form]');
    const erreur = this.conteneur.querySelector('[data-erreur]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const nouveau = String(f.get('nouveau'));
      const codes = politique ? controlerMotDePasse(nouveau, politique) : [];
      const message = nouveau !== f.get('confirmation') ? texte('authentification_btp.connexion.saisies_differentes')
        : codes.length ? codes.map((c) => MESSAGES_AUTH[c] ?? c).join(' · ') : null;
      if (message) { erreur.textContent = message; erreur.hidden = false; return; }
      try {
        await api.auth.reinitialiser(this.requete.jeton, nouveau);
        this.conteneur.innerHTML = `<div class="page-simple"><h1>${iconeHtml('authentification_btp_succes')} ${texteHtml('authentification_btp.connexion.mdp_enregistre')}</h1><p><a href="/connexion">${texteHtml('authentification_btp.connexion.se_connecter')}</a></p></div>`;
      } catch (x) { erreur.textContent = x.message; erreur.hidden = false; }
    });
  }

  /** Développement : comptes proposés à la connexion sans mot de passe (A10, A11). */
  async #rendreComptesTest() {
    const comptes = await api.auth.comptesTest().catch(() => []);
    const zone = this.conteneur.querySelector('[data-test]');
    zone.innerHTML = `<section class="carte connexion"><h2>${iconeHtml('authentification_btp_test')} ${texteHtml('authentification_btp.connexion.test_titre')}</h2>
      ${comptes.length ? `<p>${comptes.map((c) => `<button type="button" data-compte="${echapper(c.code)}" title="${echapper(c.libelle ?? '')}">${iconeHtml('authentification_btp_compte')} ${echapper(c.code)} · ${echapper(c.profil)}</button>`).join(' ')}</p>`
        : `<p class="aide">${texteHtml('authentification_btp.connexion.aucun_compte_test_html')}</p>`}
      <p class="aide">${texteHtml('authentification_btp.connexion.test_aide')}</p></section>`;
    zone.querySelectorAll('[data-compte]').forEach((b) => b.addEventListener('click', () => this.#connecter(() => api.auth.connexionTest(b.dataset.compte))));
  }

  async #connecter(appel) {
    const erreur = this.conteneur.querySelector('[data-erreur]');
    erreur.hidden = true;
    try {
      const session = await appel();
      // Double facteur (module Droits, D3) : code reçu par courriel, à saisir avant l'ouverture de la session.
      if (session.double_facteur) { this.#rendreCode(session); return; }
      this.app.session = session;
      this.app.publier(SUJET_FENETRE.SESSION, { connecte: true });
      this.#poursuivre(session);
    } catch (e) {
      erreur.textContent = e.message;
      erreur.hidden = false;
    }
  }

  /** Second temps de la connexion : code à 6 chiffres envoyé à l'adresse indiquée (masquée), 10 minutes. */
  #rendreCode(etape) {
    // Formulaire neuf (sans l'écouteur de la saisie du mot de passe).
    const ancien = this.conteneur.querySelector('[data-form]');
    const form = ancien.cloneNode(false);
    ancien.replaceWith(form);
    form.innerHTML = `<h1>${iconeHtml('authentification_btp_mdp')} ${texteHtml('authentification_btp.connexion.code_titre')}</h1>
      <p class="aide">${texteHtml('authentification_btp.connexion.code_envoye', { destination: etape.destination })}</p>
      <label>${texteHtml('authentification_btp.connexion.code')}<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus></label>
      <p class="connexion-erreur" data-erreur hidden></p>
      <p><button type="submit" class="principal">${texteHtml('commun.valider')}</button> <a href="/connexion">${texteHtml('authentification_btp.connexion.recommencer')}</a></p>`;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.#connecter(() => api.auth.code(etape.etape, new FormData(form).get('code')));
    });
  }

  #poursuivre(session) {
    if (this.fenetreSeule && !session.mdp_a_changer) {
      this.conteneur.innerHTML = `<div class="page-simple"><h1>${iconeHtml('authentification_btp_succes')} ${texteHtml('authentification_btp.connexion.connecte')}</h1><p>${texteHtml('authentification_btp.connexion.fermer_fenetre')}</p></div>`;
      setTimeout(() => window.close(), 800);
      return;
    }
    this.app.fermetureForcee = true;
    location.assign(session.mdp_a_changer ? '/compte?changer=1' : (this.requete.retour || '/'));
  }
}
