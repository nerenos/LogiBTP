import { PageBase } from '@logibtp/navigation';
import { echapper } from '@logibtp/socle/ui';
import { ETATS_COMPTE } from '@logibtp/authentification';
import { api } from '../api.js';
import { pastilleCompte, rendreComptePersonne, dateCompte, jourCompte } from '../comptes/comptes.js';

const EVENEMENTS = {
  CONNEXION: '🔑 Connexion', ECHEC: '✖ Échec', VERROUILLAGE: '🔒 Verrouillage', DECONNEXION: '⏻ Déconnexion', MDP_CHANGE: '🔐 Mot de passe changé',
  MDP_REINITIALISE: '🔐 Mot de passe réinitialisé', EXPIRE: '⌛ Expiré', REFUS: '⛔ Refus', DEVERROUILLAGE: '🔓 Déverrouillage', COMPTE: '👤 Compte',
};

/**
 * Comptes utilisateurs (module Authentification, lot 1 ; administrateur) : liste par état (actifs, provisoires,
 * verrouillés, expirés, désactivés, service), dernière connexion ; nouveau compte pour un salarié ou un intérimaire
 * cherché par son nom ; `?compte=<id>` : un compte, ses actions et son journal de connexion.
 */
export class PageParametresComptes extends PageBase {
  icone = '👥';

  async ouvrir() {
    const app = this.app;
    this.titre = 'Comptes utilisateurs';
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">👥 Comptes utilisateurs</h1><div data-corps></div></div>`;
    const corps = this.conteneur.querySelector('[data-corps]');
    if (!app.enLigne) { corps.innerHTML = '<p class="aide">Comptes : en ligne seulement (la démonstration hors ligne n\'a pas de connexion).</p>'; return; }
    if (!app.estAdmin()) { corps.innerHTML = '<p class="aide">Réservé aux administrateurs.</p>'; return; }
    if (this.requete.compte) await this.#rendreCompte(corps, Number(this.requete.compte));
    else await this.#rendreListe(corps);
  }

  urlCourante() { return this.requete.compte ? `/parametres/comptes?compte=${this.requete.compte}` : '/parametres/comptes'; }

  async #rendreListe(corps) {
    corps.innerHTML = `<p class="aide">Un compte se crée pour un salarié ou un intérimaire actif (aucun par défaut) ; il est désactivé d'office à la sortie du salarié.
        Les comptes de service tracent les tâches de fond et ne se connectent jamais.</p>
      <section class="carte"><h2>Nouveau compte</h2>
        <p><input type="search" data-personne placeholder="Salarié ou intérimaire : nom, prénom ou matricule…" size="40"></p>
        <div data-personnes></div><div data-creation></div></section>
      <section class="carte"><h2>Comptes</h2>
        <p class="ligne"><input type="search" data-recherche placeholder="Identifiant ou nom…" size="24">
          ${['', 'ACTIF', 'A_CHANGER', 'VERROUILLE', 'EXPIRE', 'INACTIF', 'SERVICE'].map((e) => `<label class="ligne"><input type="radio" name="etat" value="${e}" ${e === '' ? 'checked' : ''}> ${e ? echapper(ETATS_COMPTE[e]) : 'Tous'}</label>`).join(' ')}</p>
        <div data-liste></div></section>`;
    const liste = corps.querySelector('[data-liste]');
    const charger = async () => {
      const etat = corps.querySelector('[name="etat"]:checked').value;
      const comptes = await api.auth.comptes({ recherche: corps.querySelector('[data-recherche]').value, etat });
      liste.innerHTML = comptes.length ? `<table><thead><tr><th>Identifiant</th><th>Nom</th><th>Profil</th><th>État</th><th>Fin de validité</th><th>Dernière connexion</th><th class="nombre">Sessions</th></tr></thead><tbody>
        ${comptes.map((c) => `<tr><td><a href="/parametres/comptes?compte=${c.id}">${echapper(c.code)}</a></td><td>${echapper(c.libelle ?? '')}</td><td>${echapper(c.profil)}</td>
          <td>${pastilleCompte(c)}</td><td>${jourCompte(c.valide_jusqu_au)}</td><td>${dateCompte(c.derniere_connexion)}</td><td class="nombre">${c.sessions_ouvertes || ''}</td></tr>`).join('')}
        </tbody></table>` : '<p class="aide">Aucun compte.</p>';
    };
    let minuterie = null;
    corps.querySelector('[data-recherche]').addEventListener('input', () => { clearTimeout(minuterie); minuterie = setTimeout(() => charger().catch((e) => this.app.erreur(e)), 250); });
    corps.querySelectorAll('[name="etat"]').forEach((r) => r.addEventListener('change', () => charger().catch((e) => this.app.erreur(e))));
    await charger();

    const zone = corps.querySelector('[data-personnes]');
    let minuteriePersonne = null;
    corps.querySelector('[data-personne]').addEventListener('input', (e) => {
      clearTimeout(minuteriePersonne);
      minuteriePersonne = setTimeout(async () => {
        const personnes = await api.auth.personnes(e.target.value).catch((x) => { this.app.erreur(x); return []; });
        zone.innerHTML = personnes.length ? `<ul class="liste-simple">${personnes.map((p, i) => `<li><button type="button" data-i="${i}">${p.compte ? '👤' : '＋'}</button>
          ${echapper(p.personne.libelle)} <small class="aide">${echapper(p.personne.statut ?? '')}</small>${p.compte ? ` — compte <a href="/parametres/comptes?compte=${p.compte.id}">${echapper(p.compte.code)}</a>` : ''}</li>`).join('')}</ul>`
          : e.target.value.trim().length >= 2 ? '<p class="aide">Aucun salarié ni intérimaire actif trouvé.</p>' : '';
        zone.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
          const p = personnes[Number(b.dataset.i)].personne;
          rendreComptePersonne(corps.querySelector('[data-creation]'), { app: this.app, type: p.type, id: p.id, surChange: () => charger() }).catch((x) => this.app.erreur(x));
        }));
      }, 250);
    });
  }

  async #rendreCompte(corps, id) {
    const { compte, personne, journal } = await api.auth.compte(id);
    this.titre = `Compte ${compte.code}`;
    corps.innerHTML = `<p><a href="/parametres/comptes">← Tous les comptes</a></p>
      <section class="carte"><h2>${echapper(compte.code)} ${pastilleCompte(compte)}</h2><div data-compte></div></section>
      <section class="carte"><h2>Journal des connexions</h2>
        ${journal.length ? `<table><thead><tr><th>Quand</th><th>Événement</th><th>Détail</th><th>Par</th><th>Adresse</th></tr></thead><tbody>
          ${journal.map((j) => `<tr><td>${dateCompte(j.le)}</td><td>${echapper(EVENEMENTS[j.evenement] ?? j.evenement)}</td><td>${echapper(j.detail ?? '')}</td>
            <td>${echapper(j.par ?? '')}</td><td title="${echapper(j.navigateur ?? '')}">${echapper(j.adresse ?? '')}</td></tr>`).join('')}</tbody></table>` : '<p class="aide">Aucun événement.</p>'}
      </section>`;
    const zone = corps.querySelector('[data-compte]');
    if (personne) await rendreComptePersonne(zone, { app: this.app, type: compte.type_element, id: compte.id_element });
    else zone.innerHTML = `<p class="aide">${compte.type === 'SERVICE' ? 'Compte de service : tâches de fond, sans connexion.' : 'Compte sans personne liée (administrateur de l\'installation) : réinitialisation par la commande serveur.'}</p>
      <dl class="definitions"><dt>Nom</dt><dd>${echapper(compte.libelle ?? '')}</dd><dt>Profil</dt><dd>${echapper(compte.profil)}</dd>
      <dt>Dernière connexion</dt><dd>${dateCompte(compte.derniere_connexion)}</dd></dl>
      ${compte.type === 'PERSONNE' ? `<div data-provisoire></div><p><button type="button" data-reinitialiser>🔐 Réinitialiser le mot de passe</button>
        ${compte.etat === 'VERROUILLE' ? '<button type="button" data-deverrouiller>🔓 Déverrouiller</button>' : ''}</p>` : ''}`;
    zone.querySelector('[data-reinitialiser]')?.addEventListener('click', async () => {
      if (!confirm(`Réinitialiser le mot de passe de ${compte.code} ? Ses sessions seront fermées.`)) return;
      try {
        const r = await api.auth.reinitialiserCompte(compte.id);
        zone.querySelector('[data-provisoire]').innerHTML = `<div class="carte avertissement"><p>🔐 Mot de passe provisoire, affiché une fois : <code class="mdp-provisoire">${echapper(r.mot_de_passe)}</code></p></div>`;
      } catch (e) { this.app.erreur(e); }
    });
    zone.querySelector('[data-deverrouiller]')?.addEventListener('click', () => api.auth.deverrouillerCompte(compte.id).then(() => this.#rendreCompte(corps, id)).catch((e) => this.app.erreur(e)));
  }
}
